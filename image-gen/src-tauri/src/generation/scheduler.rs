//! Quota-protecting scheduler. Every real adapter invocation passes
//! through here. Limits: one running job per provider, two globally;
//! variants for one provider run in order.

use super::runner::{run_job, transition_and_emit};
use super::ServiceCtx;
use crate::domain::{JobStatus, JobView, Provider};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

pub const MAX_RUNNING_PER_PROVIDER: usize = 1;
pub const MAX_RUNNING_GLOBAL: usize = 2;

pub enum SchedMsg {
    Enqueue { job_id: String, provider: Provider },
    Cancel { job_id: String },
    Finished { job_id: String },
}

#[derive(Clone)]
pub struct SchedulerHandle {
    tx: mpsc::UnboundedSender<SchedMsg>,
}

impl SchedulerHandle {
    pub fn enqueue(&self, job: &JobView) {
        let _ = self.tx.send(SchedMsg::Enqueue {
            job_id: job.id.clone(),
            provider: job.provider,
        });
    }

    pub fn cancel(&self, job_id: &str) {
        let _ = self.tx.send(SchedMsg::Cancel {
            job_id: job_id.to_string(),
        });
    }
}

struct RunningJob {
    provider: Provider,
    cancel_tx: Option<oneshot::Sender<()>>,
}

pub fn start(ctx: Arc<ServiceCtx>) -> SchedulerHandle {
    let (tx, mut rx) = mpsc::unbounded_channel::<SchedMsg>();
    let loop_tx = tx.clone();
    tauri::async_runtime::spawn(async move {
        let mut queues: HashMap<Provider, VecDeque<String>> = HashMap::new();
        let mut running: HashMap<String, RunningJob> = HashMap::new();
        while let Some(msg) = rx.recv().await {
            match msg {
                SchedMsg::Enqueue { job_id, provider } => {
                    queues.entry(provider).or_default().push_back(job_id);
                }
                SchedMsg::Finished { job_id } => {
                    running.remove(&job_id);
                }
                SchedMsg::Cancel { job_id } => {
                    if let Some(run) = running.get_mut(&job_id) {
                        if let Some(cancel) = run.cancel_tx.take() {
                            let _ = cancel.send(());
                        }
                    } else if remove_queued(&mut queues, &job_id) {
                        transition_and_emit(&ctx, &job_id, JobStatus::Cancelled, None, None);
                    }
                }
            }
            dispatch(&ctx, &loop_tx, &mut queues, &mut running);
        }
    });
    SchedulerHandle { tx }
}

fn remove_queued(queues: &mut HashMap<Provider, VecDeque<String>>, job_id: &str) -> bool {
    for queue in queues.values_mut() {
        if let Some(position) = queue.iter().position(|id| id == job_id) {
            queue.remove(position);
            return true;
        }
    }
    false
}

fn dispatch(
    ctx: &Arc<ServiceCtx>,
    tx: &mpsc::UnboundedSender<SchedMsg>,
    queues: &mut HashMap<Provider, VecDeque<String>>,
    running: &mut HashMap<String, RunningJob>,
) {
    // Stable provider order; different providers may run concurrently.
    for provider in Provider::ALL {
        loop {
            if running.len() >= MAX_RUNNING_GLOBAL {
                return;
            }
            let provider_running = running.values().filter(|r| r.provider == provider).count();
            if provider_running >= MAX_RUNNING_PER_PROVIDER {
                break;
            }
            let Some(job_id) = queues.get_mut(&provider).and_then(VecDeque::pop_front) else {
                break;
            };
            let (cancel_tx, cancel_rx) = oneshot::channel();
            running.insert(
                job_id.clone(),
                RunningJob {
                    provider,
                    cancel_tx: Some(cancel_tx),
                },
            );
            let ctx = Arc::clone(ctx);
            let tx = tx.clone();
            tauri::async_runtime::spawn(async move {
                run_job(Arc::clone(&ctx), job_id.clone(), cancel_rx).await;
                let _ = tx.send(SchedMsg::Finished { job_id });
            });
        }
    }
}
