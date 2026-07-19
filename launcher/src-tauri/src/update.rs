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
        .timeout(std::time::Duration::from_secs(10))
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
        let res = client
            .get(format!("{}/api/launcher/download", api_base()))
            .header("User-Agent", launcher_user_agent())
            .send()
            .await
            .map_err(|e| format!("Не удалось скачать обновление: {e}"))?
            .error_for_status()
            .map_err(|e| format!("Обновление недоступно: {e}"))?;

        let bytes_total = res.content_length().unwrap_or(0);
        let installer = std::env::temp_dir().join("PolitEmpireLauncher-Update.exe");

        let file = std::fs::File::create(&installer).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::with_capacity(256 * 1024, file);
        let mut stream = res.bytes_stream();
        let mut bytes_done: u64 = 0;
        let mut last_tick = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            std::io::Write::write_all(&mut writer, &chunk).map_err(|e| e.to_string())?;
            bytes_done += chunk.len() as u64;
            if last_tick.elapsed().as_millis() >= 150 {
                set_update_progress(UpdateProgress {
                    stage: "downloading".into(),
                    bytes_done,
                    bytes_total,
                    error: None,
                });
                last_tick = std::time::Instant::now();
            }
        }
        std::io::Write::flush(&mut writer).map_err(|e| e.to_string())?;

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
