use serde::{Deserialize, Serialize};

use crate::auth::launcher_user_agent;
use crate::config::api_base;

/// Статус техработ с сайта.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceStatus {
    /// Техработы где-либо включены (сайт и/или лаунчер).
    #[serde(default)]
    pub enabled: bool,
    /// Техработы на сайте (заглушка посетителям).
    #[serde(default)]
    pub site: bool,
    /// Техработы в лаунчере (запуск игры только администраторам).
    #[serde(default)]
    pub launcher: bool,
    #[serde(default)]
    pub message: String,
    /// Текущий игрок — администратор, ему разрешён запуск во время техработ.
    #[serde(default)]
    pub admin_allowed: bool,
}

/// Текущий статус техработ для отображения в интерфейсе лаунчера.
#[tauri::command]
pub async fn get_maintenance_status() -> Result<MaintenanceStatus, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/maintenance", api_base()))
        .header("User-Agent", launcher_user_agent())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Не удалось проверить статус техработ: {e}"))?;
    let status: MaintenanceStatus = res
        .json()
        .await
        .map_err(|e| format!("Некорректный ответ сервера: {e}"))?;
    Ok(status)
}

/// Проверка техработ перед запуском игры.
///
/// fail-open: если сайт недоступен или ответ испорчен — не блокируем вход,
/// чтобы перебои сети не мешали играть. Блокируем только когда сервер явно
/// сообщил «техработы в лаунчере включены» и текущий игрок не администратор.
pub async fn maintenance_guard(session_token: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = match client
        .get(format!("{}/api/maintenance", api_base()))
        .header("User-Agent", launcher_user_agent())
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {session_token}"))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    if !res.status().is_success() {
        return Ok(());
    }

    let info: MaintenanceStatus = match res.json().await {
        Ok(i) => i,
        Err(_) => return Ok(()),
    };

    if info.launcher && !info.admin_allowed {
        let text = info.message.trim();
        let message = if text.is_empty() {
            "Сервер на техработах. Попробуйте позже.".to_string()
        } else {
            format!("Сервер на техработах: {text}")
        };
        return Err(message);
    }
    Ok(())
}