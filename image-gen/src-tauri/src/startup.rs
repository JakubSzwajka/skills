//! First-paint startup instrumentation.
//!
//! The timer starts at the top of `main`, before the Tauri builder runs.
//! The frontend calls `report_first_paint` once its first frame has been
//! committed (double `requestAnimationFrame`). Both sides are monotonic:
//! `Instant` here, `requestAnimationFrame` there. No wall clocks.

use std::sync::Mutex;
use std::time::Instant;

pub struct StartupTimer {
    launched_at: Instant,
    first_paint_ms: Mutex<Option<u64>>,
}

impl StartupTimer {
    pub fn new() -> Self {
        Self {
            launched_at: Instant::now(),
            first_paint_ms: Mutex::new(None),
        }
    }
}

/// Record the first interactive paint and return elapsed milliseconds
/// since process start. Idempotent: only the first call records; later
/// calls (e.g. a dev-mode reload) return the original measurement.
#[tauri::command]
pub fn report_first_paint(timer: tauri::State<'_, StartupTimer>) -> u64 {
    let mut recorded = timer
        .first_paint_ms
        .lock()
        .expect("startup timer lock poisoned");

    if let Some(elapsed) = *recorded {
        return elapsed;
    }

    let elapsed = timer.launched_at.elapsed().as_millis() as u64;
    *recorded = Some(elapsed);

    // Plain stdout line so dev runs and release smoke checks can grep it.
    println!("startup: first interactive paint after {elapsed} ms");
    elapsed
}
