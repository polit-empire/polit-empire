//! Внутрипроцессный античит Polit Empire.
//!
//! Эта библиотека компилируется в `pe_anticheat.dll` и инжектится лаунчером
//! в процесс игры (JVM). Работая ВНУТРИ процесса, она видит то, что снаружи
//! почти не видно: реально загруженные модули (DLL), исполняемую память вне
//! модулей (manual map / shellcode), чужие потоки, подключённый отладчик и т.п.
//!
//! Канал связи с лаунчером — именованный канал (named pipe). Каждое сообщение
//! подписано (session_id + token + монотонный seq + nonce), а раз в 5 секунд
//! шлётся heartbeat. Если heartbeat пропал, лаунчер считает клиент
//! подозрительным (DLL выгрузили/заморозили). Если канал недоступен, DLL
//! откатывается на файл `PE_AC_REPORT` (резервный, менее защищённый путь).

#![allow(clippy::missing_safety_doc)]

/// Компайл-тайм обфускация строк.
///
/// Чувствительные строки античита (сигнатуры читов, имена инструментов реверса,
/// имена ENV/API секретного канала) НЕ должны лежать в `pe_anticheat.dll`
/// открытым текстом — иначе их находят через `strings` и обходят проверки.
/// Ключевой поток генерируется финализатором splitmix64: на каждую позицию свой
/// псевдослучайный байт без короткого периода. `obfuscate()` — `const fn`, поэтому
/// в бинарник попадают только зашифрованные байты, а расшифровка идёт в рантайме.
#[allow(dead_code)]
mod obf {
    const SEED_A: u64 = 0x50E5_1A7C;
    const SEED_B: u64 = 0x9B34_6F21;

    #[inline(always)]
    const fn base_seed() -> u64 {
        (SEED_A << 32) ^ SEED_B ^ 0xA5A5_5A5A_C3C3_3C3C
    }

    /// Финализатор splitmix64 — псевдослучайный байт гаммы, зависящий от позиции.
    #[inline(always)]
    const fn mix(seed: u64, i: usize) -> u8 {
        let mut z =
            seed.wrapping_add((i as u64).wrapping_add(1).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z & 0xFF) as u8
    }

    /// Уникальный ключ на call-site (строка+столбец места вызова).
    #[inline(always)]
    pub const fn seed(line: u32, col: u32) -> u64 {
        let mixed = ((line as u64) << 21)
            ^ ((col as u64) << 3)
            ^ (line as u64).wrapping_mul((col as u64).wrapping_add(1));
        base_seed() ^ mixed
    }

    /// Компайл-тайм шифрование строкового литерала.
    pub const fn obfuscate<const N: usize>(s: &str, seed: u64) -> [u8; N] {
        let b = s.as_bytes();
        let mut out = [0u8; N];
        let mut i = 0;
        while i < N {
            out[i] = b[i] ^ mix(seed, i);
            i += 1;
        }
        out
    }

    /// Рантайм-расшифровка с сохранением регистра.
    pub fn dec(bytes: &[u8], seed: u64) -> String {
        let decoded: Vec<u8> =
            bytes.iter().enumerate().map(|(i, b)| b ^ mix(seed, i)).collect();
        String::from_utf8_lossy(&decoded).into_owned()
    }
}

/// Шифрует строковый литерал по месту использования (со своим ключом на каждый
/// call-site) и расшифровывает в рантайме в `String`. В DLL литерал не виден
/// открытым текстом. Определён до `mod imp`, поэтому доступен внутри него.
#[allow(unused_macros)]
macro_rules! obf_str {
    ($lit:literal) => {{
        const N: usize = $lit.len();
        const SEED: u64 = crate::obf::seed(line!(), column!());
        const ENC: [u8; N] = crate::obf::obfuscate::<N>($lit, SEED);
        crate::obf::dec(&ENC, SEED)
    }};
}

#[cfg(windows)]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::ffi::OsString;
    use std::fs::OpenOptions;
    use std::io::Write;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use sha2::{Digest, Sha256};

    use windows_sys::Win32::Foundation::{
        CloseHandle, BOOL, HANDLE, HMODULE, HWND, INVALID_HANDLE_VALUE, LPARAM, RECT,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, WriteFile, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Diagnostics::Debug::IsDebuggerPresent;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Thread32First, Thread32Next,
        MODULEENTRY32W, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPTHREAD, THREADENTRY32,
    };
    use windows_sys::Win32::System::LibraryLoader::{
        DisableThreadLibraryCalls, GetModuleHandleW, GetProcAddress,
    };
    use windows_sys::Win32::System::Memory::{
        VirtualQuery, MEMORY_BASIC_INFORMATION, MEM_COMMIT, MEM_PRIVATE, PAGE_EXECUTE,
        PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY,
    };
    use windows_sys::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, OpenThread, QueryFullProcessImageNameW, TerminateProcess,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, THREAD_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    };

    // ======================= Authenticode (WinVerifyTrust) ===================
    //
    // Ручные объявления WinTrust (линкуемся с wintrust.dll напрямую). Это
    // избавляет от зависимости от конкретной поверхности windows-sys и даёт
    // полный контроль над раскладкой структур. Используется, чтобы доверять
    // системным/драйверным/JRE-модулям только при валидной цифровой подписи.

    #[repr(C)]
    struct Guid {
        data1: u32,
        data2: u16,
        data3: u16,
        data4: [u8; 8],
    }

    // WINTRUST_ACTION_GENERIC_VERIFY_V2 = {00AAC56B-CD44-11d0-8CC2-00C04FC295EE}
    const WINTRUST_ACTION_GENERIC_VERIFY_V2: Guid = Guid {
        data1: 0x00AA_C56B,
        data2: 0xCD44,
        data3: 0x11D0,
        data4: [0x8C, 0xC2, 0x00, 0xC0, 0x4F, 0xC2, 0x95, 0xEE],
    };

    #[repr(C)]
    struct WintrustFileInfo {
        cb_struct: u32,
        pcwsz_file_path: *const u16,
        h_file: HANDLE,
        pg_known_subject: *const Guid,
    }

    #[repr(C)]
    struct WintrustData {
        cb_struct: u32,
        p_policy_callback_data: *mut core::ffi::c_void,
        p_sip_client_data: *mut core::ffi::c_void,
        dw_ui_choice: u32,
        fdw_revocation_checks: u32,
        dw_union_choice: u32,
        // Объединение указателей на разные виды объектов; используем pFile.
        p_info: *mut WintrustFileInfo,
        dw_state_action: u32,
        h_wvt_state_data: HANDLE,
        pwsz_url_reference: *mut u16,
        dw_prov_flags: u32,
        dw_ui_context: u32,
    }

    const WTD_UI_NONE: u32 = 2;
    const WTD_REVOKE_NONE: u32 = 0;
    const WTD_CHOICE_FILE: u32 = 1;
    const WTD_STATEACTION_VERIFY: u32 = 1;
    const WTD_STATEACTION_CLOSE: u32 = 2;
    const WTD_REVOCATION_CHECK_NONE: u32 = 0x0000_0010;
    const WTD_CACHE_ONLY_URL_RETRIEVAL: u32 = 0x0000_1000;

    #[link(name = "wintrust")]
    extern "system" {
        fn WinVerifyTrust(hwnd: HWND, pg_action_id: *const Guid, p_wvt_data: *mut core::ffi::c_void)
            -> i32;
    }

    /// Проверяет наличие валидной (доверенной) Authenticode-подписи у файла.
    /// Никакого обращения в сеть (revocation отключён) — быстро и без зависаний.
    fn is_authenticode_signed(path_raw: &str) -> bool {
        if path_raw.is_empty() {
            return false;
        }
        let wide: Vec<u16> = std::path::Path::new(path_raw)
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut file_info = WintrustFileInfo {
            cb_struct: std::mem::size_of::<WintrustFileInfo>() as u32,
            pcwsz_file_path: wide.as_ptr(),
            h_file: std::ptr::null_mut(),
            pg_known_subject: std::ptr::null(),
        };
        let mut data = WintrustData {
            cb_struct: std::mem::size_of::<WintrustData>() as u32,
            p_policy_callback_data: std::ptr::null_mut(),
            p_sip_client_data: std::ptr::null_mut(),
            dw_ui_choice: WTD_UI_NONE,
            fdw_revocation_checks: WTD_REVOKE_NONE,
            dw_union_choice: WTD_CHOICE_FILE,
            p_info: &mut file_info,
            dw_state_action: WTD_STATEACTION_VERIFY,
            h_wvt_state_data: std::ptr::null_mut(),
            pwsz_url_reference: std::ptr::null_mut(),
            dw_prov_flags: WTD_REVOCATION_CHECK_NONE | WTD_CACHE_ONLY_URL_RETRIEVAL,
            dw_ui_context: 0,
        };

        unsafe {
            let status = WinVerifyTrust(
                std::ptr::null_mut(),
                &WINTRUST_ACTION_GENERIC_VERIFY_V2,
                &mut data as *mut _ as *mut core::ffi::c_void,
            );
            // Освобождаем состояние проверки (обязательно после VERIFY).
            data.dw_state_action = WTD_STATEACTION_CLOSE;
            let _ = WinVerifyTrust(
                std::ptr::null_mut(),
                &WINTRUST_ACTION_GENERIC_VERIFY_V2,
                &mut data as *mut _ as *mut core::ffi::c_void,
            );
            status == 0
        }
    }

    // ============================ Списки ====================================

    /// Точные имена нативных библиотек движка Minecraft/LWJGL, которые JVM
    /// распаковывает во временный каталог. Сверяем ТОЧНО по имени файла — без
    /// подстрок, чтобы `lwjgl_evil.dll` не проходил как доверенный.
    /// Строки обфусцированы и расшифровываются один раз (см. `obf`).
    fn exact_native_names() -> &'static [String] {
        static C: OnceLock<Vec<String>> = OnceLock::new();
        C.get_or_init(|| {
            vec![
                obf_str!("lwjgl.dll"), obf_str!("lwjgl_opengl.dll"), obf_str!("lwjgl_stb.dll"),
                obf_str!("lwjgl_tinyfd.dll"), obf_str!("lwjgl_remotery.dll"), obf_str!("lwjgl_openal.dll"),
                obf_str!("lwjgl_glfw.dll"), obf_str!("lwjgl_jemalloc.dll"), obf_str!("openal.dll"),
                obf_str!("openal32.dll"), obf_str!("openal64.dll"), obf_str!("soft_oal.dll"),
                obf_str!("glfw.dll"), obf_str!("glfw3.dll"), obf_str!("jemalloc.dll"),
                obf_str!("libpng16.dll"), obf_str!("shaderc.dll"),
                // Xerial SQLite JDBC штатно распаковывает JNI-модуль sqlitejdbc.dll.
                obf_str!("sqlitejdbc.dll"),
            ]
        })
    }

    /// Заведомо вредоносные имена модулей — известные читы и инжекторы.
    /// Специально без общих слов вроде "hook"/"inject", чтобы не ловить оверлеи.
    fn module_blacklist() -> &'static [String] {
        static C: OnceLock<Vec<String>> = OnceLock::new();
        C.get_or_init(|| {
            vec![
                obf_str!("meteor"), obf_str!("impact"), obf_str!("wurst"), obf_str!("aristois"),
                obf_str!("liquidbounce"), obf_str!("sigma"), obf_str!("future"), obf_str!("vape"),
                obf_str!("novoline"), obf_str!("rise"), obf_str!("moon"), obf_str!("inertia"),
                obf_str!("konas"), obf_str!("wolfram"), obf_str!("seppuku"), obf_str!("jigsaw"),
                obf_str!("koid"), obf_str!("rusherhack"), obf_str!("cheatbreaker"), obf_str!("cheatengine"),
                obf_str!("speedhack"), obf_str!("xenon"), obf_str!("prestige"), obf_str!("krutdlc"),
                obf_str!("wexside"), obf_str!("entropy"), obf_str!("doomsday"), obf_str!("huzuni"), obf_str!("baritone"),
            ]
        })
    }

    /// Процессы, которым РАЗРЕШЕНО рисовать оверлей поверх игры: голосовые чаты,
    /// стриминг, драйверы GPU, системная композиция. Их не трогаем.
    fn overlay_process_whitelist() -> &'static [String] {
        static C: OnceLock<Vec<String>> = OnceLock::new();
        C.get_or_init(|| {
            vec![
                obf_str!("dwm.exe"), obf_str!("explorer.exe"), obf_str!("textinputhost"),
                obf_str!("applicationframehost"), obf_str!("searchhost"), obf_str!("startmenu"),
                obf_str!("shellexperiencehost"), obf_str!("sihost"), obf_str!("ctfmon"),
                obf_str!("lockapp"), obf_str!("nvcontainer"), obf_str!("csrss"), obf_str!("winlogon"),
                obf_str!("discord"), obf_str!("steam"), obf_str!("gameoverlayui"), obf_str!("obs"),
                obf_str!("streamlabs"), obf_str!("nvidia share"), obf_str!("nvidia web helper"),
                obf_str!("geforce"), obf_str!("nvcp"), obf_str!("rtss"), obf_str!("rivatuner"),
                obf_str!("msiafterburner"), obf_str!("medal"), obf_str!("overwolf"), obf_str!("razer"),
                obf_str!("logi"), obf_str!("wallpaper"), obf_str!("nahimic"), obf_str!("elgato"),
                obf_str!("politempire"), obf_str!("pe_launcher"), obf_str!("pe-launcher"),
                obf_str!("webview2"), obf_str!("msedgewebview2"),
            ]
        })
    }

    /// Явно вредоносные оверлеи — процессы известных внешних читов. Только для
    /// них DLL сразу завершает чужой процесс (см. риск-модель ниже).
    fn overlay_process_blacklist() -> &'static [String] {
        static C: OnceLock<Vec<String>> = OnceLock::new();
        C.get_or_init(|| {
            vec![
                obf_str!("cheatengine"), obf_str!("artmoney"), obf_str!("xenos"),
                obf_str!("extreme injector"), obf_str!("processhacker"), obf_str!("wpespy"),
                obf_str!("wpeapi"),
            ]
        })
    }

    /// Сколько подряд проходов оверлей должен подтвердиться, прежде чем мы
    /// эскалируем до кика игрока (severe-события `overlay_confirmed`).
    const OVERLAY_CONFIRM_LIMIT: u32 = 3;

    fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    }

    /// Псевдослучайный nonce без внешних зависимостей: время + счётчик + адрес.
    fn gen_nonce() -> u64 {
        static CTR: AtomicU64 = AtomicU64::new(0);
        let t = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        let c = CTR.fetch_add(1, Ordering::Relaxed);
        let stack = &c as *const _ as u64;
        t ^ c.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ stack.rotate_left(17)
    }

    fn json_escape(s: &str) -> String {
        let mut out = String::with_capacity(s.len() + 2);
        for c in s.chars() {
            match c {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => out.push(' '),
                c => out.push(c),
            }
        }
        out
    }

    // ========================= Канал связи ==================================
    //
    // Приоритет: named pipe (защищённый, с heartbeat). Резерв: файл PE_AC_REPORT.

    /// Хэндл named pipe (как isize, чтобы быть Send). 0 — не подключён.
    static PIPE_HANDLE: Mutex<isize> = Mutex::new(0);
    /// Монотонный номер сообщения (детект пропусков/повторов на стороне лаунчера).
    static SEQ: AtomicU64 = AtomicU64::new(1);

    /// Значение переменной окружения (session_id/token/пути) с кэшем.
    fn env_str(key: &str) -> String {
        std::env::var(key).unwrap_or_default()
    }

    /// Пытается подключиться к named pipe лаунчера и отправить hello с токеном.
    /// Лаунчер создаёт pipe ДО инжекта, поэтому обычно подключаемся сразу.
    fn connect_pipe() -> bool {
        let name = env_str(&obf_str!("PE_AC_PIPE"));
        if name.is_empty() {
            return false;
        }
        let wide: Vec<u16> = OsString::from(name)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        const GENERIC_WRITE: u32 = 0x4000_0000;
        for attempt in 0..10 {
            let h = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    GENERIC_WRITE,
                    0,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    std::ptr::null_mut(),
                )
            };
            if h != INVALID_HANDLE_VALUE && !h.is_null() {
                *PIPE_HANDLE.lock().unwrap() = h as isize;
                // Рукопожатие: session_id + секретный токен (их знает только
                // процесс игры, унаследовавший переменные окружения лаунчера).
                let hello = format!(
                    "{{\"type\":\"hello\",\"session\":\"{}\",\"token\":\"{}\",\"seq\":{},\"nonce\":{},\"ts\":{},\"src\":\"dll\"}}\n",
            json_escape(&env_str(&obf_str!("PE_AC_SESSION"))),
            json_escape(&env_str(&obf_str!("PE_AC_TOKEN"))),
                    SEQ.fetch_add(1, Ordering::SeqCst),
                    gen_nonce(),
                    now_ms(),
                );
                if pipe_write(&hello) {
                    return true;
                }
            }
            std::thread::sleep(Duration::from_millis(200 * (attempt + 1)));
        }
        false
    }

    /// Пишет готовую строку в pipe. false — если pipe отвалился (закрываем его).
    fn pipe_write(line: &str) -> bool {
        let h = *PIPE_HANDLE.lock().unwrap();
        if h == 0 {
            return false;
        }
        let bytes = line.as_bytes();
        let mut written = 0u32;
        let ok = unsafe {
            WriteFile(
                h as HANDLE,
                bytes.as_ptr(),
                bytes.len() as u32,
                &mut written,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 || written as usize != bytes.len() {
            // Канал разорван — закрываем, дальше уйдём в файловый резерв.
            unsafe {
                CloseHandle(h as HANDLE);
            }
            *PIPE_HANDLE.lock().unwrap() = 0;
            return false;
        }
        true
    }

    /// Дописывает событие в резервный файл-отчёт (если задан PE_AC_REPORT).
    fn file_write(line: &str) {
        let path = env_str(&obf_str!("PE_AC_REPORT"));
        if path.is_empty() {
            return;
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(line.as_bytes());
        }
    }

    /// Формирует и отправляет одно подписанное событие (pipe → иначе файл).
    fn report(event_type: &str, detail: &str) {
        let line = format!(
            "{{\"type\":\"{}\",\"detail\":\"{}\",\"session\":\"{}\",\"seq\":{},\"nonce\":{},\"ts\":{},\"src\":\"dll\"}}\n",
            json_escape(event_type),
            json_escape(detail),
            json_escape(&env_str(&obf_str!("PE_AC_SESSION"))),
            SEQ.fetch_add(1, Ordering::SeqCst),
            gen_nonce(),
            now_ms(),
        );
        if !pipe_write(&line) {
            file_write(&line);
        }
    }

    // ========================= Модули процесса ==============================

    /// Сведения о загруженном модуле.
    struct ModuleInfo {
        name_lc: String,   // имя файла в нижнем регистре
        path_raw: String,  // оригинальный путь (для хэша/подписи)
        path_lc: String,   // путь в нижнем регистре со слэшами (для сравнений)
        base: usize,       // адрес загрузки в памяти
        size: usize,       // размер образа
    }

    fn wide_to_string(buf: &[u16]) -> String {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        OsString::from_wide(&buf[..len]).to_string_lossy().into_owned()
    }

    /// Перечисляет модули текущего процесса (имя, путь, диапазон адресов).
    fn enumerate_modules() -> Vec<ModuleInfo> {
        let mut modules = Vec::new();
        unsafe {
            let pid = GetCurrentProcessId();
            let snapshot =
                CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
            if snapshot == INVALID_HANDLE_VALUE {
                return modules;
            }
            let mut entry: MODULEENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<MODULEENTRY32W>() as u32;
            if Module32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let name_lc = wide_to_string(&entry.szModule).to_lowercase();
                    let path_raw = wide_to_string(&entry.szExePath);
                    let path_lc = path_raw.replace('\\', "/").to_lowercase();
                    if !name_lc.is_empty() {
                        modules.push(ModuleInfo {
                            name_lc,
                            path_raw,
                            path_lc,
                            base: entry.modBaseAddr as usize,
                            size: entry.modBaseSize as usize,
                        });
                    }
                    if Module32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
        modules
    }

    /// SHA-256 файла (hex). Пустая строка, если файл недоступен.
    fn sha256_file(path_raw: &str) -> String {
        match std::fs::read(path_raw) {
            Ok(bytes) => {
                let mut h = Sha256::new();
                h.update(&bytes);
                let digest = h.finalize();
                let mut s = String::with_capacity(64);
                for b in digest {
                    s.push_str(&format!("{b:02x}"));
                }
                s
            }
            Err(_) => String::new(),
        }
    }

    /// SHA-256 файла с кэшем по (size, mtime): пересчёт только при изменении
    /// файла. Хэширование крупных модулей (jvm.dll и т.п.) на КАЖДОЙ итерации
    /// цикла (раз в 5с) заметно грузило CPU/диск — кэш это устраняет.
    fn sha256_file_cached(path_raw: &str) -> String {
        static CACHE: OnceLock<Mutex<HashMap<String, (u64, u64, String)>>> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let meta = std::fs::metadata(path_raw).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if let Some((c_size, c_mtime, c_hash)) = cache.lock().unwrap().get(path_raw) {
            if *c_size == size && *c_mtime == mtime {
                return c_hash.clone();
            }
        }
        let hash = sha256_file(path_raw);
        cache
            .lock()
            .unwrap()
            .insert(path_raw.to_string(), (size, mtime, hash.clone()));
        hash
    }

    // ==================== Доверие к модулям (ужесточённое) ==================

    /// Контекст проверки доверия: каталоги + кэш проверок подписи (WinVerifyTrust
    /// дорогой, поэтому результат по каждому пути кэшируем).
    struct TrustCtx {
        windows_dirs: Vec<String>, // %windir%/SystemRoot — OS-protected, доверяем по расположению
        system_dirs: Vec<String>,  // Program Files, ProgramData … (нижний регистр, '/')
        temp_dirs: Vec<String>,
        sig_cache: HashMap<String, bool>,
    }

    impl TrustCtx {
        fn new() -> Self {
            // Каталог самой Windows (%windir%). Он защищён ОС: писать в него могут
            // только админ/TrustedInstaller, поэтому любой модуль отсюда доверенный
            // ПО РАСПОЛОЖЕНИЮ. Это критично: большинство системных DLL
            // (dhcpcsvc.dll, sapi.dll, apphelp.dll …) подписаны не встроенной
            // подписью, а через каталоги безопасности (.cat), и WinVerifyTrust в
            // файловом режиме их «не видит» → раньше это давало шквал ложных
            // unsigned_module. Доверие по расположению убирает ложняки.
            let mut windows_dirs = Vec::new();
            for v in ["SystemRoot", "windir"] {
                if let Ok(p) = std::env::var(v) {
                    if !p.is_empty() {
                        windows_dirs.push(p.replace('\\', "/").to_lowercase());
                    }
                }
            }
            if windows_dirs.is_empty() {
                windows_dirs.push("c:/windows".into());
            }

            let mut system_dirs = Vec::new();
            for v in [
                "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432",
                "ProgramData", "CommonProgramFiles", "CommonProgramFiles(x86)",
            ] {
                if let Ok(p) = std::env::var(v) {
                    if !p.is_empty() {
                        system_dirs.push(p.replace('\\', "/").to_lowercase());
                    }
                }
            }
            let mut temp_dirs = Vec::new();
            for v in ["TEMP", "TMP"] {
                if let Ok(p) = std::env::var(v) {
                    if !p.is_empty() {
                        temp_dirs.push(p.replace('\\', "/").to_lowercase());
                    }
                }
            }
            Self { windows_dirs, system_dirs, temp_dirs, sig_cache: HashMap::new() }
        }

        /// Модуль лежит внутри защищённого каталога Windows (%windir%).
        fn in_windows_dir(&self, path_lc: &str) -> bool {
            self.windows_dirs.iter().any(|d| !d.is_empty() && path_lc.starts_with(d))
        }

        fn in_system_dir(&self, path_lc: &str) -> bool {
            self.system_dirs.iter().any(|d| !d.is_empty() && path_lc.starts_with(d))
        }

        /// Каталог самой сборки / Java-рантайма (наши управляемые файлы).
        fn in_client_dir(&self, path_lc: &str) -> bool {
            path_lc.contains("/jre") || path_lc.contains("/jdk") || path_lc.contains("/runtime/")
                || path_lc.contains(obf_str!("politempire").as_str())
                || path_lc.contains(obf_str!("minecraft").as_str())
                || path_lc.contains(obf_str!("/gml").as_str())
        }

        fn in_temp_dir(&self, path_lc: &str) -> bool {
            self.temp_dirs.iter().any(|d| !d.is_empty() && path_lc.starts_with(d))
                || path_lc.contains("/temp/") || path_lc.contains("/tmp/")
        }

        fn is_signed_cached(&mut self, path_raw: &str, path_lc: &str) -> bool {
            if let Some(v) = self.sig_cache.get(path_lc) {
                return *v;
            }
            let v = is_authenticode_signed(path_raw);
            self.sig_cache.insert(path_lc.to_string(), v);
            v
        }
    }

    /// Точное имя-натив (в temp) считается доверенным.
    fn is_exact_native(name_lc: &str) -> bool {
        exact_native_names().iter().any(|n| *n == name_lc)
    }

    /// Похоже ли имя на JNI/натив Minecraft (`libopus4j.dll`, `jniXXX.dll`).
    fn looks_like_native(name_lc: &str) -> bool {
        let stem = name_lc.strip_suffix(".dll").unwrap_or(name_lc);
        stem.ends_with("4j") || stem.starts_with("lib") || stem.starts_with("jni")
    }

    /// Классификация модуля для трактовки доверия/подозрительности.
    #[derive(PartialEq)]
    enum ModuleVerdict {
        Trusted,        // системный+подпись / клиентский каталог / точный натив в temp
        Injected,       // неизвестный неподписанный модуль вне доверенных мест — severe
        UnsignedSystem, // в system/program, но без валидной подписи — на ревью
        SignedUnknown,  // подписан, но не в доверенном каталоге — на ревью
        TempUnknown,    // в temp, но не похож на натив — на ревью
    }

    fn classify_module(m: &ModuleInfo, ctx: &mut TrustCtx) -> ModuleVerdict {
        if m.path_lc.is_empty() {
            // Модуль без пути на диске — крайне подозрительно (manual map).
            return ModuleVerdict::Injected;
        }
        // 1. Каталог сборки/JRE. Раньше доверяли ВСЕМУ по расположению, но этот
        //    каталог пишется самим пользователем: читер мог положить свой .dll в
        //    папку с "minecraft"/"gml" в пути и стать «доверенным». Теперь доверяем
        //    только нативам движка (по имени) ИЛИ модулям с валидной Authenticode-
        //    подписью (jvm.dll и пр. подписаны). Неизвестный неподписанный модуль
        //    здесь — на ревью (signed_unknown), не severe: не банит ложно, но и не
        //    выдаёт слепой кредит доверия.
        if ctx.in_client_dir(&m.path_lc) {
            if is_exact_native(&m.name_lc)
                || looks_like_native(&m.name_lc)
                || ctx.is_signed_cached(&m.path_raw, &m.path_lc)
            {
                return ModuleVerdict::Trusted;
            }
            return ModuleVerdict::SignedUnknown;
        }
        // 2. Каталог Windows (%windir%: System32, SysWOW64, WinSxS …) — доверяем
        //    по расположению. Он защищён ОС (запись только админ/TrustedInstaller),
        //    а системные DLL подписаны через каталоги (.cat), которые файловый
        //    WinVerifyTrust не проверяет — иначе шквал ложных unsigned_module.
        if ctx.in_windows_dir(&m.path_lc) {
            return ModuleVerdict::Trusted;
        }
        // 3. Program Files / ProgramData — доверяем ТОЛЬКО при валидной подписи.
        if ctx.in_system_dir(&m.path_lc) {
            return if ctx.is_signed_cached(&m.path_raw, &m.path_lc) {
                ModuleVerdict::Trusted
            } else {
                ModuleVerdict::UnsignedSystem
            };
        }
        // 3. Нативы движка, распакованные JVM во временный каталог.
        if ctx.in_temp_dir(&m.path_lc) {
            if is_exact_native(&m.name_lc) || looks_like_native(&m.name_lc) {
                return ModuleVerdict::Trusted;
            }
            return ModuleVerdict::TempUnknown;
        }
        // 4. Подписан, но лежит в нестандартном месте — на ревью (не сразу бан).
        if ctx.is_signed_cached(&m.path_raw, &m.path_lc) {
            return ModuleVerdict::SignedUnknown;
        }
        // 5. Неподписанный код из непонятного места, появившийся после старта.
        ModuleVerdict::Injected
    }

    // ============== Проверка защиты памяти стартов потоков =================
    //
    // Сам факт MEM_PRIVATE + RWX не подозрителен: HotSpot JVM штатно использует
    // такие области для JIT. Поэтому защита проверяется только у стартового
    // адреса потока вне известных DLL — это уже сильный сигнал manual map /
    // shellcode и не создаёт шум от неисполняемого напрямую JIT-кэша.

    fn is_exec_protect(protect: u32) -> bool {
        // Только «пишемо-исполняемые» и чисто исполняемые страницы — самый
        // характерный признак инъекции. PAGE_EXECUTE_READ намеренно пропускаем
        // (его массово создаёт JIT), чтобы не спамить.
        protect == PAGE_EXECUTE_READWRITE || protect == PAGE_EXECUTE_WRITECOPY || protect == PAGE_EXECUTE
    }

    // ==================== Скан потоков процесса =============================
    //
    // Ловит потоки, стартующие из неизвестной (не-модульной) исполняемой памяти —
    // типичный признак выполнения manual-mapped кода. Потоки JVM стартуют внутри
    // jvm.dll (модуль) и пропускаются. Событие — для ревью (не severe).

    type NtQueryInformationThreadFn = unsafe extern "system" fn(
        HANDLE,
        i32,
        *mut core::ffi::c_void,
        u32,
        *mut u32,
    ) -> i32;

    /// Достаёт NtQueryInformationThread из ntdll (один раз).
    fn nt_query_information_thread() -> Option<NtQueryInformationThreadFn> {
        unsafe {
            let ntdll: Vec<u16> =
                obf_str!("ntdll.dll").encode_utf16().chain(std::iter::once(0)).collect();
            let h = GetModuleHandleW(ntdll.as_ptr());
            if h.is_null() {
                return None;
            }
            // Имя API собирается из обфусцированной строки и null-терминируется.
            let mut proc_name = obf_str!("NtQueryInformationThread").into_bytes();
            proc_name.push(0);
            let p = GetProcAddress(h, proc_name.as_ptr());
            p.map(|f| std::mem::transmute::<_, NtQueryInformationThreadFn>(f))
        }
    }

    /// Win32 start address потока (ThreadQuerySetWin32StartAddress = 9).
    fn thread_start_address(nt: NtQueryInformationThreadFn, tid: u32) -> Option<usize> {
        unsafe {
            let h = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, 0, tid);
            if h.is_null() {
                return None;
            }
            let mut start: usize = 0;
            let status = nt(
                h,
                9, // ThreadQuerySetWin32StartAddress
                &mut start as *mut usize as *mut core::ffi::c_void,
                std::mem::size_of::<usize>() as u32,
                std::ptr::null_mut(),
            );
            CloseHandle(h);
            if status == 0 && start != 0 {
                Some(start)
            } else {
                None
            }
        }
    }

    /// Проверяет стартовые адреса всех потоков процесса.
    fn scan_threads(
        self_pid: u32,
        ranges: &[(usize, usize)],
        reported: &mut HashSet<String>,
        budget: &mut u32,
    ) {
        let nt = match nt_query_information_thread() {
            Some(f) => f,
            None => return,
        };
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snap == INVALID_HANDLE_VALUE {
                return;
            }
            let mut entry: THREADENTRY32 = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
            if Thread32First(snap, &mut entry) != 0 {
                loop {
                    if entry.th32OwnerProcessID == self_pid {
                        if let Some(addr) = thread_start_address(nt, entry.th32ThreadID) {
                            let in_module =
                                ranges.iter().any(|(b, e)| addr >= *b && addr < *e);
                            if !in_module && *budget > 0 {
                                // Стартовый адрес вне модулей — проверяем, что это
                                // приватная исполняемая память (manual map).
                                let mut mbi: MEMORY_BASIC_INFORMATION = std::mem::zeroed();
                                let got = VirtualQuery(
                                    addr as *const core::ffi::c_void,
                                    &mut mbi,
                                    std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
                                );
                                if got != 0
                                    && mbi.State == MEM_COMMIT
                                    && mbi.Type == MEM_PRIVATE
                                    && is_exec_protect(mbi.Protect)
                                {
                                    let key = format!("thread:{addr:x}");
                                    if reported.insert(key) {
                                        *budget -= 1;
                                        report(
                                            "suspicious_thread",
                                            &format!(
                                                "thread starts in private exec memory :: tid={} start=0x{addr:x} protect=0x{:x}",
                                                entry.th32ThreadID, mbi.Protect
                                            ),
                                        );
                                    }
                                }
                            }
                        }
                    }
                    if Thread32Next(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
    }

    // ==================== Блокировка оверлеев (риск-модель) =================

    fn process_image(pid: u32) -> (String, String) {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return (String::new(), String::new());
            }
            let mut buf = [0u16; 260];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(h);
            if ok == 0 {
                return (String::new(), String::new());
            }
            let path = OsString::from_wide(&buf[..size as usize])
                .to_string_lossy()
                .to_lowercase();
            let name = path.rsplit(['/', '\\']).next().unwrap_or(&path).to_string();
            (path, name)
        }
    }

    fn overlap_ratio(win: &RECT, game: &RECT) -> f64 {
        let ix = (win.right.min(game.right) - win.left.max(game.left)).max(0) as i64;
        let iy = (win.bottom.min(game.bottom) - win.top.max(game.top)).max(0) as i64;
        let inter = ix * iy;
        let garea = ((game.right - game.left) as i64 * (game.bottom - game.top) as i64).max(1);
        inter as f64 / garea as f64
    }

    struct GameFind {                                                                                                                            
        self_pid: u32,
        rect: RECT,
        area: i64,
    }

    unsafe extern "system" fn enum_game_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut GameFind);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != ctx.self_pid {
            return 1;
        }
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut r) == 0 {
            return 1;
        }
        let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
        if area > ctx.area {
            ctx.area = area;
            ctx.rect = r;
        }
        1
    }

    struct OverlayScan {
        self_pid: u32,
        game: RECT,
        hits: Vec<(u32, String, String)>, // (pid, exe_name, exe_path)
    }

    unsafe extern "system" fn enum_overlay_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut OverlayScan);
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let needed = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST;
        if ex & needed != needed {
            return 1;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == ctx.self_pid {
            return 1;
        }
        let mut r: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut r) == 0 {
            return 1;
        }
        if overlap_ratio(&r, &ctx.game) < 0.5 {
            return 1;
        }
        let (path, name) = process_image(pid);
        ctx.hits.push((pid, name, path));
        1
    }

    /// Риск-модель по оверлеям:
    ///  * известный чит-процесс (blacklist) → сразу terminate + `overlay_blocked`;
    ///  * прочее подозрительное окно: 1-й раз → `overlay_suspicious` (не severe),
    ///    после {OVERLAY_CONFIRM_LIMIT} подтверждений подряд → `overlay_confirmed`
    ///    (severe: лаунчер кикает игрока). Чужие процессы НЕ убиваем.
    /// `confirm` хранит счётчик подтверждений по каждому pid между проходами.
    fn scan_overlays(
        self_pid: u32,
        trusted_sys: &[String],
        reported: &mut HashSet<String>,
        confirm: &mut HashMap<u32, u32>,
    ) {
        let mut gf = GameFind {
            self_pid,
            rect: RECT { left: 0, top: 0, right: 0, bottom: 0 },
            area: 0,
        };
        unsafe {
            EnumWindows(Some(enum_game_cb), &mut gf as *mut _ as LPARAM);
        }
        if gf.area == 0 {
            return;
        }

        let mut scan = OverlayScan {
            self_pid,
            game: gf.rect,
            hits: Vec::new(),
        };
        unsafe {
            EnumWindows(Some(enum_overlay_cb), &mut scan as *mut _ as LPARAM);
        }

        // pids, подтверждённые в этом проходе (для сброса счётчиков остальных).
        let mut seen_now: HashSet<u32> = HashSet::new();

        for (pid, name, path) in scan.hits {
            let p = path.replace('\\', "/");
            let name_ok = !name.is_empty()
                && overlay_process_whitelist().iter().any(|w| name.contains(w.as_str()) || p.contains(w.as_str()));
            let sys_ok = !p.is_empty()
                && trusted_sys.iter().any(|d| !d.is_empty() && p.starts_with(d));
            if name_ok || sys_ok {
                continue; // разрешённый/системный оверлей
            }

            let display = if name.is_empty() { format!("pid {pid}") } else { name.clone() };
            let path_disp = if path.is_empty() { "<path unavailable>".to_string() } else { path.clone() };

            // Явный чит из чёрного списка — единственный случай, когда убиваем процесс.
            let blacklisted = !name.is_empty()
                && overlay_process_blacklist().iter().any(|b| name.contains(b.as_str()) || p.contains(b.as_str()));
            if blacklisted {
                let killed = unsafe {
                    let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
                    if h.is_null() {
                        false
                    } else {
                        let ok = TerminateProcess(h, 1) != 0;
                        CloseHandle(h);
                        ok
                    }
                };
                if reported.insert(format!("overlay_blocked:{pid}:{display}")) {
                    report(
                        "overlay_blocked",
                        &format!(
                            "blacklisted overlay process :: {display} (pid {pid}) :: {} :: {path_disp}",
                            if killed { "terminated" } else { "terminate_failed" }
                        ),
                    );
                }
                continue;
            }

            // Иначе — накапливаем подтверждения (без убийства процесса).
            seen_now.insert(pid);
            let c = confirm.entry(pid).or_insert(0);
            *c += 1;
            if *c == 1 {
                // Первое обнаружение — только сообщаем (на ревью, не severe).
                report(
                    "overlay_suspicious",
                    &format!("unknown overlay over game :: {display} (pid {pid}) :: {path_disp}"),
                );
            } else if *c >= OVERLAY_CONFIRM_LIMIT
                && reported.insert(format!("overlay_confirmed:{pid}:{display}"))
            {
                // Подтверждён несколько раз подряд — эскалация до кика игрока.
                report(
                    "overlay_confirmed",
                    &format!(
                        "overlay confirmed x{} :: {display} (pid {pid}) :: {path_disp}",
                        *c
                    ),
                );
            }
        }

        // Сбрасываем счётчики для оверлеев, исчезнувших в этом проходе,
        // чтобы разовые всплески не накапливались до эскалации.
        confirm.retain(|pid, _| seen_now.contains(pid));
    }

    // ============================ Основной цикл =============================

    fn monitor_loop() {
        // Подключаемся к каналу лаунчера как можно раньше (до прогрева JVM),
        // чтобы heartbeat пошёл сразу и лаунчер знал, что DLL жива.
        connect_pipe();

        // Heartbeat шлём из ОТДЕЛЬНОГО лёгкого потока по фиксированному таймеру,
        // независимо от тяжёлого скан-цикла ниже. Иначе долгая итерация
        // (хэширование модулей, GC-пауза JVM) задерживала бы «пульс», и лаунчер
        // ложно считал бы DLL выгруженной (heartbeat_lost → несправедливый кик).
        std::thread::spawn(|| loop {
            report("heartbeat", "alive");
            std::thread::sleep(Duration::from_secs(5));
        });

        // Даём JVM прогрузить свои библиотеки, чтобы не считать их «новыми».
        std::thread::sleep(Duration::from_secs(10));

        let mut ctx = TrustCtx::new();
        let self_pid = unsafe { GetCurrentProcessId() };

        // Доверенные каталоги для белого списка оверлеев: Windows (%windir%) +
        // Program Files/ProgramData. Системные оверлеи (dwm.exe, explorer.exe и
        // т.п.) живут в %windir%\System32, поэтому его тоже включаем — иначе
        // легальная системная композиция ложно попадала бы в подозрительные.
        let overlay_trusted_dirs: Vec<String> = ctx
            .windows_dirs
            .iter()
            .chain(ctx.system_dirs.iter())
            .cloned()
            .collect();

        // Базовый снимок модулей — эталон (имя + путь + хэш). Храним по имени,
        // но фиксируем путь и хэш: если позже под тем же именем окажется другой
        // путь/хэш — это подмена (DLL hijacking), и модуль будет переоценён.
        struct BaseEntry {
            path_lc: String,
            hash: String,
        }
        let mut baseline: HashMap<String, BaseEntry> = HashMap::new();
        for m in enumerate_modules() {
            let hash = sha256_file_cached(&m.path_raw);
            baseline.insert(m.name_lc.clone(), BaseEntry { path_lc: m.path_lc, hash });
        }
        report("anticheat_started", "in-process baseline captured (name/path/hash)");

        let mut reported: HashSet<String> = HashSet::new();
        let mut overlay_confirm: HashMap<u32, u32> = HashMap::new();
        let mut debugger_reported = false;

        loop {
            // 0. Heartbeat теперь шлёт отдельный поток (см. выше) по стабильному
            //    таймеру — здесь его больше не дублируем, чтобы «пульс» не зависел
            //    от длительности тяжёлой итерации скана.

            // 1. Отладчик, подключённый к игре.
            unsafe {
                if IsDebuggerPresent() != 0 && !debugger_reported {
                    debugger_reported = true;
                    report("debugger", "debugger attached to game process");
                }
            }

            // 2. Оверлеи поверх окна игры (риск-модель, без убийства процессов).
            scan_overlays(self_pid, &overlay_trusted_dirs, &mut reported, &mut overlay_confirm);

            // 3. Модули процесса + диапазоны адресов для сканов памяти/потоков.
            let modules = enumerate_modules();
            let ranges: Vec<(usize, usize)> = modules
                .iter()
                .filter(|m| m.base != 0 && m.size != 0)
                .map(|m| (m.base, m.base + m.size))
                .collect();

            for m in &modules {
                // Явно известный чит — репортим всегда (severe), сверяя ИМЯ.
                if let Some(bad) = module_blacklist().iter().find(|b| m.name_lc.contains(b.as_str())) {
                    if reported.insert(format!("cheat:{}", m.name_lc)) {
                        report("cheat_module", &format!("{} ({bad}) :: {}", m.name_lc, m.path_lc));
                    }
                    continue;
                }

                // Baseline-проверка по (имя → путь/хэш): подмену известного модуля
                // (тот же name, другой путь/хэш) считаем инъекцией.
                let mut baseline_tampered = false;
                if let Some(base) = baseline.get(&m.name_lc) {
                    let mut cur_hash = String::new();
                    if base.path_lc != m.path_lc {
                        // Если новый путь ведёт в системную папку Windows, то это не подмена,
                        // а легитимная загрузка системной версии (например, vcruntime140.dll
                        // или opengl32.dll) поверх локальной копии из JRE/Minecraft.
                        if !ctx.in_windows_dir(&m.path_lc) {
                            baseline_tampered = true;
                        }
                    } else if !base.hash.is_empty() {
                        cur_hash = sha256_file_cached(&m.path_raw);
                        if !cur_hash.is_empty() && cur_hash != base.hash {
                            baseline_tampered = true;
                        }
                    }
                    if baseline_tampered && reported.insert(format!("tamper:{}", m.name_lc)) {
                        if cur_hash.is_empty() {
                            cur_hash = sha256_file_cached(&m.path_raw);
                        }
                        report(
                            "module_tampered",
                            &format!(
                                "known module changed :: {} :: base_path={} cur_path={} base_hash={} cur_hash={}",
                                m.name_lc, base.path_lc, m.path_lc, base.hash, cur_hash
                            ),
                        );
                    }
                    if !baseline_tampered {
                        continue; // модуль из эталона не изменился — доверяем
                    }
                }

                // Классифицируем модуль (строгая модель доверия).
                match classify_module(m, &mut ctx) {
                    ModuleVerdict::Trusted => {}
                    ModuleVerdict::Injected => {
                        if reported.insert(format!("inject:{}", m.name_lc)) {
                            let hash = sha256_file_cached(&m.path_raw);
                            report(
                                "injected_module",
                                &format!("{} :: {} :: sha256={hash}", m.name_lc, m.path_lc),
                            );
                        }
                    }
                    ModuleVerdict::UnsignedSystem => {
                        if reported.insert(format!("unsigned:{}", m.name_lc)) {
                            report(
                                "unsigned_module",
                                &format!("unsigned module in system dir :: {} :: {}", m.name_lc, m.path_lc),
                            );
                        }
                    }
                    ModuleVerdict::SignedUnknown => {
                        if reported.insert(format!("signed_unknown:{}", m.name_lc)) {
                            report(
                                "signed_unknown_module",
                                &format!("signed module in unusual location :: {} :: {}", m.name_lc, m.path_lc),
                            );
                        }
                    }
                    ModuleVerdict::TempUnknown => {
                        if reported.insert(format!("temp:{}", m.name_lc)) {
                            report(
                                "temp_module",
                                &format!("unknown module in temp :: {} :: {}", m.name_lc, m.path_lc),
                            );
                        }
                    }
                }
            }

            // 4. Ищем не просто приватную RWX-память (её штатно создаёт JIT
            //    HotSpot JVM), а ПОТОКИ, стартующие из такой памяти вне DLL.
            //    Это сохраняет детект manual-map/shellcode без тысяч ложных
            //    suspicious_executable_memory от легального JIT-кэша.
            let mut thread_budget: u32 = 6;
            scan_threads(self_pid, &ranges, &mut reported, &mut thread_budget);

            std::thread::sleep(Duration::from_secs(5));
        }
    }

    #[no_mangle]
    #[allow(non_snake_case, unused_variables)]
    pub extern "system" fn DllMain(
        hinst: HMODULE,
        reason: u32,
        _reserved: *mut core::ffi::c_void,
    ) -> BOOL {
        if reason == DLL_PROCESS_ATTACH {
            unsafe {
                DisableThreadLibraryCalls(hinst);
            }
            std::thread::spawn(monitor_loop);
        }
        1 // TRUE
    }
}

// На не-Windows платформах crate собирается пустым (нужно только для проверок сборки).
#[cfg(not(windows))]
mod imp {}
