// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::process::Command;

#[tauri::command]
fn get_cli_args() -> Vec<String> {
    std::env::args().collect()
}

/// Get the current working directory of the Monitor process.
/// Used as fallback when --cwd CLI arg is not provided.
#[tauri::command]
fn get_cwd() -> Option<String> {
    std::env::current_dir().ok().map(|p| p.to_string_lossy().to_string())
}

/// Write debug log lines to %TEMP%\monitor-debug.log (for release builds without devtools)
#[tauri::command]
fn write_debug_log(lines: String) -> Result<String, String> {
    use std::io::Write;
    let log_path = std::env::temp_dir().join("monitor-debug.log");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open log: {}", e))?;
    file.write_all(lines.as_bytes())
        .map_err(|e| format!("Failed to write log: {}", e))?;
    Ok("Log written".to_string())
}

/// Discover OpenCode instances by finding processes and their listening ports.
/// Scans for: opencode.exe, Zed.exe children, node.exe with opencode in cmdline.
/// Also includes HTTP port scan fallback for 4096-4500 range.
#[tauri::command]
fn discover_opencode_ports() -> Vec<u32> {
    let mut ports = Vec::new();

    // Strategy 1: Find PIDs of opencode-related processes
    // - opencode.exe (direct install)
    // - node.exe (npx opencode or npm opencode)
    let mut candidate_pids: Vec<u32> = Vec::new();

    // Find opencode.exe processes
    let tasklist = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output();
    if let Ok(output) = tasklist {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 2 {
                let name = parts[0].trim_matches('"');
                let pid = parts[1].trim_matches('"').parse::<u32>().ok();
                if let Some(pid) = pid {
                    if name.eq_ignore_ascii_case("opencode.exe") {
                        candidate_pids.push(pid);
                    }
                    // For node.exe, we can't easily check cmdline via tasklist
                    // so we include ALL node.exe PIDs — netstat will filter
                    // by whether they have listening ports in OpenCode range
                    if name.eq_ignore_ascii_case("node.exe") {
                        candidate_pids.push(pid);
                    }
                }
            }
        }
    }

    // Strategy 2: Find Zed.exe child processes using wmic
    // Zed spawns OpenCode as child processes via ACP
    let wmic = Command::new("wmic")
        .args(["process", "where", "ParentProcessId=", "get", "ProcessId,Name"])
        .output();
    // Also try: find all Zed PIDs first, then get their children
    let zed_pids: Vec<u32> = {
        let mut zed = Vec::new();
        let tl = Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq Zed.exe", "/FO", "CSV", "/NH"])
            .output();
        if let Ok(output) = tl {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    if let Ok(pid) = parts[1].trim_matches('"').parse::<u32>() {
                        zed.push(pid);
                    }
                }
            }
        }
        zed
    };
    // Get child processes of each Zed PID
    for zed_pid in &zed_pids {
        let wmic_child = Command::new("wmic")
            .args(["process", "where", &format!("ParentProcessId={}", zed_pid), "get", "ProcessId"])
            .output();
        if let Ok(output) = wmic_child {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if let Ok(pid) = trimmed.parse::<u32>() {
                    if pid != *zed_pid && !candidate_pids.contains(&pid) {
                        candidate_pids.push(pid);
                    }
                }
            }
        }
    }

    // Strategy 3: netstat — find listening ports for candidate PIDs
    let netstat = Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output();
    if let Ok(output) = netstat {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if !trimmed.contains("LISTENING") {
                continue;
            }
            let pid = trimmed.split_whitespace().last().and_then(|s| s.parse::<u32>().ok());
            if let Some(pid) = pid {
                // Check if this PID is in our candidate list
                if !candidate_pids.contains(&pid) {
                    continue;
                }
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

    // Strategy 4: HTTP port scan fallback for common OpenCode range
    // This catches instances that weren't found via process scan
    // (e.g. different process names, WSL, Docker, etc.)
    // Scan 4096-4500 in parallel-ish fashion (sequential but fast)
    // Only scan ports we don't already have
    let scan_range: Vec<u32> = (4096..=4500)
        .filter(|p| !ports.contains(p))
        .collect();
    for port in scan_range {
        // Use a very short timeout connection attempt
        let addr = format!("127.0.0.1:{}", port);
        if let Ok(stream) = std::net::TcpStream::connect_timeout(
            &addr.parse().unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], 4096))),
            std::time::Duration::from_millis(50),
        ) {
            drop(stream);
            // Port is open — add it (the frontend will verify via /global/health)
            if !ports.contains(&port) {
                ports.push(port);
            }
        }
    }

    ports.sort();
    ports.dedup();
    ports
}

/// Set a user-level environment variable using setx (async, non-blocking).
/// Uses .spawn() instead of .output() to avoid blocking the UI thread.
#[tauri::command]
fn set_env_var(name: String, value: String) -> Result<String, String> {
    if name.is_empty() {
        return Err("Environment variable name cannot be empty".to_string());
    }
    if value.is_empty() {
        return Err("Environment variable value cannot be empty".to_string());
    }

    // Use .spawn() for non-blocking execution — setx.exe runs in background
    Command::new("setx")
        .args([&name, &value])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| format!("Environment variable {} set", name))
        .map_err(|e| format!("Failed to spawn setx: {}", e))
}

/// Get a user-level environment variable value.
#[tauri::command]
fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

/// Delete a user-level environment variable from the Windows registry.
#[tauri::command]
fn delete_env_var(name: String) -> Result<String, String> {
    if name.is_empty() {
        return Err("Environment variable name cannot be empty".to_string());
    }
    let result = Command::new("reg")
        .args(["delete", "HKCU\\Environment", "/v", &name, "/f"])
        .output();
    match result {
        Ok(output) => {
            if output.status.success() {
                Ok(format!("Environment variable {} deleted", name))
            } else {
                Ok(format!("Environment variable {} not found (already clean)", name))
            }
        }
        Err(e) => Err(format!("Failed to execute reg delete: {}", e)),
    }
}

/// Find the Zed executable path by checking common locations.
fn find_zed_path() -> Option<String> {
    let candidates = [
        "C:\\Program Files\\Zed\\zed.exe",
        "C:\\Users\\user\\AppData\\Local\\Programs\\Zed\\zed.exe",
    ];

    // Check APPDATA\Local\Programs\Zed (most common for per-user install)
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let path = format!("{}\\Programs\\Zed\\zed.exe", local_app_data);
        if std::path::Path::new(&path).exists() {
            return Some(path);
        }
    }

    // Check Program Files
    for candidate in &candidates {
        if std::path::Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }

    // Try PATH
    let result = Command::new("where")
        .args(["zed.exe"])
        .output();
    if let Ok(output) = result {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout);
            let first_line = path.lines().next()?.trim();
            if !first_line.is_empty() {
                return Some(first_line.to_string());
            }
        }
    }

    None
}

/// Restart Zed and Monitor using a detached batch script.
///
/// This solves the problem where Monitor is a child process of Zed (started via Zed task).
/// When Zed is killed, Monitor dies too. The batch script runs as a completely separate
/// process, survives the Zed kill, and restarts both Zed and Monitor.
///
/// Flow:
/// 1. Write a batch script to %TEMP%\restart-monitor.bat
/// 2. Launch it with `cmd /c start` (completely detached, non-blocking)
/// 3. Script waits 2 seconds, kills Zed, waits 1 second, starts Zed + Monitor
/// 4. Monitor and Zed both restart with fresh state
#[tauri::command]
fn restart_zed_and_monitor() -> Result<String, String> {
    let zed_path = find_zed_path()
        .ok_or_else(|| "Could not find Zed executable. Please restart Zed manually.".to_string())?;

    let temp_dir = std::env::temp_dir();
    let script_path = temp_dir.join("restart-monitor.bat");

    // Build the batch script (only restarts Zed, not Monitor —
    // Monitor should be started via Zed task Ctrl+Shift+M to inherit cwd)
    // Use ping for delays instead of timeout — timeout depends on the console
    // and may be killed when the parent console (Zed) is terminated.
    // ping is a standalone process that doesn't depend on console lifetime.
    let script = format!(
        r#"@echo off
ping 127.0.0.1 -n 3 >nul
taskkill /F /IM Zed.exe >nul 2>&1
ping 127.0.0.1 -n 2 >nul
start "" "{zed_path}"
del "%~f0"
"#,
        zed_path = zed_path,
    );

    // Write the script
    std::fs::write(&script_path, &script)
        .map_err(|e| format!("Failed to write restart script: {}", e))?;

    // Launch the script as a completely detached process
    // Zed uses Windows Job Objects with KILL_ON_JOB_CLOSE — when Zed is killed,
    // all processes in the job (including Monitor and its children) are killed.
    // CREATE_BREAKAWAY_FROM_JOB breaks the new process away from the job.
    // If BREAKAWAY fails (access denied), fall back to DETACHED_PROCESS only.
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
    let launch_result = Command::new("cmd")
        .args(["/c", "start", "", "/MIN", &script_path.to_string_lossy()])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB)
        .spawn();
    if launch_result.is_err() {
        // Retry without BREAKAWAY — may fail with access denied
        Command::new("cmd")
            .args(["/c", "start", "", "/MIN", &script_path.to_string_lossy()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS)
            .spawn()
            .map_err(|e| format!("Failed to launch restart script: {}", e))?;
    }

    Ok(format!(
        "Restart sequence initiated. Zed: {}",
        zed_path
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
            get_cwd,
            discover_opencode_ports,
            restart_zed_and_monitor,
            set_env_var,
            get_env_var,
            delete_env_var,
            write_debug_log
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
