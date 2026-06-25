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

/// Trigger OpenCode restart by updating a timestamp env var in Zed's settings.json.
/// Zed detects the agent_servers settings change and automatically reconnects,
/// spawning a fresh OpenCode process with the updated config.
/// This does NOT kill Zed — it stays running, only the ACP connection restarts.
#[tauri::command]
fn restart_opencode_via_zed() -> Result<String, String> {
    use std::io::{Read, Write};

    // Locate Zed settings.json
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
    let settings_path = std::path::PathBuf::from(&appdata)
        .join("Zed")
        .join("settings.json");

    if !settings_path.exists() {
        return Err(format!("Zed settings.json not found at {:?}", settings_path));
    }

    // Read the raw file content (JSONC — preserve comments)
    let mut content = String::new();
    {
        let mut file = std::fs::File::open(&settings_path)
            .map_err(|e| format!("Failed to open settings.json: {}", e))?;
        file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;
    }

    // Generate timestamp (Unix epoch milliseconds)
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string());

    // We need to update agent_servers.OpenCode.env.MONITOR_CONFIG_UPDATED_AT
    // Strategy:
    // 1. If MONITOR_CONFIG_UPDATED_AT already exists → replace its value
    // 2. If "env": {} exists → replace with env containing the timestamp
    // 3. If "env": {} doesn't exist → error (user needs to configure agent_servers first)

    let new_env = format!(
        "\"env\": {{ \"MONITOR_CONFIG_UPDATED_AT\": \"{}\" }}",
        timestamp
    );

    let updated = if content.contains("MONITOR_CONFIG_UPDATED_AT") {
        // Replace existing timestamp value
        // Find: "MONITOR_CONFIG_UPDATED_AT": "old_value"
        // Replace with: "MONITOR_CONFIG_UPDATED_AT": "new_timestamp"
        let key = "\"MONITOR_CONFIG_UPDATED_AT\"";
        if let Some(pos) = content.find(key) {
            let rest = &content[pos..];
            // Find the colon after the key
            if let Some(colon_pos) = rest.find(':') {
                let after_colon = &rest[colon_pos + 1..];
                // Find the opening quote of the value
                if let Some(q1) = after_colon.find('"') {
                    let after_q1 = &after_colon[q1 + 1..];
                    // Find the closing quote
                    if let Some(q2) = after_q1.find('"') {
                        let abs_start = pos + colon_pos + 1 + q1 + 1;
                        let abs_end = pos + colon_pos + 1 + q1 + 1 + q2;
                        content.replace_range(abs_start..abs_end, &timestamp);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            }
        } else {
            false
        }
    } else if content.contains("\"env\": {}") {
        // Replace empty env object (with space)
        content = content.replacen("\"env\": {}", &new_env, 1);
        true
    } else if content.contains("\"env\":{}") {
        // Replace empty env object (no space)
        content = content.replacen("\"env\":{}", &new_env, 1);
        true
    } else {
        false
    };

    if !updated {
        return Err(
            "Could not find env object in agent_servers.OpenCode to update. \
             Please ensure Zed settings.json has agent_servers.OpenCode.env configured."
                .to_string(),
        );
    }

    // Write back (UTF-8 without BOM)
    {
        let mut file = std::fs::File::create(&settings_path)
            .map_err(|e| format!("Failed to create settings.json: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write settings.json: {}", e))?;
    }

    // Verify no BOM was written
    let verify = std::fs::read(&settings_path)
        .map_err(|e| format!("Failed to verify: {}", e))?;
    if verify.len() >= 3 && verify[0] == 0xEF && verify[1] == 0xBB && verify[2] == 0xBF {
        std::fs::write(&settings_path, &verify[3..])
            .map_err(|e| format!("Failed to strip BOM: {}", e))?;
    }

    Ok(format!(
        "Updated MONITOR_CONFIG_UPDATED_AT to {}, Zed will auto-reconnect OpenCode",
        timestamp
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_cli_args,
            discover_opencode_ports,
            restart_opencode_via_zed,
            set_env_var,
            get_env_var
        ])
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
