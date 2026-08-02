use crate::config::{api_base, load_settings};

/// Загрузка PNG-скина игрока на сервер.
/// Данные приходят из фронтенда как массив байт (файл выбирается через <input type="file">).
#[tauri::command]
pub async fn upload_skin(data: Vec<u8>) -> Result<(), String> {
    if data.len() > 128 * 1024 {
        return Err("Файл слишком большой (максимум 128 КБ)".into());
    }
    let settings = load_settings();
    let token = settings
        .session_token
        .ok_or("Нет активной сессии. Войдите в аккаунт.")?;

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/skin", api_base()))
        .bearer_auth(&token)
        .header("Content-Type", "image/png")
        .body(data)
        .send()
        .await
        .map_err(|e| format!("Сервер недоступен: {e}"))?;

    if !res.status().is_success() {
        return Err(explain_error(res).await);
    }
    Ok(())
}

/// Формирует понятное сообщение об ошибке из ответа сервера.
/// Если тело — JSON с полем `error`, показываем его. Иначе — статус и сырой текст,
/// чтобы было видно реальную причину (например 404 = маршрут не задеплоен, 500 и т.п.).
async fn explain_error(res: reqwest::Response) -> String {
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
        if let Some(msg) = json["error"].as_str() {
            return msg.to_string();
        }
    }
    let hint = match status.as_u16() {
        404 => " (маршрут не найден — обновите сервер: docker compose up -d --build)",
        401 | 403 => " (сессия недействительна — перезайдите в аккаунт)",
        413 => " (файл слишком большой)",
        _ => "",
    };
    let snippet: String = text.chars().take(200).collect();
    format!("Ошибка сервера {status}{hint}. {snippet}")
}

/// Сброс скина на стандартный.
#[tauri::command]
pub async fn delete_skin() -> Result<(), String> {
    let settings = load_settings();
    let token = settings
        .session_token
        .ok_or("Нет активной сессии. Войдите в аккаунт.")?;

    let client = reqwest::Client::new();
    let res = client
        .delete(format!("{}/api/skin", api_base()))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Сервер недоступен: {e}"))?;

    if !res.status().is_success() {
        return Err(explain_error(res).await);
    }
    Ok(())
}

/// URL текущего скина игрока (для предпросмотра во фронтенде).
#[tauri::command]
pub fn get_skin_url() -> Option<String> {
    let settings = load_settings();
    settings
        .nickname
        .map(|nick| format!("{}/api/skins/{nick}.png", api_base()))
}
