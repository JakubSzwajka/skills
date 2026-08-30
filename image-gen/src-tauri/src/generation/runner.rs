//! Executes one generation job: workspace, subprocess in its own process
//! group, cancellation with SIGTERM → grace → SIGKILL, output validation,
//! and finalization into the library.

use super::adapter::{adapter_for, redact, JobRequest};
use super::ServiceCtx;
use crate::domain::*;
use crate::library::{thumbnails, NewAsset};
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::oneshot;
use tokio::time::{sleep, timeout, Duration};
use uuid::Uuid;

const JOB_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const TERM_GRACE: Duration = Duration::from_secs(3);
const MAX_CAPTURED_OUTPUT: u64 = 1024 * 1024;

pub(crate) fn transition_and_emit(
    ctx: &ServiceCtx,
    job_id: &str,
    to: JobStatus,
    error: Option<(ErrorCode, String)>,
    asset_id: Option<&str>,
) {
    match ctx.library.transition_job(job_id, to, error, asset_id) {
        Ok(view) => ctx.sink.job_updated(&view),
        Err(e) => tracing::error!("job {job_id}: transition failed: {e}"),
    }
}

pub async fn run_job(ctx: Arc<ServiceCtx>, job_id: String, mut cancel_rx: oneshot::Receiver<()>) {
    // Cancelled during the scheduler hand-off window.
    if cancel_rx.try_recv().is_ok() {
        transition_and_emit(&ctx, &job_id, JobStatus::Cancelled, None, None);
        return;
    }

    let (job, batch) = {
        let job = match ctx.library.get_job(&job_id) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("job {job_id}: {e}");
                return;
            }
        };
        let batch = match ctx.library.get_batch(&job.batch_id) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!("job {job_id}: {e}");
                return;
            }
        };
        (job, batch)
    };

    let fail = |code: ErrorCode, message: String| {
        transition_and_emit(
            &ctx,
            &job_id,
            JobStatus::Failed,
            Some((code, message)),
            None,
        );
    };

    let executable = {
        let settings = ctx.settings.lock().expect("settings lock").clone();
        crate::settings::resolve_executable(job.provider, settings.configured_path(job.provider))
    };
    let Some(executable) = executable else {
        transition_and_emit(&ctx, &job_id, JobStatus::Running, None, None);
        fail(
            ErrorCode::ProviderUnavailable,
            format!(
                "{} executable not found; set its absolute path in Settings",
                job.provider.binary_name()
            ),
        );
        return;
    };

    transition_and_emit(&ctx, &job_id, JobStatus::Running, None, None);

    // Private per-job workspace with clearly identified reference copies.
    let workspace = ctx.paths.job_workspace(&job_id);
    if let Err(e) = std::fs::create_dir_all(&workspace) {
        fail(ErrorCode::Unknown, format!("workspace create failed: {e}"));
        return;
    }
    let mut reference_files = Vec::new();
    for (index, reference) in batch.references.iter().enumerate() {
        let ext = extension_for_media_type(&reference.media_type);
        let dest = workspace.join(format!("ref-{}.{ext}", index + 1));
        if let Err(e) = std::fs::copy(&reference.path, &dest) {
            fail(
                ErrorCode::Unknown,
                format!("reference {} is unavailable: {e}", index + 1),
            );
            return;
        }
        reference_files.push(dest);
    }

    let request = JobRequest {
        prompt: batch.prompt.clone(),
        output_path: workspace.join("output.png"),
        workspace: workspace.clone(),
        reference_files,
    };
    let adapter = adapter_for(job.provider);
    let spec = adapter.build_command(&executable, &request);

    let mut cmd = tokio::process::Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        .stdin(if spec.stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for var in spec.env_remove {
        cmd.env_remove(var);
    }
    // Own process group so Cancel can terminate the whole provider tree.
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::setpgid(0, 0);
            Ok(())
        });
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            fail(
                ErrorCode::ProviderUnavailable,
                format!("failed to launch {}: {e}", spec.program.display()),
            );
            return;
        }
    };
    let pgid = child.id().map(|pid| pid as i32);

    if let Some(text) = spec.stdin.clone() {
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin.write_all(text.as_bytes()).await;
            });
        }
    }
    let out_task = tokio::spawn(read_capped(child.stdout.take()));
    let err_task = tokio::spawn(read_capped(child.stderr.take()));

    enum WaitOutcome {
        Exited(std::process::ExitStatus),
        Cancelled,
        TimedOut,
    }
    let outcome = tokio::select! {
        status = child.wait() => match status {
            Ok(s) => WaitOutcome::Exited(s),
            Err(_) => WaitOutcome::TimedOut,
        },
        _ = &mut cancel_rx => WaitOutcome::Cancelled,
        _ = sleep(JOB_TIMEOUT) => WaitOutcome::TimedOut,
    };

    match outcome {
        WaitOutcome::Cancelled => {
            terminate_group(pgid, &mut child).await;
            transition_and_emit(&ctx, &job_id, JobStatus::Cancelled, None, None);
        }
        WaitOutcome::TimedOut => {
            kill_group(pgid, &mut child).await;
            fail(
                ErrorCode::Timeout,
                "provider did not finish within the time limit".into(),
            );
        }
        WaitOutcome::Exited(status) => {
            let stdout = out_task.await.unwrap_or_default();
            let stderr = err_task.await.unwrap_or_default();
            let combined = format!("{stderr}\n{stdout}");
            if status.success() {
                match finalize_success(&ctx, &job_id, &request.output_path) {
                    Ok(asset_id) => {
                        transition_and_emit(
                            &ctx,
                            &job_id,
                            JobStatus::Succeeded,
                            None,
                            Some(&asset_id),
                        );
                        let _ = std::fs::remove_dir_all(&workspace);
                    }
                    Err(reason) => fail(ErrorCode::InvalidOutput, reason),
                }
            } else {
                let code = adapter.classify_failure(&combined);
                fail(code, redact(&combined));
            }
        }
    }
}

/// Validate a non-empty supported raster image, move it into the output
/// library, create the thumbnail, and register the asset.
fn finalize_success(ctx: &ServiceCtx, job_id: &str, output_path: &Path) -> Result<String, String> {
    let bytes =
        std::fs::read(output_path).map_err(|_| "provider did not create the output file")?;
    if bytes.is_empty() {
        return Err("output file is empty".into());
    }
    let format =
        image::guess_format(&bytes).map_err(|_| "output is not a recognized image format")?;
    let (media_type, ext) = match format {
        image::ImageFormat::Png => ("image/png", "png"),
        image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        image::ImageFormat::WebP => ("image/webp", "webp"),
        other => return Err(format!("unsupported output format: {other:?}")),
    };
    let img = image::load_from_memory(&bytes)
        .map_err(|e| format!("output image failed to decode: {e}"))?;
    if img.width() == 0 || img.height() == 0 {
        return Err("output image has zero dimensions".into());
    }

    let sha256 = sha256_hex(&bytes);
    let dest = ctx
        .paths
        .output_path_for_job(job_id, ext, crate::domain::now_millis());
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    move_file(output_path, &dest)?;

    let asset_id = Uuid::new_v4().to_string();
    let thumbnail = ctx.paths.thumbnail_path(&asset_id);
    thumbnails::create_thumbnail(&dest, &thumbnail)?;

    let asset = ctx
        .library
        .insert_asset(NewAsset {
            id: asset_id,
            kind: AssetKind::Generated,
            path: dest.display().to_string(),
            thumbnail_path: Some(thumbnail.display().to_string()),
            media_type: media_type.into(),
            width: img.width(),
            height: img.height(),
            byte_size: bytes.len() as u64,
            sha256,
        })
        .map_err(|e| e.to_string())?;
    Ok(asset.id)
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn extension_for_media_type(media_type: &str) -> &'static str {
    match media_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn move_file(src: &Path, dest: &Path) -> Result<(), String> {
    if std::fs::rename(src, dest).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dest).map_err(|e| format!("failed to store output: {e}"))?;
    let _ = std::fs::remove_file(src);
    Ok(())
}

async fn read_capped<R>(reader: Option<R>) -> String
where
    R: tokio::io::AsyncRead + Unpin,
{
    let Some(reader) = reader else {
        return String::new();
    };
    let mut buf = Vec::new();
    let _ = reader.take(MAX_CAPTURED_OUTPUT).read_to_end(&mut buf).await;
    String::from_utf8_lossy(&buf).into_owned()
}

/// SIGTERM to the process group, a three-second grace period, then SIGKILL.
async fn terminate_group(pgid: Option<i32>, child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pgid) = pgid {
        unsafe {
            libc::killpg(pgid, libc::SIGTERM);
        }
        if timeout(TERM_GRACE, child.wait()).await.is_ok() {
            return;
        }
        unsafe {
            libc::killpg(pgid, libc::SIGKILL);
        }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

async fn kill_group(pgid: Option<i32>, child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(pgid) = pgid {
        unsafe {
            libc::killpg(pgid, libc::SIGKILL);
        }
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}
