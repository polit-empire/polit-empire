//! Упрощенный античит-монитор для Linux.
//! Инжект DLL и чтение пайпов вырезаны, так как они специфичны для Windows.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::security::scan_running_cheats;
use crate::launcher::is_game_running;

static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn prepare_session() -> Vec<(String, String)> {
    // Без DLL передавать переменные окружения не нужно.
    vec![]
}

pub fn spawn_ac_monitor() {
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        // Даём игре время запуститься.
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;

        loop {
            if !is_game_running() {
                break;
            }

            // Периодическое сканирование запущенных процессов-читов.
            if let Some(cheat) = scan_running_cheats() {
                crate::telemetry::report_launcher_log(
                    "error",
                    &format!("Античит: Обнаружен запрещённый процесс ({cheat})"),
                );
                let _ = crate::launcher::kill_game();
                break;
            }

            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        }

        MONITOR_RUNNING.store(false, Ordering::SeqCst);
    });
}

pub fn ensure_dll() -> Result<std::path::PathBuf, String> {
    // Заглушка, инжект DLL на Linux вырезан.
    Ok(std::path::PathBuf::from("/dev/null"))
}

pub fn inject_dll(_pid: u32, _dll_path: &std::path::Path) -> Result<(), String> {
    // Заглушка, инжект DLL на Linux вырезан.
    Ok(())
}
