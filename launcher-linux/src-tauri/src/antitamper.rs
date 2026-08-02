//! Защита самого лаунчера от отладки и подмены во время работы (Linux).

use std::time::Duration;
use std::fs;

fn hide_thread() {}

/// Проверяет, отлаживается ли ПРОЦЕСС ЛАУНЧЕРА прямо сейчас.
pub fn debugger_present() -> bool {
    // На Linux можно проверить поле TracerPid в /proc/self/status.
    if let Ok(status) = fs::read_to_string("/proc/self/status") {
        for line in status.lines() {
            if line.starts_with("TracerPid:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() == 2 {
                    if let Ok(pid) = parts[1].parse::<u32>() {
                        if pid != 0 {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

/// Разовая проверка перед запуском игры: не отлаживают ли лаунчер и не запущены
/// ли инструменты реверса/инжекта. Возвращает Err с человекочитаемой причиной.
pub fn preflight() -> Result<(), String> {
    crate::obf_flow! {{
        if debugger_present() {
            return Err(
                "Обнаружен отладчик, подключённый к лаунчеру. Закройте его и перезапустите.".into(),
            );
        }
        let cheats = crate::security::scan_running_cheats();
        if !cheats.is_empty() {
            return Err(format!("Запущен запрещённый инструмент: {}. Закройте его и повторите.", cheats[0]));
        }
        Ok(())
    }}
}

/// Фоновый сторож. Запускается один раз при старте лаунчера и до конца работы:
///  • ловит подключение отладчика к лаунчеру → закрывает игру и выходит;
///  • ловит запуск инжектора/чит-инструмента во время игры → закрывает игру.
pub fn spawn_guard() {
    std::thread::spawn(|| {
        hide_thread();
        loop {
            if debugger_present() {
                let _ = crate::launcher::kill_game();
                std::process::exit(1);
            }

            if crate::launcher::is_game_running() {
                let cheats = crate::security::scan_running_cheats();
                if !cheats.is_empty() {
                    let _ = crate::launcher::kill_game();
                }
            }

            std::thread::sleep(Duration::from_secs(3));
        }
    });
}
