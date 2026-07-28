//! Инжект античит-DLL в процесс игры и внешний монитор процесса.
//!
//! Работает в паре с crate `anticheat-dll` (pe_anticheat.dll):
//!  * лаунчер создаёт именованный канал (named pipe) и генерирует секрет
//!    сессии (session_id + token), передаёт их игре через переменные окружения;
//!  * запускает игру, дожидается процесса Java и инжектит DLL
//!    (VirtualAllocEx + WriteProcessMemory + CreateRemoteThread -> LoadLibraryW);
//!  * DLL подключается к каналу, шлёт подписанные события и heartbeat каждые 5с;
//!  * лаунчер валидирует session/token/seq, отслеживает heartbeat и отправляет
//!    события на сайт (см. `report_events`). Если heartbeat пропал во время игры
//!    (DLL выгрузили/заморозили) — это severe-событие `heartbeat_lost`.
//!
//! Канал named pipe — основной. Если он недоступен, DLL откатывается на файл
//! `PE_AC_REPORT`, который лаунчер тоже читает (резервный путь).
//!
//! Внешние проверки (сканирование сторонних процессов-читов) остаются в
//! `security.rs` и вызываются монитором здесь во время игры.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::auth::launcher_user_agent;
use crate::config::{api_base, load_settings};
use crate::security::scan_running_cheats;

/// Флаг: монитор уже запущен (чтобы не плодить потоки на повторных запусках).
static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

/// Секрет текущей игровой сессии античита. Генерируется перед запуском игры
/// (`prepare_session`) и передаётся процессу игры через переменные окружения,
/// которые наследует инжектнутая DLL. Лаунчер использует те же значения, чтобы
/// проверять подлинность сообщений из канала (защита от подделки отчётов).
struct AcSession {
    pipe_name: String,
    session_id: String,
    token: String,
}

static AC_SESSION: Mutex<Option<AcSession>> = Mutex::new(None);

/// Генерирует новый секрет сессии и возвращает переменные окружения, которые
/// нужно выставить процессу игры. Вызывается из `launcher.rs` ПЕРЕД spawn игры.
pub fn prepare_session() -> Vec<(String, String)> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let token = uuid::Uuid::new_v4().to_string();
    // Имя канала уникально на сессию и не содержит дефисов (упрощает путь pipe).
    let pipe_name = format!("{}{}", crate::obf_str!("\\\\.\\pipe\\pe_ac_"), session_id.replace('-', ""));

    *AC_SESSION.lock().unwrap() = Some(AcSession {
        pipe_name: pipe_name.clone(),
        session_id: session_id.clone(),
        token: token.clone(),
    });

    vec![
        (crate::obf_str!("PE_AC_PIPE"), pipe_name),
        (crate::obf_str!("PE_AC_SESSION"), session_id),
        (crate::obf_str!("PE_AC_TOKEN"), token),
    ]
}

/// Снимок секрета сессии для монитора (клонирует значения под мьютексом).
fn current_session() -> Option<(String, String, String)> {
    AC_SESSION
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| (s.pipe_name.clone(), s.session_id.clone(), s.token.clone()))
}

/// Общее состояние между потоком-читателем канала и циклом монитора.
struct PipeState {
    /// Очередь разобранных событий из канала (kind, detail, source).
    events: Mutex<VecDeque<AcEvent>>,
    /// Время последнего heartbeat (мс с эпохи). 0 — ещё не было.
    last_heartbeat_ms: AtomicU64,
    /// Был ли получен хотя бы один heartbeat/hello (включает контроль пропажи).
    got_heartbeat: AtomicBool,
    /// Число отклонённых сообщений (неверный токен/сессия/повтор seq).
    rejected: AtomicU64,
}

/// Скрытый служебный каталог, замаскированный под системный кэш Windows.
/// DLL и файл-отчёт лежат здесь, а не рядом с лаунчером, поэтому найти их
/// вручную тяжело: путь неочевиден, а каталог помечен hidden+system.
fn stealth_dir() -> PathBuf {
    let base = dirs::data_local_dir()
        .or_else(dirs::cache_dir)
        .unwrap_or_else(|| crate::config::launcher_data_dir());
    // Похоже на реальный системный кэш, не привлекает внимания.
    let dir = base.join("Microsoft").join("Windows").join("INetCache").join("IE");
    let _ = std::fs::create_dir_all(&dir);
    set_hidden(&dir);
    dir
}

/// Путь к файлу-отчёту DLL (скрытый каталог, безобидное имя).
pub fn report_file_path() -> PathBuf {
    stealth_dir().join("webcache.dat")
}

/// Регистрирует событие защиты со стороны ЛАУНЧЕРА (например, стража mods/)
/// в отчёте античита текущей сессии. Монитор (start_monitor) вычитывает файл
/// даже после закрытия игры и пересылает событие на сервер вместе с событиями
/// DLL, поэтому нарушение учитывается в общей системе (см. is_severe).
pub fn report_guard_event(kind: &str, detail: &str) {
    log_local(&report_file_path(), kind, detail);
}

/// Путь к DLL античита в скрытом каталоге под безобидным именем.
/// Расширение для LoadLibraryW не важно — грузится по содержимому PE.
fn anticheat_dll_path() -> PathBuf {
    stealth_dir().join("d3dcache.tmp")
}

/// Помечает файл/каталог как скрытый и системный (только Windows).
#[cfg(windows)]
fn set_hidden(path: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
    };
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);
    }
}

#[cfg(not(windows))]
fn set_hidden(_path: &std::path::Path) {}

/// Байты античит-DLL, вшитые в бинарник лаунчера на этапе компиляции
/// (см. build.rs). Отдельного файла в папке установки нет — DLL существует
/// только внутри .exe, а на диск попадает лишь скрытая рабочая копия.
static EMBEDDED_DLL: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/pe_anticheat.dll"));

/// Расшифровывает вшитую DLL в памяти (XOR с ключом из build.rs).
fn decrypted_dll() -> Vec<u8> {
    let mut data = EMBEDDED_DLL.to_vec();
    for (i, byte) in data.iter_mut().enumerate() {
        *byte ^= (0x42_u8).wrapping_add(i as u8);
    }
    data
}

/// Готовит DLL к инжекту: распаковывает вшитые байты в скрытый каталог под
/// безобидным именем. Файл существует только на время игровой сессии и
/// удаляется в `cleanup_stealth` после закрытия игры.
fn ensure_dll() -> Result<PathBuf, String> {
    if EMBEDDED_DLL.len() < 1024 {
        return Err("Модуль защиты не встроен в сборку".to_string());
    }
    let dst = anticheat_dll_path();
    std::fs::write(&dst, decrypted_dll())
        .map_err(|e| format!("Не удалось подготовить модуль защиты: {e}"))?;
    set_hidden(&dst);
    Ok(dst)
}

/// Удаляет скрытые файлы античита после игровой сес��ии.
fn cleanup_stealth() {
    let _ = std::fs::remove_file(report_file_path());
    // DLL, пока была загружена в игру, удалить нельзя — теперь игра закрыта.
    let _ = std::fs::remove_file(anticheat_dll_path());
}

/// Одно событие античита, отправляемое на сайт.
#[derive(serde::Serialize)]
struct AcEvent {
    kind: String,
    detail: String,
    source: String,
}

/// Отправляет события нарушений на сайт (тот сохраняет их в БД, а Discord-бот
/// постит в канал). Сетевые ошибки проглатываются — античит не должен мешать игре.
async fn report_events(
    token: &str,
    hwid: &str,
    nickname: &str,
    session: &str,
    events: Vec<AcEvent>,
) {
    if events.is_empty() {
        return;
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = client
        .post(format!("{}/api/launcher/anticheat", api_base()))
        .header("User-Agent", launcher_user_agent())
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({
            "hwid": hwid,
            "nickname": nickname,
            "session": session,
            "events": events,
        }))
        .send()
        .await;
}

/// Событие серьёзное — требует немедленного завершения игры (кик).
///
/// Сюда входят однозначные признаки вмешательства: реальный инжект чужого кода,
/// известный чит-модуль, подключённый отладчик, подмена доверенного модуля
/// (DLL hijacking), подтверждённый несколько раз подряд вредоносный оверлей
/// (`overlay_confirmed` — см. риск-модель в DLL) и пропажа heartbeat (DLL
/// выгрузили/заморозили). Остальные события (`overlay_suspicious`,
/// `suspicious_executable_memory`, `suspicious_thread`, `unsigned_module`,
/// `signed_unknown_module`, `temp_module`) — только на ревью, без кика.
fn is_severe(kind: &str) -> bool {
    matches!(
        kind,
        "injected_module"
            | "cheat_module"
            | "debugger"
            | "module_tampered"
            | "overlay_confirmed"
            | "overlay_blocked"
            | "heartbeat_lost"
            // Страж mods/ (launcher.rs): посторонний файл, загруженный игрой,
            // или подмена файла сборки во время сессии.
            | "mods_file_locked"
            | "mods_file_tampered"
    )
}

/// Максимальная пауза между heartbeat до того, как считать клиент подозрительным.
/// DLL шлёт heartbeat каждые 5с; берём запас на GC-паузы JVM и медленные сканы.
const HEARTBEAT_TIMEOUT_MS: u64 = 20_000;

/// Инжектит античит-DLL в процесс игры по его PID (Windows).
#[cfg(windows)]
pub fn inject_into(pid: u32) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W,
        TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32,
    };
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::System::Memory::{
        VirtualAllocEx, MEM_COMMIT, MEM_RESERVE, PAGE_READWRITE,
    };
    use windows_sys::Win32::System::Threading::{
        CreateRemoteThread, OpenProcess, WaitForSingleObject,
        PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION,
        PROCESS_VM_READ, PROCESS_VM_WRITE,
    };

    let dll_path = anticheat_dll_path();
    if !dll_path.exists() {
        return Err("Модуль защиты не загружен".to_string());
    }
    // Защита от подмены (TOCTOU): между записью DLL и её загрузкой файл могли
    // подменить. Прямо перед инжектом сверяем содержимое на диске с эталонными
    // вшитыми байтами и при расхождении восстанавливаем оригинал.
    match std::fs::read(&dll_path) {
        Ok(on_disk) if on_disk == decrypted_dll() => {}
        _ => {
            std::fs::write(&dll_path, decrypted_dll())
                .map_err(|e| format!("Не удалось восстановить модуль защиты: {e}"))?;
            set_hidden(&dll_path);
        }
    }

    // UTF-16 путь к DLL с завершающим нулём — аргумент для LoadLibraryW.
    let wide: Vec<u16> = dll_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let wide_bytes = wide.len() * std::mem::size_of::<u16>();
    let dll_name_lower = dll_path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    unsafe {
        let access = PROCESS_CREATE_THREAD
            | PROCESS_QUERY_INFORMATION
            | PROCESS_VM_OPERATION
            | PROCESS_VM_WRITE
            | PROCESS_VM_READ;
        let proc = OpenProcess(access, FALSE, pid);
        if proc.is_null() {
            return Err("Не удалось открыть процесс игры для защиты".into());
        }

        // Уже инжектнута? (не инжектим по��торно)
        if module_present(pid, &dll_name_lower) {
            CloseHandle(proc);
            return Ok(());
        }

        // Память под путь к DLL в адресном пространстве игры
        let remote = VirtualAllocEx(
            proc,
            std::ptr::null(),
            wide_bytes,
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        );
        if remote.is_null() {
            CloseHandle(proc);
            return Err("Не удалось выделить память в процессе игры".into());
        }

        let mut written = 0usize;
        use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
        if WriteProcessMemory(
            proc,
            remote,
            wide.as_ptr() as *const core::ffi::c_void,
            wide_bytes,
            &mut written,
        ) == 0
        {
            CloseHandle(proc);
            return Err("Не удалось записать данны�� в процесс игры".into());
        }

        // Адрес LoadLibraryW из kernel32 совпадает во всех процессах.
        let kernel32: Vec<u16> = "kernel32.dll".encode_utf16().chain(std::iter::once(0)).collect();
        let k32 = GetModuleHandleW(kernel32.as_ptr());
        if k32.is_null() {
            CloseHandle(proc);
            return Err("kernel32 недоступен".into());
        }
        let load_library = GetProcAddress(k32, b"LoadLibraryW\0".as_ptr());
        if load_library.is_none() {
            CloseHandle(proc);
            return Err("LoadLibraryW недоступен".into());
        }

        let thread = CreateRemoteThread(
            proc,
            std::ptr::null(),
            0,
            Some(std::mem::transmute::<
                _,
                unsafe extern "system" fn(*mut core::ffi::c_void) -> u32,
            >(load_library.unwrap())),
            remote,
            0,
            std::ptr::null_mut(),
        );
        if thread.is_null() {
            CloseHandle(proc);
            return Err("Не удалось создать поток защиты в процессе игры".into());
        }
        // Ждём завершения LoadLibraryW, но с таймаутом: INFINITE рисковал
        // навсегда повесить монитор при deadlock на loader lock процесса игры.
        // LoadLibraryW штатно отрабатывает за миллисекунды; 15с — большой запас.
        const WAIT_TIMEOUT_MS: u32 = 15_000;
        WaitForSingleObject(thread, WAIT_TIMEOUT_MS);
        CloseHandle(thread);
        CloseHandle(proc);
    }

    // helper: проверка наличия модуля в процессе
    #[cfg(windows)]
    unsafe fn module_present(pid: u32, name_lower: &str) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
        if snap == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: MODULEENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
        let mut found = false;
        if Module32FirstW(snap, &mut entry) != 0 {
            loop {
                let len = entry
                    .szModule
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szModule.len());
                let modname = String::from_utf16_lossy(&entry.szModule[..len]).to_lowercase();
                if modname == name_lower {
                    found = true;
                    break;
                }
                if Module32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        found
    }

    Ok(())
}

#[cfg(not(windows))]
pub fn inject_into(_pid: u32) -> Result<(), String> {
    Ok(())
}

/// Проверяет и разбирает одну строку JSON из канала, применяя правила подлинности.
///
/// Возвращает событие для очереди, либо None (служебное/отклонённое). Обновляет
/// heartbeat и счётчик отклонений в общем состоянии.
fn process_pipe_line(
    line: &str,
    expected_session: &str,
    expected_token: &str,
    last_seq: &mut u64,
    validated: &mut bool,
    state: &Arc<PipeState>,
) {
    let val: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    let kind = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if kind.is_empty() {
        return;
    }
    let session = val.get("session").and_then(|v| v.as_str()).unwrap_or("");
    // Сессия обязана совпадать с выданной этому запуску.
    if session != expected_session {
        state.rejected.fetch_add(1, Ordering::Relaxed);
        return;
    }
    // Рукопожатие: проверяем секретный токен. Только после этого доверяем каналу.
    if kind == "hello" {
        let token = val.get("token").and_then(|v| v.as_str()).unwrap_or("");
        if token == expected_token {
            *validated = true;
            state.got_heartbeat.store(true, Ordering::SeqCst);
            state.last_heartbeat_ms.store(now_ms_u64(), Ordering::SeqCst);
        } else {
            state.rejected.fetch_add(1, Ordering::Relaxed);
        }
        return;
    }
    // До успешного рукопожатия остальные сообщения игнорируем.
    if !*validated {
        state.rejected.fetch_add(1, Ordering::Relaxed);
        return;
    }
    // Монотонный seq: повтор или откат — признак подделки/реплея.
    let seq = val.get("seq").and_then(|v| v.as_u64()).unwrap_or(0);
    if seq != 0 && seq <= *last_seq {
        state.rejected.fetch_add(1, Ordering::Relaxed);
        return;
    }
    if seq != 0 {
        *last_seq = seq;
    }

    // heartbeat не пересылаем на сервер — только обновляем «пульс».
    if kind == "heartbeat" {
        state.last_heartbeat_ms.store(now_ms_u64(), Ordering::SeqCst);
        return;
    }

    // Любое валидное сообщение тоже подтверждает, что DLL жива.
    state.last_heartbeat_ms.store(now_ms_u64(), Ordering::SeqCst);

    let detail = val.get("detail").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let source = val.get("src").and_then(|v| v.as_str()).unwrap_or("dll").to_string();
    state.events.lock().unwrap().push_back(AcEvent {
        kind: kind.to_string(),
        detail,
        source,
    });
}

fn now_ms_u64() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Создаёт named pipe и в отдельном потоке принимает подписанные сообщения DLL.
/// Канал создаётся ДО инжекта, чтобы DLL подключилась сразу при загрузке.
#[cfg(windows)]
fn spawn_pipe_server(
    pipe_name: &str,
    session_id: &str,
    token: &str,
    state: Arc<PipeState>,
    stop: Arc<AtomicBool>,
) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    // PIPE_ACCESS_INBOUND лежит в Storage::FileSystem, а не в System::Pipes.
    use windows_sys::Win32::Storage::FileSystem::{ReadFile, PIPE_ACCESS_INBOUND};
    use windows_sys::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
        PIPE_TYPE_BYTE, PIPE_WAIT,
    };

    let wide: Vec<u16> = std::ffi::OsStr::new(pipe_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let session_id = session_id.to_string();
    let token = token.to_string();

    std::thread::spawn(move || {
        // Одно подключение на сессию (nMaxInstances = 1): второй «клиент» с тем
        // же именем не сможет влезть параллельно.
        let handle = unsafe {
            CreateNamedPipeW(
                wide.as_ptr(),
                PIPE_ACCESS_INBOUND,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                0,
                64 * 1024,
                0,
                std::ptr::null(),
            )
        };
        if handle == INVALID_HANDLE_VALUE || handle.is_null() {
            return; // не удалось создать канал — DLL уйдёт в файловый резерв
        }

        // Ждём подключения DLL (или остановки). ConnectNamedPipe блокирующий,
        // поэтому проверку stop делаем после каждого разрыва соединения.
        loop {
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let connected = unsafe { ConnectNamedPipe(handle, std::ptr::null_mut()) };
            // ERROR_PIPE_CONNECTED (уже подключён) тоже считается успехом.
            if connected == 0 {
                let err = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
                const ERROR_PIPE_CONNECTED: i32 = 535;
                if err != ERROR_PIPE_CONNECTED {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                    continue;
                }
            }

            let mut last_seq: u64 = 0;
            let mut validated = false;
            let mut acc = String::new();
            let mut buf = [0u8; 4096];
            loop {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                let mut read: u32 = 0;
                let ok = unsafe {
                    ReadFile(
                        handle,
                        buf.as_mut_ptr(),
                        buf.len() as u32,
                        &mut read,
                        std::ptr::null_mut(),
                    )
                };
                if ok == 0 || read == 0 {
                    break; // клиент отключился / канал разорван
                }
                acc.push_str(&String::from_utf8_lossy(&buf[..read as usize]));
                while let Some(pos) = acc.find('\n') {
                    let line: String = acc.drain(..=pos).collect();
                    let line = line.trim();
                    if !line.is_empty() {
                        process_pipe_line(
                            line,
                            &session_id,
                            &token,
                            &mut last_seq,
                            &mut validated,
                            &state,
                        );
                    }
                }
            }
            unsafe {
                DisconnectNamedPipe(handle);
            }
        }
        unsafe {
            CloseHandle(handle);
        }
    });
}

#[cfg(not(windows))]
fn spawn_pipe_server(
    _pipe_name: &str,
    _session_id: &str,
    _token: &str,
    _state: Arc<PipeState>,
    _stop: Arc<AtomicBool>,
) {
}

/// Запускает фоновый монитор античита на время игры.
///
/// * инжектит DLL в процесс игры;
/// * периодически сканирует сторонние процессы-читы (внешняя проверка);
/// * вычитывает отчёты DLL из файла и отправляет их на сайт.
///
/// `pid` — PID процесса игры (0, если неизвестен: тогда только внешние проверки).
pub fn start_monitor(pid: u32) {
    if MONITOR_RUNNING.swap(true, Ordering::SeqCst) {
        return; // уже работает
    }

    // Свежий файл-отчёт на каждую игровую сессию.
    let report_path = report_file_path();
    let _ = std::fs::remove_file(&report_path);

    std::thread::spawn(move || {
        let settings = load_settings();
        let token = settings.session_token.unwrap_or_default();
        let nickname = settings.nickname.unwrap_or_default();
        let hwid = crate::config::get_or_create_hwid();

        // Секрет сессии выдан в prepare_session() перед запуском игры. Используем
        // тот же session_id для сервера (не более одного «страйка» на сессию) и
        // для валидации сообщений канала. Если по какой-то причине секрета нет
        // (не Windows / игра не через нас) — генерируем разовый.
        let (pipe_name, session_id, pipe_token) = current_session()
            .unwrap_or_else(|| (String::new(), uuid::Uuid::new_v4().to_string(), String::new()));

        // tokio-рантайм для сетевых ��пераций (скачивание DLL, отправка отчётов).
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(_) => {
                MONITOR_RUNNING.store(false, Ordering::SeqCst);
                return;
            }
        };

        // Общее состояние канала + флаг остановки потока-читателя.
        let state = Arc::new(PipeState {
            events: Mutex::new(VecDeque::new()),
            last_heartbeat_ms: AtomicU64::new(0),
            got_heartbeat: AtomicBool::new(false),
            rejected: AtomicU64::new(0),
        });
        let stop = Arc::new(AtomicBool::new(false));

        // Поднимаем named pipe ДО инжекта, чтобы DLL подключилась сразу.
        if !pipe_name.is_empty() {
            spawn_pipe_server(&pipe_name, &session_id, &pipe_token, state.clone(), stop.clone());
        }

        // Готовим скрытую копию DLL и инжектим (Windows, PID известен).
        if pid != 0 {
            match ensure_dll() {
                Ok(_) => match inject_into(pid) {
                    Ok(_) => log_local(&report_path, "inject_ok", "anticheat dll injected"),
                    Err(e) => log_local(&report_path, "inject_failed", &e),
                },
                Err(e) => log_local(&report_path, "dll_prepare_failed", &e),
            }
        }

        let mut last_len: u64 = 0;
        let mut external_reported: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut heartbeat_lost_reported = false;

        loop {
            // Состояние игры фиксируем В НАЧАЛЕ итерации, но НЕ выходим сразу:
            // даже если игра уже закрылась (её мог убить сам античит, чит-краш
            // или сам игрок), нужно дочитать отчёты DLL и отправить последние
            // находки — иначе финальный «injected_module» терялся бы.
            let running = crate::launcher::is_game_running();

            let mut events: Vec<AcEvent> = Vec::new();

            // 1. Внешняя проверка сторонних процессов-читов (пока игра жива).
            if running {
                for proc in scan_running_cheats() {
                    if external_reported.insert(proc.clone()) {
                        events.push(AcEvent {
                            kind: "external_process".into(),
                            detail: proc,
                            source: "launcher".into(),
                        });
                    }
                }
            }

            // 2. События из канала (основной путь): очередь наполняет поток-читатель.
            {
                let mut q = state.events.lock().unwrap();
                while let Some(ev) = q.pop_front() {
                    events.push(ev);
                }
            }

            // 3. Резервный файл-отчёт DLL (если канал был недоступен). heartbeat/
            //    hello из файла не пересылаем — используем как «пульс».
            if let Ok(content) = std::fs::read_to_string(&report_path) {
                let len = content.len() as u64;
                if len > last_len {
                    let fresh = &content[last_len as usize..];
                    for line in fresh.lines() {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        if let Some(ev) = parse_dll_line(line) {
                            if ev.kind == "heartbeat" || ev.kind == "hello" {
                                state.got_heartbeat.store(true, Ordering::SeqCst);
                                state.last_heartbeat_ms.store(now_ms_u64(), Ordering::SeqCst);
                                continue;
                            }
                            events.push(ev);
                        }
                    }
                    last_len = len;
                }
            }

            // 4. Контроль heartbeat: если DLL хоть раз выходила на связь, но
            //    «пульс» пропал во время игры — DLL выгрузили/заморозили.
            if running
                && !heartbeat_lost_reported
                && state.got_heartbeat.load(Ordering::SeqCst)
            {
                let last = state.last_heartbeat_ms.load(Ordering::SeqCst);
                if last != 0 && now_ms_u64().saturating_sub(last) > HEARTBEAT_TIMEOUT_MS {
                    heartbeat_lost_reported = true;
                    events.push(AcEvent {
                        kind: "heartbeat_lost".into(),
                        detail: format!(
                            "anticheat heartbeat lost for >{}s (dll unloaded/frozen)",
                            HEARTBEAT_TIMEOUT_MS / 1000
                        ),
                        source: "launcher".into(),
                    });
                }
            }

            // Есть ли среди новых событий серьёзное (инже��т/чит/подмена/оверлей/пульс)?
            let severe = events.iter().any(|e| is_severe(&e.kind));

            // Отправляем находки на сайт. Здесь ждём завершения запроса, чтобы
            // при последующем kill_game/выходе отчёт гарантированно ушёл.
            if !events.is_empty() && !token.is_empty() {
                rt.block_on(report_events(&token, &hwid, &nickname, &session_id, events));
            }

            // Обнаружено серьёзное нарушение — немедленно выкидываем игрока.
            if severe {
                let _ = crate::launcher::kill_game();
                break;
            }

            // Игра закрыта — финальный отчёт уже отправлен выше, выходим.
            if !running {
                break;
            }

            // Частый опрос: инжект ловится почти мгновенно, а не раз в 5 секунд.
            std::thread::sleep(std::time::Duration::from_millis(1200));
        }

        // Останавливаем поток-читатель канала и убираем скрытые файлы античита.
        stop.store(true, Ordering::SeqCst);
        cleanup_stealth();
        MONITOR_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Пишет локальное служе��ное событие в файл-отчёт (чтобы оно тоже улетело на сайт).
fn log_local(path: &std::path::Path, kind: &str, detail: &str) {
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let esc = detail.replace('\\', "\\\\").replace('"', "\\\"");
    let line = format!("{{\"type\":\"{kind}\",\"detail\":\"{esc}\",\"ts\":{ts},\"src\":\"launcher\"}}\n");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

/// Разбирает строку JSON, записанную DLL, в событие для отправки.
/// Формат: {"type":"...","detail":"...","ts":..,"src":".."}
fn parse_dll_line(line: &str) -> Option<AcEvent> {
    let val: serde_json::Value = serde_json::from_str(line).ok()?;
    let kind = val.get("type")?.as_str()?.to_string();
    let detail = val
        .get("detail")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let source = val
        .get("src")
        .and_then(|v| v.as_str())
        .unwrap_or("dll")
        .to_string();
    Some(AcEvent {
        kind,
        detail,
        source,
    })
}
