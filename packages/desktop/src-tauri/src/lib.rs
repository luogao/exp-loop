mod sidecar;

use sidecar::SidecarState;
use serde_json::Value;
use tauri::Manager;

#[tauri::command]
async fn rpc_call(
    state: tauri::State<'_, SidecarState>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    sidecar::rpc_call(&state, method, params).await
}

#[tauri::command]
fn start_sidecar_cmd(
    app: tauri::AppHandle,
    state: tauri::State<'_, SidecarState>,
) -> Result<(), String> {
    sidecar::start_sidecar(&app, &state)
}

#[tauri::command]
fn stop_sidecar_cmd(state: tauri::State<'_, SidecarState>) -> Result<(), String> {
    sidecar::stop_sidecar(&state)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState::new())
        .invoke_handler(tauri::generate_handler![
            rpc_call,
            start_sidecar_cmd,
            stop_sidecar_cmd,
        ])
        .setup(|app| {
            let state = app.state::<SidecarState>();
            if let Err(e) = sidecar::start_sidecar(app.handle(), &state) {
                eprintln!("Warning: Failed to start sidecar: {}", e);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
