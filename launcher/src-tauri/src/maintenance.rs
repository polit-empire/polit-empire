use serde::Deserialize;

use crate::auth::launcher_user_agent;
use crate::config::api_base;

/// Статус техработ с сайта. Во время техработ игра запускается только
/// администраторами (флаг `admin_allowed` вычисляет сервер по токену сессии).
#[derive(Debug, Deserialize)]
struct MaintenanceStatus {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    message: String,
    #[serde(default)]
    admin_allowed: bool,
}

/// Проверка техработ перед запуском игры.
///
/// fail-open: если сайт недоступен или ответ испорчен — не блокируем вход,
/// чтобы перебои сети не мешали играть. Блокируем только когда сервер явно
/// сообщил «техработы включены» и текущий игрок не администратор.
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

    if info.enabled && !info.admin_allowed {
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