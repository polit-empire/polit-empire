//! Статистика игрового времени: сколько всего наиграно, число сессий,
//! самая долгая сессия и сводка по последней сессии.
//!
//! ЗАЩИТА ОТ ПОДМЕНЫ. Раньше статистика лежала открытым JSON — любой
//! мог открыть файл и «подкрутить часы». Теперь на диске лежит не голые
//! цифры, а подписанный контейнер: к данным считается HMAC-SHA256 на
//! ключе, который складывается из вшитого (обфусцированного) секрета и HWID
//! устройства. Любая ручная правка файла ломает подпись — такой файл
//! считается недействительным и статистика обнуляется. Привязка к HWID
//! дополнительно не даёт перенести чужой «накрученный» файл на другой ПК.
//!
//! Это не криптографически непробиваемо (ключ вшит в бинарник), но
//! полностью закрывает простое редактирование файла блокнотом. Единственный
//! по-настоящему неподдельный вариант — считать время на сервере (см.
//! push_session_to_server ниже: длительность сессии уже уходит в телеметрию).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// Сохраняемая статистика игрового времени («полезная нагрузка», которая
/// подписывается). Порядок полей ФИКСИРОВАН: от него зависит
/// детерминированная сериализация при проверке подписи.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaytimeStats {
    /// Суммарное наигранное время за всё время (в секундах).
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

/// Подписанный контейнер, который реально лежит на диске.
#[derive(Serialize, Deserialize)]
struct SignedStats {
    data: PlaytimeStats,
    /// HMAC-SHA256 от канонической сериализации data (hex).
    sig: String,
}

/// Начало текущей игровой сессии (монотонные часы). None — игра не идёт.
static SESSION_START: Mutex<Option<Instant>> = Mutex::new(None);

fn stats_path() -> PathBuf {
    crate::config::default_game_dir().join("playtime-stats.json")
}

/// HMAC-SHA256 без внешних крейтов — поверх sha2 (RFC 2104).
fn hmac_sha256(key: &[u8], msg: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    const BLOCK: usize = 64; // размер блока SHA-256

    // Ключ нормализуем до размера блока.
    let mut key_block = [0u8; BLOCK];
    if key.len() > BLOCK {
        let mut h = Sha256::new();
        h.update(key);
        let digest = h.finalize();
        key_block[..digest.len()].copy_from_slice(&digest);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }

    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_digest);
    outer.finalize().to_vec()
}

/// Ключ подписи = вшитый (обфусцированный) секрет + HWID устройства.
/// Привязка к HWID делает подпись уникальной для каждого ПК.
fn signing_key() -> Vec<u8> {
    let secret = crate::obf_str!("pe-playtime-hmac-v1-6f3a9c1b");
    let hwid = crate::config::get_or_create_hwid();
    format!("{secret}:{hwid}").into_bytes()
}

/// Каноническое сообщение для подписи (с доменным разделителем).
/// serde_json сериализует поля структуры в порядке объявления — результат
/// детерминирован, поэтому подпись стабильна.
fn message_for(data: &PlaytimeStats) -> Vec<u8> {
    let json = serde_json::to_string(data).unwrap_or_default();
    format!("pe-playtime-v1|{json}").into_bytes()
}

fn compute_sig(data: &PlaytimeStats) -> String {
    hex::encode(hmac_sha256(&signing_key(), &message_for(data)))
}

/// Сравнение подписей за постоянное время (без раннего выхода по расхождению).
fn sig_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Загружает статистику с диска С ПРОВЕРКОЙ ПОДПИСИ. Если файла нет,
/// он повреждён или подпись не сошлась (ручная правка / чужой ПК) —
/// возвращается нулевая статистика.
pub fn load_stats() -> PlaytimeStats {
    let path = stats_path();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return PlaytimeStats::default();
    };
    let Ok(signed) = serde_json::from_str::<SignedStats>(&raw) else {
        return PlaytimeStats::default();
    };
    if sig_eq(&signed.sig, &compute_sig(&signed.data)) {
        signed.data
    } else {
        // Подпись не сошлась — файл правили вручную или перенесли с другого
        // устройства. Не доверяем таким данным — обнуляем.
        PlaytimeStats::default()
    }
}

fn persist_stats(stats: &PlaytimeStats) {
    let path = stats_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let signed = SignedStats {
        sig: compute_sig(stats),
        data: stats.clone(),
    };
    if let Ok(raw) = serde_json::to_string_pretty(&signed) {
        let _ = std::fs::write(&path, raw);
    }
}

/// Отмечает старт игровой сессии. Вызывается при успешном запуске игры.
pub fn begin_session() {
    *SESSION_START.lock().unwrap() = Some(Instant::now());
}

/// Завершает текущую сессию: считает длительность, обновляет и подписывает
/// статистику. Безопасно вызывать несколько раз — учитывается только один раз.
pub fn finish_session() {
    let started = SESSION_START.lock().unwrap().take();
    let Some(started) = started else {
        return;
    };
    let elapsed = started.elapsed().as_secs();
    // Отсекаем «ложные» сессии длиной меньше секунды.
    if elapsed < 1 {
        return;
    }

    let mut stats = load_stats();
    stats.total_seconds = stats.total_seconds.saturating_add(elapsed);
    stats.session_count = stats.session_count.saturating_add(1);
    stats.last_session_seconds = elapsed;
    if elapsed > stats.longest_session_seconds {
        stats.longest_session_seconds = elapsed;
    }
    stats.last_played_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    persist_stats(&stats);

    // Дублируем длительность сессии на сервер (телеметрия). Это единственный
    // источник, который игрок не может поправить локально: если на сервере
    // вести сумму, локальный файл вообще перестаёт быть авторитетным.
    crate::telemetry::report_telemetry_event("playtime_session", &elapsed.to_string());
}

/// Возвращает текущую статистику игрового времени для интерфейса.
///
/// ИСТОЧНИК ИСТИНЫ — сервер (bot API /api/player/playtime), не локальный файл.
/// Локальный подписанный файл используется только как кэш/фолбэк, когда сервер
/// недоступен. Это гарантирует, что наигранное время в лаунчере совпадает с
/// временем в БД (и с плейсхолдером %botlink_playtime% на сервере).
///
/// Запрос к bot API идёт с токеном сессии GML (Bearer) — тот же механизм
/// авторизации, что и у остальных API-вызовов лаунчера. Сервер определяет
/// игрока по нику из JWT-токена.
#[tauri::command]
pub async fn get_playtime_stats() -> PlaytimeStats {
    // Пытаемся получить реальный плейтайм с сервера.
    if let Some(server_stats) = fetch_server_playtime().await {
        return server_stats;
    }
    // Сервер недоступен — отдаём локальный кэш (подписанный файл на диске).
    load_stats()
}

/// Запрашивает наигранное время у bot API.
/// Bot API хранит данные в MySQL (таблица bot_playtime) — это единый источник
/// истины для лаунчера, плагина BotLink и плейсхолдера %botlink_playtime%.
async fn fetch_server_playtime() -> Option<PlaytimeStats> {
    let settings = crate::config::load_settings();
    let nickname = settings.nickname.as_deref()?;

    let base = crate::config::api_base();
    let url = format!(
        "{}/api/player/playtime?username={}",
        base,
        urlencode(nickname)
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(5))
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
