use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

pub struct SidecarState {
    child: Mutex<Option<Child>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: AtomicU64,
    stdin_writer: Mutex<Option<std::process::ChildStdin>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
            stdin_writer: Mutex::new(None),
        }
    }
}

pub fn start_sidecar(app: &AppHandle, state: &SidecarState) -> Result<(), String> {
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let sidecar_path = resource_path.join("sidecar").join("bin.js");

    let sidecar_script = if sidecar_path.exists() {
        sidecar_path.to_string_lossy().to_string()
    } else {
        // Dev mode: look relative to the src-tauri directory
        let dev_path = std::env::current_dir()
            .unwrap_or_default()
            .join("sidecar")
            .join("bin.js");
        if dev_path.exists() {
            dev_path.to_string_lossy().to_string()
        } else {
            // Fallback: try workspace path
            let workspace_path = std::env::current_dir()
                .unwrap_or_default()
                .parent()
                .and_then(|p| p.parent())
                .map(|p| p.join("packages").join("api-server").join("dist").join("bin.js"));
            match workspace_path {
                Some(p) if p.exists() => p.to_string_lossy().to_string(),
                _ => return Err("Could not find sidecar bin.js".to_string()),
            }
        }
    };

    let mut child = Command::new("node")
        .arg(&sidecar_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}. Is Node.js installed?", e))?;

    let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

    *state.stdin_writer.lock().unwrap() = Some(stdin);

    let pending = state.pending.clone();
    let app_handle = app.clone();

    // Stdout reader thread — JSON-RPC responses and notifications
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };

            let parsed: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(id) = parsed.get("id").and_then(|v| v.as_u64()) {
                // Response - resolve pending request
                let mut pending_map = pending.lock().unwrap();
                if let Some(sender) = pending_map.remove(&id) {
                    let _ = sender.send(parsed);
                }
            } else if parsed.get("method").is_some() {
                // Notification - emit to frontend
                let _ = app_handle.emit("sidecar:notification", &parsed);
            }
        }
    });

    // Stderr reader thread — raw text lines for logging
    {
        let stderr_app_handle = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let line = match line {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let _ = stderr_app_handle.emit("sidecar:stderr", &line);
            }
        });
    }

    *state.child.lock().unwrap() = Some(child);
    Ok(())
}

pub fn stop_sidecar(state: &SidecarState) -> Result<(), String> {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    *state.stdin_writer.lock().unwrap() = None;
    state.pending.lock().unwrap().clear();
    Ok(())
}

pub async fn rpc_call(
    state: &SidecarState,
    method: String,
    params: Value,
) -> Result<Value, String> {
    let id = state.next_id.fetch_add(1, Ordering::SeqCst);

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });

    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(id, tx);

    {
        let mut writer_guard = state.stdin_writer.lock().unwrap();
        let writer = writer_guard
            .as_mut()
            .ok_or("Sidecar not running")?;
        let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        writer
            .write_all(line.as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {}", e))?;
        writer
            .write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush: {}", e))?;
    }

    let response = rx
        .await
        .map_err(|_| "Sidecar response channel closed")?;

    if let Some(error) = response.get("error") {
        Err(format!(
            "RPC error: {}",
            error
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
        ))
    } else {
        Ok(response
            .get("result")
            .cloned()
            .unwrap_or(Value::Null))
    }
}
