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

/// Set a user-level environment variable on Windows using setx.
/// The variable persists across reboots and is available to new processes.
#[tauri::command]
fn set_env_var(name: String, value: String) -> Result<String, String> {
    // Validate inputs
    if name.is_empty() {
        return Err("Environment variable name cannot be empty".to_string());
    }
    if value.is_empty() {
        return Err("Environment variable value cannot be empty".to_string());
    }

    // Use setx to set a user-level environment variable
    // setx sets the variable in the registry (HKCU\Environment) and broadcasts WM_SETTINGCHANGE
    // Note: setx truncates values to 1024 chars, but API keys are typically much shorter
    let result = Command::new("setx")
        .args([&name, &value])
        .output();

    match result {
        Ok(output) => {
            if output.status.success() {
                Ok(format!("Environment variable {} set successfully", name))
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                Err(format!("setx failed: {} {}", stdout, stderr))
            }
        }
        Err(e) => Err(format!("Failed to execute setx: {}", e)),
    }
}

/// Get a user-level environment variable value.
#[tauri::command]
fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

/// Kill Zed process and relaunch it, so OpenCode restarts with new config.
#[tauri::command]
fn restart_zed() -> Result<String, String> {
    // Kill all Zed processes
    let kill_result = Command::new("taskkill")
        .args(["/F", "/IM", "Zed.exe"])
        .output();

    match kill_result {
        Ok(output) => {
            if !output.status.success() {
                // Zed might not be running, that's ok
            }
        }
        Err(e) => {
            return Err(format!("Failed to kill Zed: {}", e));
        }
    }

    // Wait a moment for processes to die
    std::thread::sleep(std::time::Duration::from_secs(1));

    // Relaunch Zed (detached, non-blocking)
    let zed_paths = [
        "C:\\Program Files\\Zed\\zed.exe",
        "C:\\Users\\user\\AppData\\Local\\Programs\\Zed\\zed.exe",
        "zed.exe",
    ];

    let mut launched = false;
    for path in &zed_paths {
        let result = Command::new(path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        if result.is_ok() {
            launched = true;
            break;
        }
    }

    if launched {
        Ok("Zed restarted successfully".to_string())
    } else {
        Err("Could not find Zed executable. Please restart Zed manually.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![get_cli_args, discover_opencode_ports, restart_zed, set_env_var, get_env_var])
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
