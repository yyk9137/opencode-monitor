// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::process::Command;

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

/// Discover OpenCode instances by finding opencode processes and their listening ports.
/// Returns a list of port numbers that opencode processes are listening on.
#[tauri::command]
fn discover_opencode_ports() -> Vec<u32> {
    let mut ports = Vec::new();

    // Step 1: Find PIDs of opencode processes
    let tasklist = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq opencode.exe", "/FO", "CSV", "/NH"])
        .output();

    let opencode_pids: Vec<u32> = match tasklist {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .filter_map(|line| {
                    // CSV format: "opencode.exe","1234","Console","1","12,345 KB"
                    let parts: Vec<&str> = line.split(',').collect();
                    if parts.len() >= 2 {
                        let pid_str = parts[1].trim_matches('"');
                        pid_str.parse::<u32>().ok()
                    } else {
                        None
                    }
                })
                .collect()
        }
        Err(_) => Vec::new(),
    };

    if opencode_pids.is_empty() {
        return ports;
    }

    // Step 2: Find listening ports for those PIDs using netstat
    let netstat = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output();

    if let Ok(output) = netstat {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            // Format: "  TCP    127.0.0.1:4096      0.0.0.0:0   LISTENING   1234"
            let trimmed = line.trim();
            if !trimmed.contains("LISTENING") {
                continue;
            }
            // Extract PID (last column)
            let pid = trimmed.split_whitespace().last().and_then(|s| s.parse::<u32>().ok());
            if let Some(pid) = pid {
                if !opencode_pids.contains(&pid) {
                    continue;
                }
                // Extract port from local address (format: 127.0.0.1:PORT or 0.0.0.0:PORT)
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Some(colon_idx) = parts[1].rfind(':') {
                        if let Ok(port) = parts[1][colon_idx + 1..].parse::<u32>() {
                            if port > 1024 && !ports.contains(&port) {
                                ports.push(port);
                            }
                        }
                    }
                }
            }
        }
    }

    ports.sort();
    ports
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![get_cli_args, discover_opencode_ports])
        .setup(|app| {
            // Open devtools automatically in debug builds for diagnostics
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
