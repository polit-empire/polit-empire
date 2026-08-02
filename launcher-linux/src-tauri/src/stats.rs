//! Статистика игрового времени: сколько всего наиграно, число сессий,
//! самая долгая сессия и сводка по последней сессии.
//!
//! ЕДИНСТВЕННЫЙ ИСТОЧНИК ИСТИНЫ — сервер (bot API /api/player/playtime).
//! Локальный файл отсчёта сессий полностью удалён, чтобы клиентское время
//! в меню игры не учитывалось как наигранные часы.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Статистика игрового времени, получаемая с сервера.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaytimeStats {
    /// Суммарное наигранное время за всё время на сервере (в секундах).
    #[serde(default)]
    pub total_seconds: u64,
    /// Количество завершённых игровых сессий.
    #[serde(default)]
    pub session_count: u64,
    /// Длительность последней завершённой сессии (в секундах).
    #[serde(default)]
    pub last_session_seconds: u64,
    /// Самая долгая сессия за всё время (в секундах).
    #[serde(default)]
    pub longest_session_seconds: u64,
    /// Момент последнего выхода из игры (unix-секунды, 0 — ещё не играли).
    #[serde(default)]
    pub last_played_unix: u64,
}

impl Default for PlaytimeStats {
    fn default() -> Self {
        Self {
            total_seconds: 0,
            session_count: 0,
            last_session_seconds: 0,
            longest_session_seconds: 0,
            last_played_unix: 0,
        }
    }
}

fn stats_path() -> PathBuf {
    crate::config::default_game_dir().join("playtime-stats.json")
}

/// Удаляет устаревший локальный файл статистики, если он есть на диске.
fn remove_legacy_stats_file() {
    let path = stats_path();
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
}

/// Возвращает текущую статистику игрового времени напрямую с сервера.
#[tauri::command]
pub async fn get_playtime_stats() -> PlaytimeStats {
    remove_legacy_stats_file();
    fetch_server_playtime().await.unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerStats {
    pub kills: i32,
    pub deaths: i32,
    pub town: Option<String>,
}

#[tauri::command]
pub async fn get_player_stats() -> PlayerStats {
    let default = PlayerStats { kills: 0, deaths: 0, town: None };
    let settings = crate::config::load_settings();
    let nickname = match settings.nickname.as_deref() {
        Some(n) => n,
        None => return default,
    };
    
    // Этот эндпоинт расположен на сайте
    let url = format!(
        "{}/api/player/stats?username={}",
        crate::config::api_base(),
        urlencode(nickname)
    );
    
    let client = reqwest::Client::new();
    let resp = match client
        .get(&url)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return default,
    };

    if !resp.status().is_success() {
        return default;
    }

    resp.json::<PlayerStats>().await.unwrap_or(default)
}

/// Запрашивает наигранное время у bot API (БД MySQL).
async fn fetch_server_playtime() -> Option<PlaytimeStats> {
    let settings = crate::config::load_settings();
    let nickname = settings.nickname.as_deref()?;

    let url = format!(
        "{}/api/player/playtime?username={}",
        crate::config::api_base(),
        urlencode(nickname)
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let body: serde_json::Value = resp.json().await.ok()?;
    let total = body
        .get("playtime_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let session_count = body
        .get("session_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let longest = body
        .get("longest_session_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let last_session = body
        .get("last_session_seconds")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Some(PlaytimeStats {
        total_seconds: total,
        session_count,
        last_session_seconds: last_session,
        longest_session_seconds: longest,
        last_played_unix: 0,
    })
}

/// URL-кодирование ника (для query-параметра).
fn urlencode(s: &str) -> String {
    let mut result = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}
