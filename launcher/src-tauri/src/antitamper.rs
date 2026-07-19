//! Защита самого лаунчера от отладки и подмены во время работы.
//!
//! Античит-DLL защищает процесс ИГРЫ. Этот модуль защищает процесс ЛАУНЧЕРА:
//! если кто-то подключает к лаунчеру отладчик (x64dbg/IDA/CE) или запускает
//! известный инжектор во время работы, лаунчер закрывает игру и завершается,
//! чтобы нельзя было на лету подменить логику авторизации/запуска.

use std::time::Duration;

/// Проверяет, отлаживается ли ПРОЦЕСС ЛАУНЧЕРА прямо сейчас.
#[cfg(windows)]
pub fn debugger_present() -> bool {
    use windows_sys::Win32::Foundation::BOOL;
    use windows_sys::Win32::System::Diagnostics::Debug::{
        CheckRemoteDebuggerPresent, IsDebuggerPresent,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        // 1. Локальный флаг отладки в PEB.
        if IsDebuggerPresent() != 0 {
            return true;
        }
        // 2. Отладчик, подключённый другим процессом (ptrace-подобный).
        let mut present: BOOL = 0;
        if CheckRemoteDebuggerPresent(GetCurrentProcess(), &mut present) != 0 && present != 0 {
            return true;
        }
    }
    false
}

#[cfg(not(windows))]
pub fn debugger_present() -> bool {
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
        if let Some(tool) = crate::security::scan_for_injectors() {
            return Err(format!("Запущен запрещённый инструмент: {tool}. Закройте его и повторите."));
        }
        Ok(())
    }}
}

/// Фоновый сторож. Запускается один раз при старте лаунчера и до конца работы:
///  • ловит подключение отладчика к лаунчеру → закрывает игру и выходит;
///  • ловит запуск инжектора/чит-инструмента во время игры → закрывает игру.
pub fn spawn_guard() {
    std::thread::spawn(|| loop {
        if debugger_present() {
            // К лаунчеру подключились отладчиком — немедленно всё гасим.
            let _ = crate::launcher::kill_game();
            std::process::exit(1);
        }

        // Если во время игры запустили инжектор/CE — закрываем игру.
        if crate::launcher::is_game_running() {
            let cheats = crate::security::scan_running_cheats();
            if !cheats.is_empty() {
                let _ = crate::launcher::kill_game();
            }
        }

        std::thread::sleep(Duration::from_secs(3));
    });
}
