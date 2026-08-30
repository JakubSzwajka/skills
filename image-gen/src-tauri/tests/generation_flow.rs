//! End-to-end generation tests with fake provider executables.
//! No real provider is contacted and no quota is consumed.

use image_gen::domain::*;
use image_gen::generation::{CreateBatchInput, EventSink, GenerationService};
use image_gen::library::Library;
use image_gen::paths::AppPaths;
use image_gen::settings::Settings;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct RecordingSink {
    events: Mutex<Vec<String>>,
}

impl EventSink for RecordingSink {
    fn job_updated(&self, job: &JobView) {
        self.events
            .lock()
            .unwrap()
            .push(format!("job:{}:{}", job.id, job.status.as_str()));
    }
    fn batch_created(&self, batch: &BatchView) {
        self.events.lock().unwrap().push(format!("batch:{}", batch.id));
    }
}

struct Harness {
    _dir: tempfile::TempDir,
    paths: AppPaths,
    library: Arc<Library>,
    service: GenerationService,
    #[allow(dead_code)]
    sink: Arc<RecordingSink>,
}

fn fixture_png(dir: &Path) -> PathBuf {
    let path = dir.join("fixture.png");
    image::RgbaImage::from_pixel(32, 24, image::Rgba([250, 180, 20, 255]))
        .save(&path)
        .unwrap();
    path
}

fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn harness(codex_body: &str, agy_body: &str) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::under_root(dir.path()).unwrap();
    let codex = write_script(dir.path(), "fake-codex", codex_body);
    let agy = write_script(dir.path(), "fake-agy", agy_body);
    let library = Arc::new(Library::open(&paths.db_path).unwrap());
    let settings = Arc::new(Mutex::new(Settings {
        output_dir: None,
        codex_path: Some(codex.display().to_string()),
        agy_path: Some(agy.display().to_string()),
    }));
    let sink = Arc::new(RecordingSink {
        events: Mutex::new(Vec::new()),
    });
    let service = GenerationService::start(
        Arc::clone(&library),
        paths.clone(),
        settings,
        Arc::clone(&sink) as Arc<dyn EventSink>,
    );
    Harness {
        _dir: dir,
        paths,
        library,
        service,
        sink,
    }
}

fn success_script(fixture: &Path) -> String {
    // Fails hard if credential variables leak into the child process.
    format!(
        "#!/bin/sh\n\
         if [ -n \"$OPENAI_API_KEY\" ] || [ -n \"$GEMINI_API_KEY\" ] || [ -n \"$GOOGLE_APPLICATION_CREDENTIALS\" ]; then\n\
           echo 'credential variable leaked' >&2\n\
           exit 3\n\
         fi\n\
         cat >/dev/null 2>/dev/null\n\
         cp \"{}\" output.png\n",
        fixture.display()
    )
}

fn wait_for<F: Fn() -> bool>(what: &str, timeout: Duration, check: F) {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if check() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("timed out waiting for {what}");
}

fn batch_jobs(library: &Library, batch_id: &str) -> Vec<JobView> {
    library.get_batch(batch_id).unwrap().jobs
}

#[test]
fn two_provider_batch_succeeds_with_serial_variants_per_provider() {
    // Plant credential variables; the fake scripts abort if they leak.
    std::env::set_var("OPENAI_API_KEY", "leaked");
    std::env::set_var("GEMINI_API_KEY", "leaked");

    let dir = tempfile::tempdir().unwrap();
    let fixture = fixture_png(dir.path());
    let script = success_script(&fixture);
    let h = harness(&script, &script);

    let batch = h
        .service
        .create_batch(CreateBatchInput {
            prompt: "a sleepy potato".into(),
            providers: vec![Provider::Openai, Provider::Antigravity],
            variant_count: 2,
            reference_asset_ids: vec![],
        })
        .unwrap();
    assert_eq!(batch.jobs.len(), 4);

    wait_for("all jobs to finish", Duration::from_secs(30), || {
        batch_jobs(&h.library, &batch.id)
            .iter()
            .all(|j| j.status.is_terminal())
    });

    let jobs = batch_jobs(&h.library, &batch.id);
    for job in &jobs {
        assert_eq!(job.status, JobStatus::Succeeded, "job {:?}", job);
        let asset = job.output_asset.as_ref().expect("output asset");
        assert!(Path::new(&asset.path).exists());
        assert!(Path::new(asset.thumbnail_path.as_deref().unwrap()).exists());
        assert!(asset.path.starts_with(h.paths.output_root.to_str().unwrap()));
    }

    // Variants for one provider run in order, never concurrently.
    for provider in Provider::ALL {
        let mut per: Vec<&JobView> = jobs.iter().filter(|j| j.provider == provider).collect();
        per.sort_by_key(|j| j.variant_index);
        assert!(per[0].finished_at.unwrap() <= per[1].started_at.unwrap());
    }
}

#[test]
fn backend_error_is_classified_and_retry_creates_a_linked_job() {
    let fail_script = "#!/bin/sh\n\
        cat >/dev/null 2>/dev/null\n\
        echo 'Error: generate_image failed: HTTP 500 INTERNAL' >&2\n\
        exit 1\n";
    let h = harness(fail_script, fail_script);

    let batch = h
        .service
        .create_batch(CreateBatchInput {
            prompt: "doomed".into(),
            providers: vec![Provider::Antigravity],
            variant_count: 1,
            reference_asset_ids: vec![],
        })
        .unwrap();
    let job_id = batch.jobs[0].id.clone();

    wait_for("job to fail", Duration::from_secs(15), || {
        h.library.get_job(&job_id).unwrap().status == JobStatus::Failed
    });
    let failed = h.library.get_job(&job_id).unwrap();
    assert_eq!(failed.error_code, Some(ErrorCode::BackendError));

    let retry = h.service.retry_job(&job_id).unwrap();
    assert_eq!(retry.retry_of_job_id.as_deref(), Some(job_id.as_str()));
    wait_for("retry to fail too", Duration::from_secs(15), || {
        h.library.get_job(&retry.id).unwrap().status == JobStatus::Failed
    });
    // The old attempt is untouched.
    assert_eq!(
        h.library.get_job(&job_id).unwrap().status,
        JobStatus::Failed
    );
}

#[test]
fn cancel_terminates_a_running_job_and_cancels_queued_ones() {
    let slow_script = "#!/bin/sh\ncat >/dev/null 2>/dev/null\nsleep 30\n";
    let h = harness(slow_script, slow_script);

    let batch = h
        .service
        .create_batch(CreateBatchInput {
            prompt: "slow".into(),
            providers: vec![Provider::Openai],
            variant_count: 2,
            reference_asset_ids: vec![],
        })
        .unwrap();
    let jobs = batch_jobs(&h.library, &batch.id);
    let (first, second) = (jobs[0].id.clone(), jobs[1].id.clone());

    wait_for("first job to run", Duration::from_secs(15), || {
        h.library.get_job(&first).unwrap().status == JobStatus::Running
    });
    // Second variant waits in the per-provider queue.
    assert_eq!(h.library.get_job(&second).unwrap().status, JobStatus::Queued);

    let started = Instant::now();
    h.service.cancel_job(&first);
    h.service.cancel_job(&second);

    wait_for("both jobs cancelled", Duration::from_secs(10), || {
        let a = h.library.get_job(&first).unwrap().status;
        let b = h.library.get_job(&second).unwrap().status;
        a == JobStatus::Cancelled && b == JobStatus::Cancelled
    });
    // SIGTERM path, not the 30 s sleep.
    assert!(started.elapsed() < Duration::from_secs(8));
}

#[test]
fn missing_executable_fails_as_provider_unavailable() {
    // An explicit invalid path never falls back to discovery, so this is
    // deterministic and can never launch a real provider binary.
    let dir = tempfile::tempdir().unwrap();
    let paths = AppPaths::under_root(dir.path()).unwrap();
    let library = Arc::new(Library::open(&paths.db_path).unwrap());
    let settings = Arc::new(Mutex::new(Settings {
        output_dir: None,
        codex_path: Some("/nonexistent/codex".into()),
        agy_path: None,
    }));
    let sink = Arc::new(RecordingSink {
        events: Mutex::new(Vec::new()),
    });
    let service = GenerationService::start(
        Arc::clone(&library),
        paths,
        settings,
        sink as Arc<dyn EventSink>,
    );

    let batch = service
        .create_batch(CreateBatchInput {
            prompt: "nowhere".into(),
            providers: vec![Provider::Openai],
            variant_count: 1,
            reference_asset_ids: vec![],
        })
        .unwrap();
    let job_id = batch.jobs[0].id.clone();
    wait_for("job to fail", Duration::from_secs(15), || {
        library.get_job(&job_id).unwrap().status.is_terminal()
    });
    let job = library.get_job(&job_id).unwrap();
    assert_eq!(job.status, JobStatus::Failed);
    assert_eq!(job.error_code, Some(ErrorCode::ProviderUnavailable));
}
