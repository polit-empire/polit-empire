use serde::{Deserialize, Serialize};

use crate::config::{api_base, get_or_create_hwid, load_settings, persist_settings};

/// User-Agent лаунчера. Возвращается функцией (а не `const &str`), чтобы строка
/// не лежала в бинарнике открытым текстом — шифруется `obf_str!` (см. `obf.rs`).
pub fn launcher_user_agent() -> String {
    crate::obf_str!("PolitEmpireLauncher/1.0")
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResponse {
    pub token: Option<String>,
    pub nickname: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub banned: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyResponse {
    pub valid: bool,
    pub nickname: Option<String>,
    pub banned: bool,
}

/// Сообщает сайту HWID устройства и проверяет бан по железу.
/// Возвращает true, если устройство заблокировано. Сетевые ошибки
/// не считаются баном (fail-open, как и verify_session).
async fn report_hwid_and_check_ban(client: &reqwest::Client, token: &str) -> bool {
    let hwid = get_or_create_hwid();
    let res = client
        .post(format!("{}/api/launcher/hwid", api_base()))
        .header("User-Agent", launcher_user_agent())
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({ "hwid": hwid }))
        .send()
        .await;
    match res {
        Ok(r) if r.status().is_success() => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            body["banned"].as_bool().unwrap_or(false)
        }
        _ => false,
    }
}

/// Вход по нику и паролю через Gml.Web.Api.
/// GML сам проверяет пароль через наш сайт (Custom-провайдер -> /api/gml/auth),
/// т.е. аккаунт по-прежнему создаётся и управляется через Telegram-бота.
#[tauri::command]
pub async fn login(nickname: String, password: String) -> Result<LoginResponse, String> {
    let hwid = get_or_create_hwid();
    let client = reqwest::Client::new();
    // Перебираем хосты GML (прямой домен → резервный Cloudflare): у части
    // игроков politempire.ru блокируется DPI и соединение не устанавливается.
    // Первый ответивший хост запоминаем на сессию — профиль/скачивание/authlib
    // пойдут через него же.
    let hosts = crate::config::gml_host_candidates();
    let mut res = None;
    let mut last_err = "Сервер недоступен".to_string();
    for host in &hosts {
        match client
            .post(format!("{host}/api/v1/integrations/auth/signin"))
            .header("User-Agent", launcher_user_agent())
            .header("X-HWID", &hwid)
            .json(&serde_json::json!({ "Login": nickname, "Password": password }))
            .send()
            .await
        {
            Ok(r) => {
                crate::config::set_resolved_gml_host(host);
                res = Some(r);
                break;
            }
            Err(e) => last_err = format!("Сервер недоступен: {e}"),
        }
    }
    let res = res.ok_or(last_err)?;

    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Некорректный ответ сервера: {e}"))?;

    if !status.is_success() {
        let message = body["message"]
            .as_str()
            .unwrap_or("Ошибка сервера")
            .to_string();
        let banned = message.to_lowercase().contains("заблокирован");
        return Ok(LoginResponse {
            token: None,
            nickname: None,
            error: Some(message),
            banned,
        });
    }

    let data = &body["data"];
    let token = data["accessToken"].as_str().map(|s| s.to_string());
    let nick = data["name"].as_str().map(|s| s.to_string());
    let uuid = data["uuid"].as_str().map(|s| s.to_string());

    if let (Some(t), Some(n)) = (&token, &nick) {
        // Сообщаем HWID сайту; забаненное устройство не пускаем дальше
        if report_hwid_and_check_ban(&client, t).await {
            return Ok(LoginResponse {
                token: None,
                nickname: None,
                error: Some("Аккаунт заблокирован".into()),
                banned: true,
            });
        }
        let mut settings = load_settings();
        settings.session_token = Some(t.clone());
        settings.nickname = Some(n.clone());
        settings.user_uuid = uuid.clone();
        let _ = persist_settings(&settings);
    }

    Ok(LoginResponse {
        token,
        nickname: nick,
        error: None,
        banned: false,
    })
}

/// Проверка сохранённой сессии при запуске лаунчера (GML checkToken).
///
/// Устойчивость: если сервер недоступен (сеть, 5xx), НЕ выбрасываем на экран
/// входа — пускаем по сохранённой сессии. Повторный вход требуется только
/// когда сервер явно ответил, что токен невалиден или аккаунт забанен.
#[tauri::command]
pub async fn verify_session() -> Result<VerifyResponse, String> {
    let settings = load_settings();
    let Some(token) = settings.session_token else {
        return Ok(VerifyResponse { valid: false, nickname: None, banned: false });
    };
    let saved_nick = settings.nickname.clone();

    let client = reqwest::Client::new();
    // Перебираем хосты GML (прямой → резервный Cloudflare) на случай блокировки
    // прямого домена. Первый ответивший запоминаем для остальных вызовов.
    let hosts = crate::config::gml_host_candidates();
    let mut res = None;
    for host in &hosts {
        match client
            .post(format!("{host}/api/v1/integrations/auth/checkToken"))
            .header("User-Agent", launcher_user_agent())
            .header("X-HWID", get_or_create_hwid())
            .json(&serde_json::json!({ "AccessToken": token }))
            .send()
            .await
        {
            Ok(r) => {
                crate::config::set_resolved_gml_host(host);
                res = Some(r);
                break;
            }
            Err(_) => continue,
        }
    }

    // Сеть недоступна на всех хостах — работаем по сохранённой сессии
    let res = match res {
        Some(r) => r,
        None => {
            return Ok(VerifyResponse {
                valid: saved_nick.is_some(),
                nickname: saved_nick,
                banned: false,
            });
        }
    };

    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();

    if !status.is_success() {
        // Ошибка сервера (5xx) — не считаем сессию невалидной
        if status.is_server_error() {
            return Ok(VerifyResponse {
                valid: saved_nick.is_some(),
                nickname: saved_nick,
                banned: false,
            });
        }
        // Явный отказ (401/400): токен истёк или аккаунт забанен
        let message = body["message"].as_str().unwrap_or("");
        let banned = message.to_lowercase().contains("заблокирован");
        return Ok(VerifyResponse { valid: false, nickname: None, banned });
    }

    let data = &body["data"];
    let nick = data["name"]
        .as_str()
        .map(|s| s.to_string())
        .or(settings.nickname.clone());
    let mut banned = data["isBanned"].as_bool().unwrap_or(false);

    // Дополнительно проверяем бан по железу через сайт
    if !banned && report_hwid_and_check_ban(&client, &token).await {
        banned = true;
    }

    Ok(VerifyResponse {
        valid: !banned,
        nickname: nick,
        banned,
    })
}

/// Выход из аккаунта: стереть токен локально.
#[tauri::command]
pub fn logout() -> Result<(), String> {
    let mut settings = load_settings();
    settings.session_token = None;
    settings.nickname = None;
    settings.user_uuid = None;
    persist_settings(&settings)
}
