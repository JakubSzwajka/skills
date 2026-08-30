//! Thin Tauri command layer. Commands validate, delegate, and translate
//! errors to strings. No business logic lives here.

use crate::domain::{Cursor, HistoryPage};
use crate::generation::{CreateBatchInput, GenerationService};
use crate::library::Library;
use crate::paths::AppPaths;
use crate::settings::{self, EffectiveSettings, Settings};
use crate::state::{AppState, Core, TauriSink};
use serde::Serialize;
use std::sync::{Arc, Mutex, Once};
use tauri::{AppHandle, Manager, State};

const HISTORY_PAGE_SIZE: u32 = 12;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapResult {
    pub settings: EffectiveSettings,
    pub history: HistoryPage,
    pub recovered_jobs: u32,
}

/// Called by the frontend after first paint. Opens SQLite, recovers
/// interrupted jobs, starts the scheduler, and returns the latest page.
/// Never contacts a provider or tests authentication.
#[tauri::command]
pub fn bootstrap(app: AppHandle, state: State<'_, AppState>) -> Result<BootstrapResult, String> {
    let mut recovered = 0u32;
    let core = state.get_or_init(|| {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("no app data dir: {e}"))?;
        let stored = settings::load(&data_dir);
        let output_root = stored
            .output_dir
            .clone()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| default_output_root(&app));
        let paths = AppPaths::new(data_dir, output_root).map_err(|e| e.to_string())?;
        init_logging(&paths);

        let library = Arc::new(Library::open(&paths.db_path).map_err(|e| e.to_string())?);
        recovered = library.recover_interrupted().map_err(|e| e.to_string())?;
        if recovered > 0 {
            tracing::info!("recovered {recovered} interrupted jobs");
        }

        let settings = Arc::new(Mutex::new(stored));
        let sink = Arc::new(TauriSink { app: app.clone() });
        let service = GenerationService::start(
            Arc::clone(&library),
            paths.clone(),
            Arc::clone(&settings),
            sink,
        );
        Ok(Arc::new(Core {
            paths,
            library,
            settings,
            service,
        }))
    })?;

    // CLI requests that arrived before the core was ready become tracked
    // batches now, so they are included in the returned history page.
    for request in state.take_pending() {
        if let Err(reason) = core.service.create_batch(request.into_input()) {
            tracing::warn!("queued CLI batch rejected: {reason}");
        }
    }

    Ok(BootstrapResult {
        settings: effective_settings(&core),
        history: core
            .library
            .history_page(None, HISTORY_PAGE_SIZE)
            .map_err(|e| e.to_string())?,
        recovered_jobs: recovered,
    })
}

#[tauri::command]
pub fn create_batch(
    state: State<'_, AppState>,
    input: CreateBatchInput,
) -> Result<crate::domain::BatchView, String> {
    state.get()?.service.create_batch(input)
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<(), String> {
    state.get()?.service.cancel_job(&job_id);
    Ok(())
}

#[tauri::command]
pub fn retry_job(
    state: State<'_, AppState>,
    job_id: String,
) -> Result<crate::domain::JobView, String> {
    state.get()?.service.retry_job(&job_id)
}

#[tauri::command]
pub fn load_history_page(
    state: State<'_, AppState>,
    cursor: Option<Cursor>,
) -> Result<HistoryPage, String> {
    state
        .get()?
        .library
        .history_page(cursor.as_ref(), HISTORY_PAGE_SIZE)
        .map_err(|e| e.to_string())
}

/// Clipboard paste: raw image bytes arrive as the request body.
#[tauri::command]
pub fn import_reference(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<crate::domain::AssetView, String> {
    let core = state.get()?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    crate::references::import_image(bytes, &core.paths, &core.library)
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    new_settings: Settings,
) -> Result<EffectiveSettings, String> {
    let core = state.get()?;
    settings::save(&core.paths.data_dir, &new_settings)?;
    *core.settings.lock().expect("settings lock") = new_settings;
    Ok(effective_settings(&core))
}

#[tauri::command]
pub fn copy_image(state: State<'_, AppState>, asset_id: String) -> Result<(), String> {
    let core = state.get()?;
    let asset = core.library.get_asset(&asset_id).map_err(|e| e.to_string())?;
    let img = image::open(&asset.path).map_err(|e| format!("open failed: {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard
        .set_image(arboard::ImageData {
            width: width as usize,
            height: height as usize,
            bytes: rgba.into_raw().into(),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_asset(state: State<'_, AppState>, asset_id: String) -> Result<(), String> {
    let core = state.get()?;
    let asset = core.library.get_asset(&asset_id).map_err(|e| e.to_string())?;
    reveal_path(&asset.path)
}

fn reveal_path(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .args(["-R", path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let parent = std::path::Path::new(path)
            .parent()
            .ok_or("no parent directory")?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn effective_settings(core: &Core) -> EffectiveSettings {
    let stored = core.settings.lock().expect("settings lock").clone();
    EffectiveSettings {
        resolved_output_dir: core.paths.output_root.display().to_string(),
        resolved_codex: settings::resolve_executable(
            crate::domain::Provider::Openai,
            stored.codex_path.as_deref(),
        )
        .map(|p| p.display().to_string()),
        resolved_agy: settings::resolve_executable(
            crate::domain::Provider::Antigravity,
            stored.agy_path.as_deref(),
        )
        .map(|p| p.display().to_string()),
        stored,
    }
}

fn default_output_root(app: &AppHandle) -> std::path::PathBuf {
    app.path()
        .picture_dir()
        .map(|p| p.join("Image Gen"))
        .unwrap_or_else(|_| std::path::PathBuf::from("Image Gen"))
}

fn init_logging(paths: &AppPaths) {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let log_path = paths.logs_dir.join("image-gen.log");
        if let Ok(file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
        {
            let _ = tracing_subscriber::fmt()
                .with_writer(Mutex::new(file))
                .with_ansi(false)
                .try_init();
        }
    });
}
