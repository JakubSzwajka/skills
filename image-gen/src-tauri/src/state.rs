//! Lazily initialized application core. Nothing here runs before the
//! frontend reports first paint and calls `bootstrap`.

use crate::cli::CliRequest;
use crate::domain::{BatchView, JobView};
use crate::generation::{EventSink, GenerationService};
use crate::library::Library;
use crate::paths::AppPaths;
use crate::settings::Settings;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

pub struct Core {
    pub paths: AppPaths,
    pub library: Arc<Library>,
    pub settings: Arc<Mutex<Settings>>,
    pub service: GenerationService,
}

#[derive(Default)]
pub struct AppState {
    core: OnceLock<Arc<Core>>,
    /// CLI generation requests that arrived before bootstrap finished.
    pending: Mutex<Vec<CliRequest>>,
}

impl AppState {
    pub fn with_pending(requests: Vec<CliRequest>) -> Self {
        Self {
            core: OnceLock::new(),
            pending: Mutex::new(requests),
        }
    }

    pub fn push_pending(&self, request: CliRequest) {
        self.pending.lock().expect("pending lock").push(request);
    }

    pub fn take_pending(&self) -> Vec<CliRequest> {
        std::mem::take(&mut *self.pending.lock().expect("pending lock"))
    }

    pub fn get(&self) -> Result<Arc<Core>, String> {
        self.core
            .get()
            .cloned()
            .ok_or_else(|| "application core is not initialized yet".to_string())
    }

    pub fn get_or_init(
        &self,
        init: impl FnOnce() -> Result<Arc<Core>, String>,
    ) -> Result<Arc<Core>, String> {
        if let Some(core) = self.core.get() {
            return Ok(Arc::clone(core));
        }
        let core = init()?;
        // A racing initializer is harmless: first one wins.
        let _ = self.core.set(Arc::clone(&core));
        Ok(self.get()?)
    }
}

/// Fans normalized events out to the webview.
pub struct TauriSink {
    pub app: tauri::AppHandle,
}

impl EventSink for TauriSink {
    fn job_updated(&self, job: &JobView) {
        let _ = self.app.emit("job_updated", job);
    }

    fn batch_created(&self, batch: &BatchView) {
        let _ = self.app.emit("batch_created", batch);
    }
}
