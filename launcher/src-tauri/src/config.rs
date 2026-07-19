use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Базовый адрес сайта (Telegram-бот, регистрация).
///
/// Адреса возвращаются функциями, а не `const &str`, чтобы домены НЕ лежали в
/// бинарнике открытым текстом (иначе видны через `strings launcher.exe`).
/// Значение шифруется на этапе компиляции макросом `obf_str!` (см. `obf.rs`) и
/// расшифровывается в рантайме.
pub fn api_base() -> String {
    crate::obf_str!("https://politempire.org")
}

/// Базовый адрес GML (Gml.Web.Api: вход, проверка токена, профиль сборки).
///
/// ВАЖНО: это НЕ gml.politempire.org. Тот домен проходит через Cloudflare,
/// который нестабильно доступен с российских IP (ТСПУ/проверки CF). Раньше
/// вход и получение профиля (где GML «запекает» в аргументы accessToken)
/// шли через Cloudflare, а join/hasJoined — напрямую через politempire.ru.
/// Токен выдавался одним путём, а проверялся другим — сессия не сходилась,
/// и игрок получал «недействительная сессия».
///
/// Теперь ВЕСЬ трафик GML (вход + профиль + authlib) идёт через прямой домен
/// politempire.ru (82.117.87.152), минуя Cloudflare. nginx на сервере
/// проксирует весь `/api/v1/` на GML-бэкенд (127.0.0.1:5003), поэтому и
/// signin, и profiles/info, и sessionserver/join|hasJoined попадают в один и
/// тот же инстанс с общим хранилищем сессий.
pub fn gml_api_base() -> String {
    crate::obf_str!("https://politempire.ru")
}

/// Базовый адрес для authlib-запросов самой игры (joinserver/hasJoined).
/// Совпадает с gml_api_base — и клиент, и сервер обязаны ходить в один и тот
/// же бэкенд одним и тем же путём, иначе сессия не подтверждается.
pub fn authlib_api_base() -> String {
    crate::obf_str!("https://politempire.ru")
}

/// Резервный домен GML (через Cloudflare). Проксирует тот же `/api/v1/` на тот
/// же бэкенд (127.0.0.1:5003, общее хранилище сессий), поэтому переключение
/// между ним и прямым доменом безопасно для сессий. Нужен, когда прямой
/// politempire.ru недоступен у части игроков: DPI/ТСПУ периодически рвёт
/// соединение ("error sending request for url ... politempire.ru"). В таком
/// случае лаунчер автоматически повторяет запрос через этот домен.
pub fn gml_fallback_host() -> String {
    crate::obf_str!("https://gml.politempire.org")
}

/// Хост GML, подтверждённый рабочим в текущем запуске лаунчера. Выбирается при
/// первом успешном запросе (вход/профиль) и переиспользуется остальными
/// вызовами (скачивание файлов, authlib), чтобы не перебирать хосты каждый раз
/// и чтобы «запечённый» в игру authlib-URL указывал на реально доступный хост.
static RESOLVED_GML_HOST: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Возвращает уже подтверждённый рабочий хост GML (если был выбран).
pub fn resolved_gml_host() -> Option<String> {
    RESOLVED_GML_HOST.lock().unwrap().clone()
}

/// Запоминает хост GML, который только что успешно ответил.
pub fn set_resolved_gml_host(host: &str) {
    *RESOLVED_GML_HOST.lock().unwrap() = Some(host.to_string());
}

/// Порядок перебора хостов GML: сначала уже подтверждённый в этой сессии (если
/// есть), затем прямой домен, затем резервный Cloudflare. Дубликаты убираются.
pub fn gml_host_candidates() -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    if let Some(h) = resolved_gml_host() {
        hosts.push(h);
    }
    for h in [gml_api_base(), gml_fallback_host()] {
        if !hosts.iter().any(|x| x == &h) {
            hosts.push(h);
        }
    }
    hosts
}

/// Имя профиля (сборки) в панели GML, которую запускает лаунчер.
pub fn gml_profile_name() -> String {
    crate::obf_str!("PolitEmpire")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Выделяемая память в мегабайтах (для -Xmx)
    pub memory_mb: u32,
    /// Путь до установленной сборки игры
    pub game_dir: String,
    /// Сохранённый accessToken сессии GML
    pub session_token: Option<String>,
    /// Ник игрока (заполняется после авторизации)
    pub nickname: Option<String>,
    /// UUID игрока, выданный GML при авторизации
    #[serde(default)]
    pub user_uuid: Option<String>,
    /// Уникальный идентификатор устройства (X-HWID для GML)
    #[serde(default)]
    pub hwid: Option<String>,
    /// Путь до java.exe (пусто = искать автоматически)
    pub java_path: String,
    /// Включённые опциональные моды (имена файлов из манифеста GML)
    #[serde(default)]
    pub enabled_optional_mods: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        let game_dir = default_game_dir().to_string_lossy().to_string();
        Self {
            memory_mb: 4096,
            game_dir,
            session_token: None,
            nickname: None,
            user_uuid: None,
            hwid: None,
            java_path: String::new(),
            enabled_optional_mods: Vec::new(),
        }
    }
}

/// Возвращает стабильный HWID устройства (генерируется один раз и сохраняется).
pub fn get_or_create_hwid() -> String {
    let mut settings = load_settings();
    if let Some(h) = &settings.hwid {
        if !h.is_empty() {
            return h.clone();
        }
    }
    let hwid = uuid::Uuid::new_v4().to_string();
    settings.hwid = Some(hwid.clone());
    let _ = persist_settings(&settings);
    hwid
}

pub fn default_game_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PolitEmpire")
}

/// Каталог служебных данных лаунчера (настройки, отчёты античита и т.п.).
pub fn launcher_data_dir() -> PathBuf {
    let dir = default_game_dir();
    let _ = fs::create_dir_all(&dir);
    dir
}

fn settings_path() -> PathBuf {
    default_game_dir().join("launcher-settings.json")
}

pub fn load_settings() -> Settings {
    let path = settings_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<Settings>(&raw) {
            return s;
        }
    }
    Settings::default()
}

pub fn persist_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings() -> Settings {
    load_settings()
}

#[tauri::command]
pub fn save_settings(settings: Settings) -> Result<(), String> {
    persist_settings(&settings)
}

/// Открывает путь в системном проводнике.
/// Если `select = true`, открывает родительскую папку и выделяет сам файл
/// (используется для java.exe); иначе открывает саму папку.
#[tauri::command]
pub fn open_in_explorer(path: String, select: bool) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Путь не задан".into());
    }
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Путь не существует".into());
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // explorer.exe часто возвращает ненулевой код даже при успехе,
        // поэтому статус не проверяем — важно лишь, что процесс запущен.
        if select && p.is_file() {
            Command::new("explorer")
                .arg(format!("/select,{}", p.display()))
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            // Для файла без выделения открываем его каталог.
            let dir = if p.is_file() {
                p.parent().map(|d| d.to_path_buf()).unwrap_or(p.clone())
            } else {
                p.clone()
            };
            Command::new("explorer")
                .arg(dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = select;
        Err("Открытие проводника поддерживается только на Windows".into())
    }
}

/// Открывает системный диалог выбора файла java.exe и возвращает выбранный
/// путь (или None, если пользователь закрыл диалог).
#[tauri::command]
pub fn pick_java_file() -> Option<String> {
    let mut dialog = rfd::FileDialog::new().set_title("Выберите java.exe");
    // Стартуем из типичного каталога Java, если он есть.
    let hint = PathBuf::from("C:\\Program Files\\Java");
    if hint.exists() {
        dialog = dialog.set_directory(hint);
    }
    #[cfg(target_os = "windows")]
    {
        dialog = dialog.add_filter("Java (java.exe)", &["exe"]);
    }
    dialog
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// Открывает системный диалог выбора папки (для папки со сборкой) и возвращает
/// выбранный путь (или None, если пользователь закрыл диалог).
#[tauri::command]
pub fn pick_folder(current: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().set_title("Выберите папку со сборкой");
    // Стартуем из текущей папки, если она указана и существует.
    if let Some(cur) = current {
        let p = PathBuf::from(&cur);
        if p.is_dir() {
            dialog = dialog.set_directory(p);
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() {
                dialog = dialog.set_directory(parent);
            }
        }
    }
    dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}
