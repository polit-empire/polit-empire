use futures_util::StreamExt;
use serde::Serialize;
use std::sync::Mutex;

use crate::auth::launcher_user_agent;
use crate::config::api_base;

/// Версия лаунчера берётся из Cargo.toml — при сборке новой версии
/// достаточно поднять `version` в Cargo.toml и tauri.conf.json.
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Default)]
pub struct UpdateProgress {
    pub stage: String, // "downloading" | "installing" | "error"
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub error: Option<String>,
}

static UPDATE_PROGRESS: Mutex<Option<UpdateProgress>> = Mutex::new(None);

fn set_update_progress(p: UpdateProgress) {
    *UPDATE_PROGRESS.lock().unwrap() = Some(p);
}

#[tauri::command]
pub fn get_update_progress() -> Option<UpdateProgress> {
    UPDATE_PROGRESS.lock().unwrap().clone()
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    #[serde(rename = "latestVersion")]
    pub latest_version: String,
    pub changelog: String,
}

/// Разбирает "1.2.3" в числа; мусор и суффиксы игнорируются.
fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| {
            part.chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse()
                .unwrap_or(0)
        })
        .collect()
}

fn is_newer(latest: &str, current: &str) -> bool {
    let a = parse_version(latest);
    let b = parse_version(current);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// Проверяет наличие новой версии лаунчера на сайте.
#[tauri::command]
pub async fn check_launcher_update() -> Result<UpdateInfo, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/launcher/version", api_base()))
        .header("User-Agent", launcher_user_agent())
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| format!("Сервер обновлений недоступен: {e}"))?;

    if !res.status().is_success() {
        // Версия не опубликована — считаем, что обновлений нет.
        return Ok(UpdateInfo {
            available: false,
            current_version: CURRENT_VERSION.into(),
            latest_version: CURRENT_VERSION.into(),
            changelog: String::new(),
        });
    }

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Некорректный ответ сервера обновлений: {e}"))?;

    let latest = body["version"].as_str().unwrap_or(CURRENT_VERSION).to_string();
    let changelog = body["changelog"].as_str().unwrap_or_default().to_string();

    Ok(UpdateInfo {
        available: is_newer(&latest, CURRENT_VERSION),
        current_version: CURRENT_VERSION.into(),
        latest_version: latest,
        changelog,
    })
}

/// Скачивает новый установщик и тихо переустанавливает лаунчер.
/// NSIS-инсталлер запускается с флагом /S (silent), после установки
/// лаунчер перезапускается автоматически. Пользователь ничего не нажимает.
#[tauri::command]
pub async fn apply_launcher_update() -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Автообновление поддерживается только на Windows.".into());
    }

    #[cfg(target_os = "windows")]
    {
        set_update_progress(UpdateProgress {
            stage: "downloading".into(),
            ..Default::default()
        });

        let client = reqwest::Client::new();
        let installer = std::env::temp_dir().join("PolitEmpireLauncher-Update.exe");
        // Прошлогодний недокачанный установщик (другая версия) докачивать нельзя —
        // качаем сессию с нуля, а обрывы внутри этой сессии докачиваются ниже.
        let _ = std::fs::remove_file(&installer);
        let (bytes_done, bytes_total) = download_update_installer(&client, installer.clone()).await?;

        set_update_progress(UpdateProgress {
            stage: "installing".into(),
            bytes_done,
            bytes_total,
            error: None,
        });

        // Батник: ждём выхода лаунчера, тихо ставим обновление, перезапускаем.
        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let bat = std::env::temp_dir().join("politempire-launcher-update.bat");
        let script = format!(
            "@echo off\r\n\
             ping -n 3 127.0.0.1 >nul\r\n\
             \"{installer}\" /S\r\n\
             start \"\" \"{exe}\"\r\n\
             del \"{installer}\"\r\n",
            installer = installer.display(),
            exe = current_exe.display(),
        );
        std::fs::write(&bat, script).map_err(|e| e.to_string())?;

        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", &bat.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Не удалось запустить установщик: {e}"))?;

        // Завершаем лаунчер, чтобы инсталлер мог заменить файлы.
        std::process::exit(0);
    }
}

/// Скачивает установщик в файл `dest` с ретраями и докачкой.
///
/// У части игроков (Cloudflare WARP, ТСПУ/DPI) соединение рвётся посреди
/// файла — "error decoding response body". Раньше скачивание стартовало с
/// нуля каждый раз и у русских игроков на крупном установщике обрывалось
/// у половины. Теперь частично скачанный файл НЕ удаляется: следующая
/// попытка идёт с Range и докачивает файл с места остановки.
/// Возвращает (скачано_байт, всего_байт).
#[cfg(target_os = "windows")]
async fn download_update_installer(client: &reqwest::Client, dest: std::path::PathBuf) -> Result<(u64, u64), String> {
    const UPDATE_ATTEMPTS: u32 = 8;
    let mut last_err = "Не удалось скачать обновление".to_string();
    let mut total_size: u64 = 0;
    let mut bytes_done: u64 = 0;
    let mut last_tick = std::time::Instant::now();

    for attempt in 1..=UPDATE_ATTEMPTS {
        let resumed = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);

        let mut req = client
            .get(format!("{}/api/launcher/download", api_base()))
            .header("User-Agent", launcher_user_agent())
            // Игровой качальщик и здесь: без сжатия, иначе прозрачный gzip
            // ломает докачку Range (смещения не сходятся).
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
        if resumed > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={resumed}-"));
        }

        // Заглушка /wait (анти-DDoS) — чужой HTML вместо файла: удаляем всё и
        // повторяем позже. Всё остальное: ретраим с места остановки.
        let res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("Ошибка сети при скачивании обновления: {e}");
                sleep_backoff(attempt).await;
                continue;
            }
        };

        // Сервер не поддержал Range (или первая попытка) — качаем с нуля.
        let mut restart = false;
        if res.status() == reqwest::StatusCode::OK && resumed > 0 {
            let _ = std::fs::remove_file(&dest);
            restart = true;
        }
        if restart {
            last_err = "Сервер не поддержал докачку, перекачиваю с нуля".to_string();
            sleep_backoff(attempt).await;
            continue;
        }

        if !res.status().is_success() {
            last_err = format!("Обновление недоступно: HTTP {}", res.status());
            sleep_backoff(attempt).await;
            continue;
        }

        total_size = res
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split('/').nth(1))
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or_else(|| res.content_length().unwrap_or(0) + resumed);

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&dest)
            .map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::with_capacity(256 * 1024, &mut file);
        let mut stream = res.bytes_stream();
        let mut result: Result<(), String> = Ok(());

        loop {
            let chunk = match tokio::time::timeout(std::time::Duration::from_secs(30), stream.next())
                .await
            {
                Ok(Some(Ok(chunk))) => chunk,
                Ok(Some(Err(e))) => {
                    result = Err(e.to_string());
                    break;
                }
                Ok(None) => break,
                Err(_) => {
                    result = Err("сервер перестал передавать данные (таймаут 30с)".to_string());
                    break;
                }
            };
            if let Err(e) = std::io::Write::write_all(&mut writer, &chunk) {
                result = Err(e.to_string());
                break;
            }
            bytes_done += chunk.len() as u64;
            if last_tick.elapsed().as_millis() >= 150 {
                set_update_progress(UpdateProgress {
                    stage: "downloading".into(),
                    bytes_done,
                    bytes_total: total_size,
                    error: None,
                });
                last_tick = std::time::Instant::now();
            }
        }
        if result.is_ok() {
            if let Err(e) = std::io::Write::flush(&mut writer) {
                result = Err(e.to_string());
            }
        }
        drop(writer);

        match result {
            Ok(()) => {
                // Проверяем размер: поток завершился, но файл может быть короче
                // ожидаемого (сервер отдал меньше обещанного).
                let on_disk = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
                if total_size > 0 && on_disk == total_size {
                    return Ok((on_disk, total_size));
                }
                if total_size > 0 {
                    last_err = format!(
                        "Установщик скачан не полностью ({on_disk} из {total_size} байт)"
                    );
                } else {
                    // Content-Length/Content-Range отсутствуют — считаем, что готово.
                    return Ok((on_disk, on_disk));
                }
            }
            Err(e) => {
                last_err = format!("Ошибка сети при скачивании обновления: {e}");
                // Поток был сжат транзитом — tmp не совпадает со смещениями
                // Range сервера; докачка бессмысленна, качаем с нуля.
                if e.to_lowercase().contains("decoding") {
                    let _ = std::fs::remove_file(&dest);
                    bytes_done = 0;
                }
            }
        }

        bytes_done = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        crate::telemetry::report_launcher_log(
            "warn",
            &format!("{last_err} (попытка {attempt}/{UPDATE_ATTEMPTS})"),
        );
        sleep_backoff(attempt).await;
    }

    Err(last_err)
}

#[cfg(target_os = "windows")]
async fn sleep_backoff(attempt: u32) {
    tokio::time::sleep(std::time::Duration::from_secs((attempt.min(6) * 2) as u64)).await;
}
