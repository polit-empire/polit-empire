use futures_util::StreamExt;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::auth::launcher_user_agent;
use crate::config::{authlib_api_base, gml_profile_name, load_settings};
use crate::integrity::{diff_manifest, remove_unmanaged_files, Manifest, ManifestFile};
use crate::security::{final_integrity_check, validate_launch_args};

#[derive(Debug, Clone, Serialize, Default)]
pub struct SyncProgress {
    pub stage: String, // "manifest" | "checking" | "downloading" | "cleaning" | "launching" | "done" | "error"
    pub current_file: String,
    pub files_done: usize,
    pub files_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub error: Option<String>,
}

static PROGRESS: Mutex<Option<SyncProgress>> = Mutex::new(None);
static CANCELLED: AtomicBool = AtomicBool::new(false);

fn set_progress(p: SyncProgress) {
    *PROGRESS.lock().unwrap() = Some(p);
}

#[tauri::command]
pub fn get_sync_progress() -> Option<SyncProgress> {
    PROGRESS.lock().unwrap().clone()
}

#[tauri::command]
pub fn cancel_sync() {
    CANCELLED.store(true, Ordering::SeqCst);
}

/// Тип ОС в формате GML (GmlCore.Interfaces.Enums.OsType).
fn gml_os_type() -> &'static str {
    if cfg!(target_os = "windows") {
        "3" // Windows
    } else if cfg!(target_os = "macos") {
        "2" // OsX
    } else {
        "1" // Linux
    }
}

/// Профиль сборки, полученный от Gml.Web.Api (profiles/info).
struct GmlProfile {
    manifest: Manifest,
    java_path: String,
    arguments: String,
}

/// Запрашивает у GML информацию о профиле: список файлов, аргументы запуска, Java.
async fn fetch_gml_profile(
    client: &reqwest::Client,
    token: &str,
    nickname: &str,
    user_uuid: &str,
    memory_mb: u32,
) -> Result<GmlProfile, String> {
    let payload = serde_json::json!({
        "UserName": nickname,
        "ProfileName": gml_profile_name(),
        "UserUuid": user_uuid,
        "OsType": gml_os_type(),
        "OsArchitecture": std::env::consts::ARCH.replace("x86_64", "64").replace("aarch64", "arm64"),
        "RamSize": memory_mb,
        "IsFullScreen": false,
        "GameAddress": "",
        "GamePort": 0,
        "WindowWidth": 900,
        "WindowHeight": 600
    });

    // profiles/info у части российских игроков падает с "error sending request"
    // (DPI/ТСПУ рвёт соединение с прямым доменом politempire.ru) или отдаёт
    // транзиентный 403/5xx. Стратегия: перебираем хосты (прямой домен →
    // резервный Cloudflare gml.politempire.org, оба проксируют один бэкенд),
    // на каждом делаем несколько попыток с паузой. Соединение не установилось —
    // сразу пробуем следующий хост. Первый успешно ответивший хост запоминаем
    // на всю сессию (скачивание/authlib пойдут через него). На экран входа НЕ
    // выкидываем. Каждая неудачная попытка пишется в админку.
    let hosts = crate::config::gml_host_candidates();
    const ATTEMPTS_PER_HOST: u32 = 2;
    let mut last_err = "Не удалось получить профиль сборки".to_string();
    let mut body: Option<serde_json::Value> = None;

    'hosts: for host in &hosts {
        for attempt in 1..=ATTEMPTS_PER_HOST {
            let res = client
                .post(format!("{host}/api/v1/profiles/info"))
                .header("User-Agent", launcher_user_agent())
                .header("Authorization", token)
                .json(&payload)
                .send()
                .await;

            match res {
                Ok(r) if r.status().is_success() => {
                    // Тело читаем устойчиво: обрыв тела или не-JSON (обрезка
                    // DPI, HTML-заглушка анти-DDoS /wait) — транзиентная
                    // ошибка, а не причина валить запуск: повторяем.
                    match r.text().await {
                        Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                            Ok(v) => {
                                body = Some(v);
                                // Хост рабочий — фиксируем его для остальных вызовов сессии.
                                crate::config::set_resolved_gml_host(host);
                                crate::telemetry::report_launcher_log("info", &format!("profiles/info: успех через {host}"));
                                break 'hosts;
                            }
                            Err(e) => {
                                let snippet: String = raw.chars().take(200).collect();
                                last_err = format!("Некорректный ответ сервера: {e}");
                                crate::telemetry::report_launcher_log(
                                    "warn",
                                    &format!("profiles/info @ {host}: ответ не JSON ({e}); начало: {snippet} (попытка {attempt}/{ATTEMPTS_PER_HOST})"),
                                );
                            }
                        },
                        Err(e) => {
                            last_err = format!("Некорректный ответ сервера: {e}");
                            crate::telemetry::report_launcher_log(
                                "warn",
                                &format!("profiles/info @ {host}: тело ответа оборвалось — {e} (попытка {attempt}/{ATTEMPTS_PER_HOST})"),
                            );
                        }
                    }
                    if attempt < ATTEMPTS_PER_HOST {
                        tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)).await;
                    }
                }
                Ok(r) => {
                    let status = r.status();
                    let code = status.as_u16();
                    let detail: String = r.text().await.unwrap_or_default().chars().take(300).collect();
                    let tail = if detail.trim().is_empty() { String::new() } else { format!(" Ответ сервера: {detail}") };
                    last_err = if code == 403 {
                        format!("Сервер отклонил доступ к сборке (403). Если вы недавно входили — попробуйте войти заново.{tail}")
                    } else {
                        format!("Ошибка получения профиля: HTTP {code}.{tail}")
                    };
                    crate::telemetry::report_launcher_log(
                        "warn",
                        &format!("profiles/info @ {host}: HTTP {code} (попытка {attempt}/{ATTEMPTS_PER_HOST})"),
                    );
                    // Транзиентные коды повторяем на том же хосте; иначе сразу к следующему.
                    // 403/429/5xx — транзиентные. 404/405 в нашей схеме почти
                    // всегда означают заглушку анти-DDoS хостинга (/wait) —
                    // тоже повторяем, затем уходим на резервный хост.
                    let transient = code == 403
                        || code == 404
                        || code == 405
                        || code == 429
                        || status.is_server_error();
                    if !transient {
                        continue 'hosts;
                    }
                    if attempt < ATTEMPTS_PER_HOST {
                        tokio::time::sleep(std::time::Duration::from_secs(attempt as u64)).await;
                    }
                }
                Err(e) => {
                    // Соединение не установилось — этот хост недоступен, к следующему.
                    last_err = format!("Сервер недоступен: {e}");
                    crate::telemetry::report_launcher_log(
                        "warn",
                        &format!("profiles/info @ {host}: соединение не удалось — {e}"),
                    );
                    continue 'hosts;
                }
            }
        }
    }

    let body = match body {
        Some(b) => b,
        None => {
            crate::telemetry::report_launcher_log("error", &format!("profiles/info: все хосты недоступны — {last_err}"));
            return Err(last_err);
        }
    };

    let data = &body["data"];
    let files: Vec<ManifestFile> = data["files"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|f| {
            let dir = f["directory"].as_str()?;
            Some(ManifestFile {
                path: dir.replace('\\', "/").trim_start_matches('/').to_string(),
                hash: f["hash"].as_str().unwrap_or_default().to_string(),
                size: f["size"].as_u64().unwrap_or(0),
            })
        })
        .collect();

    if files.is_empty() {
        return Err("Сборка пуста или не опубликована. Соберите профиль в панели GML.".into());
    }

    // Каталоги mods/ выводим ИЗ САМОГО манифест�� (до фильтрации опциональных),
    // а не хардкодим один путь. Раньше очистка смотрела только в
    // `clients/PolitEmpire/mods`; если GML отдаёт файлы с другим префиксом, этот
    // каталог не существовал → abs_dir.exists() == false → лишние моды (в т.ч.
    // отсутствующие в профиле и *.DISABLED) НЕ удалялись. Теперь берём реальные
    // директории, где действительно лежат моды сборки.
    let mut mods_dirs: std::collections::HashSet<String> =
        files.iter().filter_map(|f| mods_dir_of(&f.path)).collect();
    // Подстраховка на случай пустого mods в манифесте.
    mods_dirs.insert(format!("clients/{}/mods", gml_profile_name()));
    let managed_dirs: Vec<String> = mods_dirs.into_iter().collect();

    // Опциональные моды (файлы *-optional-mod*): оставля��м только выбранные
    // пользователем. Невыбранные исключа��тся из манифеста — их не ��ачаем,
    // а очистка mods/ удали�� их с диска, если они были включены раньше.
    let enabled = &load_settings().enabled_optional_mods;
    let files: Vec<ManifestFile> = files
        .into_iter()
        .filter(|f| {
            if !is_optional_mod(&f.path) {
                return true;
            }
            let name = file_name_of(&f.path);
            enabled.iter().any(|e| e == &name)
        })
        .collect();

    Ok(GmlProfile {
        manifest: Manifest {
            build_version: data["clientVersion"].as_str().unwrap_or("unknown").to_string(),
            files,
            managed_dirs,
        },
        java_path: data["javaPath"].as_str().unwrap_or_default().to_string(),
        arguments: data["arguments"].as_str().unwrap_or_default().to_string(),
    })
}

/// Является ли файл манифеста опциональным модом GML.
fn is_optional_mod(path: &str) -> bool {
    path.contains("/mods/") && file_name_of(path).contains("-optional-mod")
}

/// Имя файла из пути манифеста.
fn file_name_of(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// Возвращает каталог mods из пути файла манифеста, включая сегмент "mods".
/// Например "clients/PolitEmpire/mods/create.jar" -> "clients/PolitEmpire/mods".
/// Если сегмента "mods" в пути нет — None (файл не относится к модам).
fn mods_dir_of(path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    // Ищем последний сегмент-директорию "mods" (не имя файла).
    for i in (0..parts.len() - 1).rev() {
        if parts[i].eq_ignore_ascii_case("mods") {
            return Some(parts[..=i].join("/"));
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
pub struct OptionalMod {
    pub file: String,
    pub title: String,
    pub description: String,
    pub enabled: bool,
}

/// Список опциональных модов сборки: файлы из манифеста GML + человекочитаемые
/// названия/описания с сайта (прокси к панели GML).
#[tauri::command]
pub async fn get_optional_mods() -> Result<Vec<OptionalMod>, String> {
    let settings = load_settings();
    let token = settings
        .session_token
        .clone()
        .ok_or("Нет активной сессии.")?;
    let nickname = settings.nickname.clone().ok_or("Нет активной сессии.")?;
    let user_uuid = settings.user_uuid.clone().unwrap_or_default();

    let client = reqwest::Client::new();

    let payload = serde_json::json!({
        "UserName": nickname,
        "ProfileName": gml_profile_name(),
        "UserUuid": user_uuid,
        "OsType": gml_os_type(),
        "OsArchitecture": std::env::consts::ARCH.replace("x86_64", "64").replace("aarch64", "arm64"),
        "RamSize": settings.memory_mb,
        "IsFullScreen": false,
        "GameAddress": "",
        "GamePort": 0,
        "WindowWidth": 900,
        "WindowHeight": 600
    });

    // Все файлы профиля (без фильтрации) — берём напрямую из profiles/info.
    // Перебираем хосты (прямой → резервный Cloudflare) на случай блокировки.
    let hosts = crate::config::gml_host_candidates();
    let mut res = None;
    let mut last_err = "Сервер недоступен".to_string();
    for host in &hosts {
        match client
            .post(format!("{host}/api/v1/profiles/info"))
            .header("User-Agent", launcher_user_agent())
            .header("Authorization", &token)
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => match r.error_for_status() {
                Ok(ok) => {
                    crate::config::set_resolved_gml_host(host);
                    res = Some(ok);
                    break;
                }
                Err(e) => {
                    last_err = format!("Ошибка получения профиля: {e}");
                    break; // HTTP-ошибка одинакова на всех хостах
                }
            },
            Err(e) => last_err = format!("Сервер недоступен: {e}"),
        }
    }
    let res = res.ok_or(last_err)?;

    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut mods: Vec<OptionalMod> = body["data"]["files"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|f| {
            let dir = f["directory"].as_str()?.replace('\\', "/");
            if !is_optional_mod(&dir) {
                return None;
            }
            let file = file_name_of(&dir);
            // Имя по умолчанию: очищаем суффиксы и расширение
            let title = file
                .trim_end_matches(".jar")
                .replace("-optional-mod", "")
                .to_string();
            Some(OptionalMod {
                enabled: settings.enabled_optional_mods.iter().any(|e| e == &file),
                file,
                title,
                description: String::new(),
            })
        })
        .collect();

    // Названия и описания из пане��и GML (через сайт). Ошибки не критичны.
    if let Ok(res) = client
        .get(format!("{}/api/launcher/optional-mods", crate::config::api_base()))
        .header("User-Agent", launcher_user_agent())
        .send()
        .await
    {
        if let Ok(details) = res.json::<serde_json::Value>().await {
            if let Some(list) = details["mods"].as_array() {
                for m in mods.iter_mut() {
                    let key = m.file.trim_end_matches(".jar");
                    if let Some(d) = list.iter().find(|d| d["name"].as_str() == Some(key)) {
                        if let Some(t) = d["title"].as_str() {
                            if !t.is_empty() {
                                m.title = t.to_string();
                            }
                        }
                        if let Some(desc) = d["description"].as_str() {
                            m.description = desc.to_string();
                        }
                    }
                }
            }
        }
    }

    mods.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(mods)
}

/// Сохраняет выбор опциональных модов.
#[tauri::command]
pub fn set_optional_mods(enabled: Vec<String>) -> Result<(), String> {
    let mut settings = load_settings();
    settings.enabled_optional_mods = enabled;
    crate::config::persist_settings(&settings)
}

/// Скачивает один файл манифеста, обновляя общий прогресс.
#[allow(clippy::too_many_arguments)]
async fn download_file(
    client: &reqwest::Client,
    token: &str,
    game_dir: &Path,
    entry: &ManifestFile,
    files_done: &AtomicUsize,
    bytes_done: &AtomicU64,
    files_total: usize,
    bytes_total: u64,
) -> Result<(), String> {
    if CANCELLED.load(Ordering::SeqCst) {
        return Err("Загрузка отменена".into());
    }

    set_progress(SyncProgress {
        stage: "downloading".into(),
        current_file: entry.path.clone(),
        files_done: files_done.load(Ordering::Relaxed),
        files_total,
        bytes_done: bytes_done.load(Ordering::Relaxed),
        bytes_total,
        error: None,
    });

    let target = game_dir.join(&entry.path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // До пяти попыток на файл: качаем во временный файл, сверяем SHA-1 с
    // манифестом и только после совпадения ставим на место. Битое скачивание
    // (обрыв соединения, HTML-заглушка анти-DDoS вместо файла) больше не
    // остаётся на диске и не валит финальную сверку целостности.
    const FILE_ATTEMPTS: u32 = 5;
    let hosts = crate::config::gml_host_candidates();
    let mut last_err = format!("Не удалось скачать файл {}", entry.path);

    for attempt in 1..=FILE_ATTEMPTS {
        if CANCELLED.load(Ordering::SeqCst) {
            return Err("Загрузка отменена".into());
        }

        // Запрос: перебираем хосты-кандидаты (сначала подтверждённый профилем).
        let mut res_opt = None;
        for host in &hosts {
            match client
                .get(format!("{host}/api/v1/file/{}", entry.hash))
                .header("User-Agent", launcher_user_agent())
                .header("Authorization", token)
                .send()
                .await
            {
                Ok(r) => {
                    let status = r.status();
                    let final_url = r.url().to_string();
                    // Анти-DDoS хостинга перехватывает запрос и уводит на
                    // страницу-заглушку /wait (после редиректа — 404/405 или
                    // HTML вместо файла). Это не проблема самого файла:
                    // пробуем другой хост, потом ждём и повторяем.
                    let is_wait_stub = final_url.contains("/wait")
                        || r.headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .map(|v| v.contains("text/html"))
                            .unwrap_or(false);
                    if status.is_success() && !is_wait_stub {
                        crate::config::set_resolved_gml_host(host);
                        res_opt = Some(r);
                        break;
                    }
                    if is_wait_stub {
                        last_err = format!(
                            "Файл {}: защита хостинга отдала заглушку /wait (HTTP {})",
                            entry.path,
                            status.as_u16()
                        );
                        // Заглушка — особенность конкретного хоста: пробуем
                        // следующий (резервный), потом повторяем с паузой.
                        continue;
                    }
                    last_err = format!("Файл {} недоступен: HTTP {}", entry.path, status.as_u16());
                    // Настоящая HTTP-ошибка одинакова на всех хостах — дальше не перебираем.
                    break;
                }
                Err(e) => {
                    // Соединение не удалось — пробуем следующий хост.
                    last_err = format!("Ошибка сети при скачивании {}: {e}", entry.path);
                }
            }
        }
        let Some(res) = res_opt else {
            if attempt < FILE_ATTEMPTS {
                // Пауза растёт с каждой попыткой — пережидаем анти-DDoS.
                tokio::time::sleep(std::time::Duration::from_secs((attempt * 2) as u64)).await;
                continue;
            }
            return Err(last_err);
        };

        // Качаем во временный файл рядом с целевым.
        let mut tmp_name = target.file_name().unwrap_or_default().to_os_string();
        tmp_name.push(".pe-tmp");
        let tmp = target.with_file_name(tmp_name);

        let mut written: u64 = 0;
        let stream_result: Result<(), String> = async {
            let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut writer = std::io::BufWriter::with_capacity(256 * 1024, file);
            let mut stream = res.bytes_stream();
            let mut last_tick = std::time::Instant::now();

            while let Some(chunk) = stream.next().await {
                if CANCELLED.load(Ordering::SeqCst) {
                    return Err("Загрузка отменена".into());
                }
                let chunk = chunk.map_err(|e| e.to_string())?;
                std::io::Write::write_all(&mut writer, &chunk).map_err(|e| e.to_string())?;
                written += chunk.len() as u64;
                bytes_done.fetch_add(chunk.len() as u64, Ordering::Relaxed);

                // Прогресс обновляем не чаще ~7 раз/сек, чтобы не душить mutex
                if last_tick.elapsed().as_millis() >= 150 {
                    set_progress(SyncProgress {
                        stage: "downloading".into(),
                        current_file: entry.path.clone(),
                        files_done: files_done.load(Ordering::Relaxed),
                        files_total,
                        bytes_done: bytes_done.load(Ordering::Relaxed),
                        bytes_total,
                        error: None,
                    });
                    last_tick = std::time::Instant::now();
                }
            }
            std::io::Write::flush(&mut writer).map_err(|e| e.to_string())?;
            Ok(())
        }
        .await;

        match stream_result {
            // Скачалось — сверяем SHA-1 с манифестом ДО того, как ставить на место.
            Ok(()) => match crate::integrity::hash_file(&tmp) {
                Ok(h) if h.eq_ignore_ascii_case(&entry.hash) => {
                    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
                    files_done.fetch_add(1, Ordering::Relaxed);
                    return Ok(());
                }
                Ok(h) => {
                    last_err = format!(
                        "Файл {} скачался повреждённым (SHA-1 {h}, ожидался {}).",
                        entry.path, entry.hash
                    );
                }
                Err(e) => {
                    last_err = format!("Не удалось проверить файл {}: {e}", entry.path);
                }
            },
            Err(e) => {
                if CANCELLED.load(Ordering::SeqCst) {
                    let _ = fs::remove_file(&tmp);
                    return Err("Загрузка отменена".into());
                }
                last_err = format!("Ошибка сети при скачивании {}: {e}", entry.path);
            }
        }

        // Неудачная попытка: убираем временный файл и откатываем прогресс.
        let _ = fs::remove_file(&tmp);
        bytes_done.fetch_sub(written, Ordering::Relaxed);
        crate::telemetry::report_launcher_log(
            "warn",
            &format!("{last_err} (попытка {attempt}/{FILE_ATTEMPTS})"),
        );
        if attempt < FILE_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_secs((attempt * 2) as u64)).await;
        }
    }

    Err(last_err)
}

/// Основная команда: скачать/проверить сборку через GML и запустить игру.
///
/// Тонкая обёртка над `sync_and_launch_inner`, которая фиксирует старт и любую
/// ошибку запуска в админ-логах (`source=launcher`). Раньше сбои до старта игр��
/// (например, 403 от profiles/info) нигде не логировались: стример логов
/// включается только ПОСЛЕ успешного запуска и читает лишь лог игры. Теперь
/// администратор видит причину неудачного «Играть» в панели.
#[tauri::command]
pub async fn sync_and_launch() -> Result<(), String> {
    crate::telemetry::report_launcher_log("info", "Нажата кнопка «Играть» — начинаю подготовку и запуск.");
    match sync_and_launch_inner().await {
        Ok(()) => {
            crate::telemetry::report_telemetry_event("game_start", "Игра успешно запущена");
            Ok(())
        }
        Err(e) => {
            // Живой лог (вкладка «логи») + событие в таблицу telemetry, чтобы
            // сбой был виден в разделе «Ошибки лаунчера» админки. Тип события
            // подбираем по тексту ошибки для удобной фильтрации.
            crate::telemetry::report_launcher_log("error", &format!("Запуск не удался: {e}"));
            let low = e.to_lowercase();
            let event_type = if e.contains("403") || low.contains("сесси") || low.contains("доступ") || low.contains("токен") {
                "auth_error"
            } else if low.contains("скач") || low.contains("загруз") || low.contains("файл") || low.contains("манифест") {
                "download_error"
            } else {
                "error"
            };
            crate::telemetry::report_telemetry_event(event_type, &format!("Запуск не удался: {e}"));
            Err(e)
        }
    }
}

async fn sync_and_launch_inner() -> Result<(), String> {
    CANCELLED.store(false, Ordering::SeqCst);
    let settings = load_settings();
    let token = settings
        .session_token
        .clone()
        .ok_or("Нет активной сессии. Войдите в аккаунт.")?;
    let nickname = settings.nickname.clone().ok_or("Нет активной сессии.")?;
    let user_uuid = settings.user_uuid.clone().unwrap_or_default();
    let game_dir = PathBuf::from(&settings.game_dir);
    fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;

    // Пул keep-alive соединений — бе�� него каждый файл открывает новое
    // TCP+TLS соединение, что и делало загрузку медленной.
    let client = reqwest::Client::builder()
        // Таймаут на установку соединения: зависший коннект не блокирует
        // запуск навсегда. Общий таймаут не ставим — клиент качает большие файлы.
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_max_idle_per_host(16)
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Получаем профиль сборки из GML (файлы + аргументы запуска)
    set_progress(SyncProgress { stage: "manifest".into(), ..Default::default() });
    let profile = fetch_gml_profile(&client, &token, &nickname, &user_uuid, settings.memory_mb).await?;
    let manifest = &profile.manifest;

    // 2. Проверяем целостность (SHA-1, как в GML)
    set_progress(SyncProgress { stage: "checking".into(), ..Default::default() });
    let to_download = diff_manifest(&game_dir, manifest);
    let bytes_total: u64 = to_download.iter().map(|f| f.size).sum();

    // 3. Скачиваем недостающие/повреждённые файлы из GML по хешу.
    // Параллельно (DOWNLOAD_CONCURRENCY соединений) — сотни мелких модов
    // качаются в разы быстрее, чем по одному.
    // 4 соединения вместо 8: сотни мелких файлов подряд провоцируют
    // анти-DDoS хостинга (заглушку /wait), качаем аккуратнее.
    const DOWNLOAD_CONCURRENCY: usize = 4;
    let files_total = to_download.len();
    let files_done = Arc::new(AtomicUsize::new(0));
    let bytes_done = Arc::new(AtomicU64::new(0));

    // entry передаётся по значению (owned) — замыкание с async-блоком,
    // захватывающее &ManifestFile, не компилируется из-за ограничения
    // компилятора на higher-ranked lifetimes ("FnOnce is not general enough").
    let mut downloads = futures_util::stream::iter(to_download.into_iter().map(|entry| {
        let client = client.clone();
        let token = token.clone();
        let game_dir = game_dir.clone();
        let files_done = Arc::clone(&files_done);
        let bytes_done = Arc::clone(&bytes_done);
        async move {
            download_file(
                &client, &token, &game_dir, &entry, &files_done, &bytes_done, files_total, bytes_total,
            )
            .await
        }
    }))
    .buffer_unordered(DOWNLOAD_CONCURRENCY);

    while let Some(result) = downloads.next().await {
        if let Err(e) = result {
            set_progress(SyncProgress { stage: "error".into(), error: Some(e.clone()), ..Default::default() });
            return Err(e);
        }
    }
    drop(downloads);
    let bytes_done = bytes_done.load(Ordering::Relaxed);

    // 4. Удаляем посторонние файлы из mods/ и других контролируемых папок
    set_progress(SyncProgress { stage: "cleaning".into(), files_done: files_total, files_total, bytes_done, bytes_total, ..Default::default() });
    let removed = remove_unmanaged_files(&game_dir, manifest);
    if !removed.is_empty() {
        crate::telemetry::report_launcher_log(
            "info",
            &format!("Очистка: удалено лишних файлов — {} ({})", removed.len(), removed.join(", ")),
        );
    }

    // 5. Защита: отладчик на лаунчере + запущенные инжекторы/отладчики/сниферы
    set_progress(SyncProgress { stage: "launching".into(), files_done: files_total, files_total, bytes_done, bytes_total, ..Default::default() });
    if let Err(msg) = crate::antitamper::preflight() {
        set_progress(SyncProgress { stage: "error".into(), error: Some(msg.clone()), ..Default::default() });
        return Err(msg);
    }

    // 5b. Self-integrity: сервер сверяет SHA-256 самого лаунчера с белым списком
    // официальных сборок. Модифицированный лаунчер не получит подтверждения и
    // не запустит игру. Сетевые сбои — fail-open (см. verify_self_integrity).
    if let Err(msg) = crate::integrity::verify_self_integrity().await {
        set_progress(SyncProgress { stage: "error".into(), error: Some(msg.clone()), ..Default::default() });
        return Err(msg);
    }

    // 6. Финальная сверка целостности прямо перед запуском (защита от подмены
    // файлов). Если файлы не сошлись (обычно битое скачивание), не заставляем
    // игрока вручную перезапускать синхронизацию — автоматически перекачиваем
    // битые файлы и сверяем ещё раз.
    if let Err(first_err) = final_integrity_check(&game_dir, manifest) {
        let broken = diff_manifest(&game_dir, manifest);
        crate::telemetry::report_launcher_log(
            "warn",
            &format!(
                "Финальная сверка: {} файл(ов) не сошлось, перекачиваю автоматически: {}",
                broken.len(),
                broken.iter().map(|f| f.path.as_str()).collect::<Vec<_>>().join(", ")
            ),
        );
        let retry_files_total = broken.len();
        let retry_bytes_total: u64 = broken.iter().map(|f| f.size).sum();
        let retry_files_done = Arc::new(AtomicUsize::new(0));
        let retry_bytes_done = Arc::new(AtomicU64::new(0));
        for entry in &broken {
            download_file(
                &client, &token, &game_dir, entry, &retry_files_done, &retry_bytes_done,
                retry_files_total, retry_bytes_total,
            )
            .await?;
        }
        // Если не сошлось и после перекачивания — прежняя ошибка.
        final_integrity_check(&game_dir, manifest).map_err(|_| first_err)?;
    }

    // 7. Запускаем игру аргументами, которые сформировал GML
    launch_game(&game_dir, &settings.java_path, &profile)?;

    set_progress(SyncProgress { stage: "done".into(), files_done: files_total, files_total, bytes_done, bytes_total, ..Default::default() });
    Ok(())
}

/// Разбивает строку аргументов на токены с учётом кавычек (как shell).
/// `-cp "C:/game data/a.jar;C:/game data/b.jar" -Xmx6G` ->
/// ["-cp", "C:/game data/a.jar;C:/game data/b.jar", "-Xmx6G"].
/// Кавычки убираются: Command::args передаёт аргументы напрямую, без шелла.
fn split_arguments(input: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut has_token = false;

    for ch in input.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true; // пустая строка в кавычках — тоже аргумент
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    tokens.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        tokens.push(current);
    }
    tokens
}

/// authlib-injector.jar, вшитый в бинарник лаунчера (см. build.rs). Если при
/// сборке jar не был найден — здесь окажется пустой срез, и javaagent не
/// ��обавляется (полагаемся на аргументы GML).
static EMBEDDED_AUTHLIB: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/authlib-injector.jar"));

/// Распаковывает вшитый authlib-injector.jar в каталог игры и возвращает путь.
/// Перезаписывает файл, только если его нет или размер отличается (быстрая
/// проверка целостности без хеширования). Путь лежит ВНУТРИ game_dir, чтобы
/// пройти проверку `validate_launch_args`.
fn ensure_authlib_jar(game_dir: &Path) -> Option<PathBuf> {
    if EMBEDDED_AUTHLIB.is_empty() {
        return None; // при сборке jar не встроен
    }
    let dst = game_dir.join("authlib-injector.jar");
    let need_write = match fs::metadata(&dst) {
        Ok(m) => m.len() != EMBEDDED_AUTHLIB.len() as u64,
        Err(_) => true,
    };
    if need_write {
        if let Err(e) = fs::write(&dst, EMBEDDED_AUTHLIB) {
            eprintln!("[v0] Не удалось распаковать authlib-injector.jar: {e}");
            return None;
        }
    }
    Some(dst)
}

/// Принудительно подставл��ет прямой authlib-эндпоинт в аргумент запуска.
///
/// Работает и с плейсхолдером `{authEndpoint}` (уже заменён выше), и со
/// случаем, когда GML «запёк» полный URL панели. Для аргумента вида
/// `-javaagent:<...>/authlib-injector-x.y.z.jar=<URL>` заменяет часть после
/// первого `=` (сам URL) на `endpoint`, не трогая путь к jar (его проверяет
/// `validate_launch_args`). Остальные аргументы возвращает без изменений.
fn force_authlib_endpoint(arg: String, endpoint: &str) -> String {
    let lower = arg.to_lowercase();
    if !lower.starts_with("-javaagent:") || !lower.contains("authlib-injector") {
        return arg;
    }
    // Разделяем на путь к jar и опцию (URL) по первому '='.
    match arg.split_once('=') {
        Some((jar, _url)) => format!("{jar}={endpoint}"),
        None => arg, // без '=' — оставляем как есть
    }
}

/// Запускает Minecraft аргументами из GML (profiles/info -> arguments).
/// GML подставляет ник, UUID и accessToken на се��вере; лаунчер заменяет
/// только плейсхолдеры {localPath} и {authEndpoint}.
fn launch_game(game_dir: &Path, java_path_override: &str, profile: &GmlProfile) -> Result<(), String> {
    if profile.arguments.trim().is_empty() {
        return Err("GML не вернул аргументы запуска — проверьте, что сборка соб����ана в панели.".into());
    }

    let local_path = game_dir.to_string_lossy().replace('\\', "/");
    // authlib-URL «запекается» в игру: клиент шл��т joinServer именно на него.
    // Берём хост, который оказался доступен при синхронизации (resolved_gml_host):
    // если прямой politempire.ru у игрока заблокирован и профиль скачался через
    // резервный gml.politempire.org, то и join должен идти туда же — иначе игра
    // не сможет достучаться до authlib. Оба домена проксируют один бэкенд с общим
    // хранилищем сессий, поэтому серверный hasJoined всё равно найдёт сессию.
    let gml_base = crate::config::resolved_gml_host().unwrap_or_else(authlib_api_base);
    let auth_endpoint = format!("{gml_base}/api/v1/integrations/authlib/minecraft");

    // ВАЖНО: GML возвращает строку аргументов, где пути с пробелами
    // (например "game data", "shared data") обёрнуты в кавычки.
    // Обычный split_whitespace режет такие пути посередине, и Java падает
    // с "Could not find or load main class". Разбираем с учётом кавычек.
    let mut args: Vec<String> = split_arguments(&profile.arguments)
        .into_iter()
        .map(|tok| {
            tok.replace("{localPath}", &local_path)
                .replace("{authEndpoint}", &auth_endpoint)
                .replace('\\', "/")
        })
        // ВАЖНО: GML часто «запекает» в аргументы полный URL панели
        // (gml.politempire.org, за Cloudflare) вместо плейсхолдера
        // {authEndpoint}. Тогда клиент шлёт joinServer на Cloudflare-домен,
        // а сервер проверяет hasJoined на politempire.ru — сессии не сходятся,
        // и игрок получает «недействительная сессия». Принудительно
        // переписываем authlib-injector URL на прямой домен, чтобы клиент и
        // сервер гарантированно ходили в один и тот же бэкенд.
        .map(|tok| force_authlib_endpoint(tok, &auth_endpoint))
        .collect();

    // ����РИТИЧНО: GML не всегда добавляет authlib-injector в аргументы клиента.
    // Без этого агента игра проверяет вход на настоящем sessionserver.mojang.com
    // (аккаунта там нет) и сервер отвечает «недействительная сессия». Если в
    // аргументах ещё нет authlib-injector — распаковываем вшитый jar и вставляем
    // -javaagent ПЕРВЫМ аргументом (JVM-опция обязана идти до главного класса).
    let has_authlib = args.iter().any(|a| {
        let l = a.to_lowercase();
        l.starts_with("-javaagent:") && l.contains("authlib-injector")
    });
    if !has_authlib {
        if let Some(jar) = ensure_authlib_jar(game_dir) {
            let jar_path = jar.to_string_lossy().replace('\\', "/");
            args.insert(0, format!("-javaagent:{jar_path}={auth_endpoint}"));
        } else {
            eprintln!(
                "[v0] authlib-injector не встроен и не задан GML — вход, скорее всего, не пройдёт."
            );
        }
    }

    // Харденинг JVM: запрещаем динамическое подключение агентов в рантайме
    // (self-attach через com.sun.tools.attach) — иначе чит грузит -javaagent уже
    // ПОСЛЕ старта, в обход validate_launch_args. Статический authlib-injector
    // (-javaagent при запуске) при этом продолжает работать.
    for flag in [
        "-XX:+DisableAttachMechanism",
        "-Djdk.attach.allowAttachSelf=false",
    ] {
        if !args.iter().any(|a| a.eq_ignore_ascii_case(flag)) {
            args.insert(0, flag.to_string());
        }
    }

    // Запрещаем посторонние javaagent и подключение отладчика к игре
    validate_launch_args(&args, game_dir)?;

    let java = if !java_path_override.is_empty() {
        java_path_override.to_string()
    } else if !profile.java_path.is_empty() {
        profile
            .java_path
            .replace("{localPath}", &local_path)
            .replace('\\', "/")
    } else {
        "java".to_string()
    };

    // Лог запуска: полная команда + вывод Java. Если игра падает на старте,
    // причина будет в этом файле.
    let log_path = game_dir.join("launcher-game.log");
    let mut log_header = format!(
        "=== Запуск {} ===\njava: {java}\nargs:\n",
        chrono_free_timestamp()
    );
    for a in &args {
        log_header.push_str("  ");
        log_header.push_str(a);
        log_header.push('\n');
    }
    let _ = fs::write(&log_path, &log_header);

    let log_out = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Не удалось создать лог запуска: {e}"))?;
    let log_err = log_out
        .try_clone()
        .map_err(|e| format!("Не удалось создать лог запуска: {e}"))?;

    // Секрет сессии античита (имя канала + session_id + токен) и путь скрытого
    // файла-отчёта передаём инжектируемой DLL через переменные окружения —
    // процесс игры наследует их от лаунчера, а инжектнутая DLL читает их изнутри.
    // Канал named pipe — основной, файл-отчёт — резервный.
    let ac_report = crate::inject::report_file_path();
    let ac_env = crate::inject::prepare_session();
    let mut command = Command::new(&java);
    command
        .args(&args)
        .current_dir(game_dir)
        .env(crate::obf_str!("PE_AC_REPORT"), &ac_report);
    // Вычищаем переменные окружения, через которые JVM молча подхватывает
    // посторонние -javaagent/JVM-опции (JAVA_TOOL_OPTIONS, _JAVA_OPTIONS и т.п.).
    // Это обход validate_launch_args: их выставляет читер, а не лаунчер, поэтому
    // удаляем у дочернего процесса игры до установки наших AC-переменных.
    for var in [
        "_JAVA_OPTIONS",
        "JAVA_TOOL_OPTIONS",
        "JDK_JAVA_OPTIONS",
        "JAVA_OPTIONS",
    ] {
        command.env_remove(var);
    }
    for (key, value) in &ac_env {
        command.env(key, value);
    }
    let mut child = command
        .stdout(log_out)
        .stderr(log_err)
        .spawn()
        .map_err(|e| format!("Не удалось запустить Java ({java}): {e}"))?;

    // Если Java умерла в первые секунды (кривые аргументы, нет JRE и т.п.) —
    // сообщаем об этом сразу, с хвостом лога, вместо тихого «ничего не происходит».
    std::thread::sleep(std::time::Duration::from_secs(3));
    if let Ok(Some(status)) = child.try_wait() {
        if !status.success() {
            let tail = fs::read_to_string(&log_path)
                .map(|s| {
                    let lines: Vec<&str> = s.lines().collect();
                    lines[lines.len().saturating_sub(15)..].join("\n")
                })
                .unwrap_or_default();
            return Err(format!(
                "Игра завершилась сразу после запуска (код {}).\nЛог: {}\n{}",
                status.code().unwrap_or(-1),
                log_path.display(),
                tail
            ));
        }
    }

    // Запоминаем процесс игры — нужен для принудительного закрытия при бане.
    let game_pid = child.id();
    *GAME_CHILD.lock().unwrap() = Some(child);

    // Minecraft успешно пережил стартовые 3 секунды — переключаем Discord RPC
    // с «В лаунчере» на «Играет на сервере» и запускаем таймер сессии.
    crate::discord_rpc::set_playing();

    // Засекаем начало игровой сессии для подсчёта наигранного времени.
    // Финализация (учёт длительности) произойдёт при завершении игры —
    // см. is_game_running()/kill_game().
    crate::stats::begin_session();

    // Запускаем античит: инжектим DLL в процесс игры и мониторим нар��шения.
    crate::inject::start_monitor(game_pid);

    // Стримим игровые логи на сайт (лайв-логи в админке) на время сессии.
    let session_id = uuid::Uuid::new_v4().to_string();
    crate::telemetry::start_log_stream(game_dir.to_path_buf(), session_id);

    Ok(())
}

/// Хэндл запущенного процесса игры (None — игра не запущена через лаунчер).
static GAME_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);

/// Возвращает true, если процесс игры, запущенный лаунчеро��, ещё жив.
#[tauri::command]
pub fn is_game_running() -> bool {
    let mut guard = GAME_CHILD.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None; // процесс завершился
                crate::stats::finish_session();
                crate::discord_rpc::set_launcher();
                false
            }
            Ok(None) => true,
            Err(_) => {
                // Если состояние процесса прочитать не удалось, больше не
                // считаем игру запущенной и возвращаем presence лаунчера.
                *guard = None;
                crate::stats::finish_session();
                crate::discord_rpc::set_launcher();
                false
            }
        }
    } else {
        false
    }
}

/// Пр��нудительно закрывает игру (используется при обнаружении бана).
#[tauri::command]
pub fn kill_game() -> Result<bool, String> {
    let mut guard = GAME_CHILD.lock().unwrap();
    if let Some(child) = guard.as_mut() {
        // Уже завершилась сама?
        if let Ok(Some(_)) = child.try_wait() {
            *guard = None;
            crate::stats::finish_session();
            crate::discord_rpc::set_launcher();
            return Ok(false);
        }
        child.kill().map_err(|e| format!("Не удалось закрыть игру: {e}"))?;
        let _ = child.wait();
        *guard = None;
        crate::stats::finish_session();
        crate::discord_rpc::set_launcher();
        return Ok(true);
    }
    // Игра уже не запущена — всё равно исправляем возможный устаревший RPC.
    crate::discord_rpc::set_launcher();
    Ok(false)
}

/// Простая временная метка без внешних зависимостей (UTC, unix-секунды).
fn chrono_free_timestamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(d) => format!("unix:{}", d.as_secs()),
        Err(_) => "unknown".into(),
    }
}
