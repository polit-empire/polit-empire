use serde::{Deserialize, Serialize};

use crate::auth::launcher_user_agent;
use crate::config::api_base;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsItem {
    pub id: String,
    pub author: String,
    pub content: String,
    #[serde(rename = "imageUrl")]
    pub image_url: Option<String>,
    #[serde(rename = "postedAt")]
    pub posted_at: String,
    /// Ссылка на оригинальное сообщение в Discord (для перехода по клику)
    #[serde(default)]
    pub link: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NewsResponse {
    news: Vec<NewsItem>,
}

/// Новости с сайта (источник — Discord-канал новостей, сохраняется ботом).
#[tauri::command]
pub async fn get_news() -> Result<Vec<NewsItem>, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(format!("{}/api/news", api_base()))
        .header("User-Agent", launcher_user_agent())
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Не удалось загрузить новости: {e}"))?;

    let body: NewsResponse = res
        .json()
        .await
        .map_err(|e| format!("Некорректный ответ сервера новостей: {e}"))?;

    Ok(body.news)
}
