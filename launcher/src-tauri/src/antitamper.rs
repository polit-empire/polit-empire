//! Защита самого лаунчера от отладки и подмены во время работы.
//!
//! Античит-DLL защищает процесс ИГРЫ. Этот модуль защищает процесс ЛАУНЧЕРА:
//! если кто-то подключает к лаунчеру отладчик (x64dbg/IDA/CE) или запускает
//! известный инжектор во время работы, лаунчер закрывает игру и завершается,
//! чтобы нельзя было на лету подменить логику авторизации/запуска.

use std::time::Duration;

#[cfg(windows)]
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleA, GetProcAddress};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetCurrentThread};

#[cfg(windows)]
unsafe fn get_api<T>(module: &[u8], func: &[u8]) -> Option<T> {
    let handle = GetModuleHandleA(module.as_ptr());
    if handle.is_null() {
        return None;
    }
    let addr = GetProcAddress(handle, func.as_ptr());
    if addr.is_none() {
        return None;
    }
    Some(std::mem::transmute_copy(&addr))
}

#[cfg(windows)]
fn hide_thread() {
    use windows_sys::Win32::Foundation::HANDLE;
    // NtSetInformationThread(ThreadHandle, ThreadHideFromDebugger = 0x11, NULL, 0)
    type NtSetInformationThreadFn = unsafe extern "system" fn(HANDLE, u32, *const core::ffi::c_void, u32) -> i32;
    unsafe {
        let module = crate::obf_str!("ntdll.dll\0");
        let func = crate::obf_str!("NtSetInformationThread\0");
        if let Some(nt_set) = get_api::<NtSetInformationThreadFn>(module.as_bytes(), func.as_bytes()) {
            nt_set(GetCurrentThread(), 0x11, std::ptr::null(), 0);
        }
    }
}
#[cfg(not(windows))]
fn hide_thread() {}

/// Проверяет, отлаживается ли ПРОЦЕСС ЛАУНЧЕРА прямо сейчас.
#[cfg(windows)]
pub fn debugger_present() -> bool {
    use windows_sys::Win32::Foundation::{BOOL, HANDLE};
    use windows_sys::Win32::System::Diagnostics::Debug::IsDebuggerPresent;
    use std::arch::asm;

    unsafe {
        // 1. Стандартная API IsDebuggerPresent
        if IsDebuggerPresent() != 0 {
            return true;
        }

        // 2. Прямое чтение флага BeingDebugged из PEB (x64)
        let mut being_debugged: u8 = 0;
        asm!(
            "mov {peb}, gs:[0x60]",
            "mov {dbg}, [{peb} + 2]",
            peb = out(reg) _,
            dbg = out(reg_byte) being_debugged,
        );
        if being_debugged != 0 {
            return true;
        }

        // 3. Динамический вызов CheckRemoteDebuggerPresent (прячем от IAT)
        type CheckRemoteDebuggerPresentFn = unsafe extern "system" fn(HANDLE, *mut BOOL) -> BOOL;
        let module = crate::obf_str!("kernel32.dll\0");
        let func = crate::obf_str!("CheckRemoteDebuggerPresent\0");
        if let Some(check_remote) = get_api::<CheckRemoteDebuggerPresentFn>(module.as_bytes(), func.as_bytes()) {
            let mut present: BOOL = 0;
            if check_remote(GetCurrentProcess(), &mut present) != 0 && present != 0 {
                return true;
            }
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
    std::thread::spawn(|| {
        hide_thread();
        loop {
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
        }
    });
}
