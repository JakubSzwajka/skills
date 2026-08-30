//! Image Gen application library. The binary in `main.rs` only calls
//! [`run`]; integration tests link against these modules directly.

pub mod cli;
pub mod commands;
pub mod domain;
pub mod generation;
pub mod library;
pub mod paths;
pub mod references;
pub mod settings;
pub mod startup;
pub mod state;

use tauri::Manager;

/// Accept a forwarded or startup CLI request. Before bootstrap it is
/// queued; afterwards it becomes a tracked batch immediately.
fn accept_cli_request(state: &state::AppState, args: &[String]) {
    match cli::parse(args) {
        None => {}
        Some(Err(reason)) => tracing::warn!("ignored malformed CLI request: {reason}"),
        Some(Ok(request)) => match state.get() {
            Ok(core) => {
                if let Err(reason) = core.service.create_batch(request.into_input()) {
                    tracing::warn!("CLI batch rejected: {reason}");
                }
            }
            Err(_) => state.push_pending(request),
        },
    }
}

pub fn run() {
    // Capture the process-start instant before any framework work.
    let timer = startup::StartupTimer::new();

    // A direct launch may itself carry a generation request.
    let own_args: Vec<String> = std::env::args().skip(1).collect();
    let app_state = match cli::parse(&own_args) {
        Some(Ok(request)) => state::AppState::with_pending(vec![request]),
        _ => state::AppState::default(),
    };

    tauri::Builder::default()
        // Registered first so a second launch is handled before anything else.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // args[0] is the second process's binary path.
            let forwarded: Vec<String> = args.into_iter().skip(1).collect();
            accept_cli_request(&app.state::<state::AppState>(), &forwarded);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(timer)
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            startup::report_first_paint,
            commands::bootstrap,
            commands::create_batch,
            commands::cancel_job,
            commands::retry_job,
            commands::load_history_page,
            commands::import_reference,
            commands::update_settings,
            commands::copy_image,
            commands::reveal_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Image Gen");
}
