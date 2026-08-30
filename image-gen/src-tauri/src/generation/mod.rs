//! Generation module. The UI knows only this small interface:
//! `create_batch`, `cancel_job`, `retry_job`, plus normalized
//! `job_updated` / `batch_created` events. Everything else is hidden.

pub mod adapter;
pub mod antigravity;
pub mod openai;
pub mod runner;
pub mod scheduler;

use crate::domain::*;
use crate::library::Library;
use crate::paths::AppPaths;
use crate::references::{MAX_BATCH_REFERENCE_BYTES, MAX_REFERENCES_PER_BATCH};
use crate::settings::Settings;
use serde::Deserialize;
use std::sync::{Arc, Mutex};

/// Normalized event fan-out. Tauri in production, a recorder in tests.
pub trait EventSink: Send + Sync {
    fn job_updated(&self, job: &JobView);
    fn batch_created(&self, batch: &BatchView);
}

pub struct ServiceCtx {
    pub library: Arc<Library>,
    pub paths: AppPaths,
    pub settings: Arc<Mutex<Settings>>,
    pub sink: Arc<dyn EventSink>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBatchInput {
    pub prompt: String,
    pub providers: Vec<Provider>,
    pub variant_count: u32,
    #[serde(default)]
    pub reference_asset_ids: Vec<String>,
}

pub struct GenerationService {
    ctx: Arc<ServiceCtx>,
    scheduler: scheduler::SchedulerHandle,
}

impl GenerationService {
    pub fn start(
        library: Arc<Library>,
        paths: AppPaths,
        settings: Arc<Mutex<Settings>>,
        sink: Arc<dyn EventSink>,
    ) -> Self {
        let ctx = Arc::new(ServiceCtx {
            library,
            paths,
            settings,
            sink,
        });
        let scheduler = scheduler::start(Arc::clone(&ctx));
        Self { ctx, scheduler }
    }

    pub fn create_batch(&self, input: CreateBatchInput) -> Result<BatchView, String> {
        let prompt = input.prompt.trim();
        if prompt.is_empty() {
            return Err("prompt must not be empty".into());
        }
        let mut providers = input.providers.clone();
        providers.dedup();
        if providers.is_empty() {
            return Err("select at least one provider".into());
        }
        if !(1..=3).contains(&input.variant_count) {
            return Err("variant count must be between 1 and 3".into());
        }
        if input.reference_asset_ids.len() > MAX_REFERENCES_PER_BATCH {
            return Err(format!(
                "at most {MAX_REFERENCES_PER_BATCH} references per batch"
            ));
        }
        let total_bytes = self
            .ctx
            .library
            .total_asset_bytes(&input.reference_asset_ids)
            .map_err(|e| e.to_string())?;
        if total_bytes > MAX_BATCH_REFERENCE_BYTES {
            return Err("references exceed 80 MB for this batch".into());
        }

        let batch = self
            .ctx
            .library
            .create_batch(
                prompt,
                &providers,
                input.variant_count,
                &input.reference_asset_ids,
            )
            .map_err(|e| e.to_string())?;
        self.ctx.sink.batch_created(&batch);
        // Jobs arrive ordered by (provider, variant_index): variants for
        // one provider queue in order.
        for job in &batch.jobs {
            self.scheduler.enqueue(job);
        }
        Ok(batch)
    }

    pub fn cancel_job(&self, job_id: &str) {
        self.scheduler.cancel(job_id);
    }

    /// Retry never resumes work automatically; it creates one new queued
    /// attempt linked to the old row.
    pub fn retry_job(&self, job_id: &str) -> Result<JobView, String> {
        let job = self
            .ctx
            .library
            .create_retry_job(job_id)
            .map_err(|e| e.to_string())?;
        self.ctx.sink.job_updated(&job);
        self.scheduler.enqueue(&job);
        Ok(job)
    }
}
