//! Телеметрия лаунчера: «живой» статус игрока и стрим игровых логов на сайт.
//!
//! Две независимые фоновые задачи, обе используют Bearer-токен сессии GML:
//!  * `spawn_heartbeat` — раз в 30с шлёт POST /api/launcher/heartbeat со
//!    статусом (idle — лаунчер открыт, playing — идёт игра). По свежести
//!    last_seen админка показывает индикатор «лаунчер запущен».
//!  * `start_log_stream` — во время игровой сессии читает новые строки из
//!    `launcher-game.log` и пачками отправляет их POST /api/launcher/logs,
//!    чтобы админ видел лайв-логи игрока.
//!
//! Обе задачи «fail-open»: любые сетевые/файловые ошибки проглатываются и
//! никогда не мешают запуску или работе игры.

use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::auth::launcher_user_agent;
use crate::config::{api_base, load_settings};

/// Флаг: стример логов уже запущен (одна игровая сессия — один поток).
static LOG_STREAM_RUNNING: AtomicBool = AtomicBool::new(false);

/// Как часто стример логов опрашивает файл игры и шлёт накопленное.
/// Каждый опрос — это POST /api/launcher/logs, поэтому интервал напрямую
/// задаёт нагрузку: при 2с один играющий давал 30 запросов в минуту, и на
/// полном сервере (50+ онлайн) это 1500 req/min на один эндпоинт. При 15с
/// выходит 4 req/min с игрока; строки не теряются — просто едут крупнее
/// пачками, в админке лайв-логи отстают максимум на этот интервал.
const LOG_POLL_INTERVAL: Duration = Duration::from_secs(15);

/// Строит blocking-клиент reqwest с коротким таймаутом.
fn http_client() -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .ok()
}

/// Фоновый heartbeat: сообщает сайту, что лаунчер запущен, и текущий статус.
/// Запускается один раз при старте приложения (см. main.rs).
pub fn spawn_heartbeat() {
    std::thread::spawn(|| {
        let client = match http_client() {
            Some(c) => c,
            None => return,
        };
        let os = std::env::consts::OS.to_string();
        let version = env!("CARGO_PKG_VERSION").to_string();

        loop {
            let settings = load_settings();
            // Шлём heartbeat только после авторизации (есть токен).
            if let Some(token) = settings.session_token.filter(|t| !t.is_empty()) {
                let status = if crate::launcher::is_game_running() {
                    "playing"
                } else {
                    "idle"
                };
                let _ = client
                    .post(format!("{}/api/launcher/heartbeat", api_base()))
                    .header("User-Agent", launcher_user_agent())
                    .header("Authorization", format!("Bearer {token}"))
                    .json(&serde_json::json!({
                        "status": status,
                        "launcher_version": version,
                        "os": os,
                    }))
                    .send();
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}

/// Одна строка лога для отправки.
#[derive(serde::Serialize)]
struct LogLine {
    level: String,
    source: String,
    line: String,
}

/// Отправляет одну строку в админ-логи с `source=launcher`. Fire-and-forget:
/// работает в отдельном потоке, не блокирует запуск и проглатывает любые
/// ошибки. Нужна для событий/ошибок ЛАУНЧЕРА (например, сбой при «Играть»),
/// которые не попадают в лог игры и иначе нигде не фиксируются.
pub fn report_launcher_log(level: &str, line: &str) {
    let level = level.to_string();
    let line: String = line.chars().take(2048).collect();
    std::thread::spawn(move || {
        // Логи требуют авторизации (Bearer-токен), поэтому шлём только после входа.
        let Some(token) = load_settings().session_token.filter(|t| !t.is_empty()) else {
            return;
        };
        let Some(client) = http_client() else { return };
        let _ = client
            .post(format!("{}/api/launcher/logs", api_base()))
            .header("User-Agent", launcher_user_agent())
            .header("Authorization", format!("Bearer {token}"))
            .json(&serde_json::json!({
                "session": "launcher",
                "lines": [{ "level": level, "source": "launcher", "line": line }],
            }))
            .send();
    });
}

/// Отправляет событие в таблицу `telemetry` (POST /api/telemetry).
///
/// ВАЖНО: именно из этой таблицы админка формирует раздел «Ошибки лаунчера»
/// (event_type = game_crash | download_error | auth_error | error). Логи в
/// `launcher_logs` (см. report_launcher_log) идут в отдельную вкладку «живые
/// логи», поэтому сбои запуска нужно дублировать сюда — иначе в разделе
/// ошибок ничего не появляется. Fire-and-forget, ошибки проглатываются.
pub fn report_telemetry_event(event_type: &str, message: &str) {
    let event_type = event_type.to_string();
    let message: String = message.chars().take(4096).collect();
    std::thread::spawn(move || {
        let Some(client) = http_client() else { return };
        let os = std::env::consts::OS.to_string();
        let version = env!("CARGO_PKG_VERSION").to_string();
        // Токен опционален (эндпоинт принимает и анонимно), но с ним событие
        // привязывается к нику игрока и видно в его карточке.
        let token = load_settings().session_token.unwrap_or_default();
        let mut req = client
            .post(format!("{}/api/telemetry", api_base()))
            .header("User-Agent", launcher_user_agent());
        if !token.is_empty() {
            req = req.header("Authorization", format!("Bearer {token}"));
        }
        let _ = req
            .json(&serde_json::json!({
                "event_type": event_type,
                "launcher_version": version,
                "os": os,
                "message": message,
            }))
            .send();
    });
}

/// Грубая классификация уровня по содержимому строки лога Minecraft.
fn detect_level(line: &str) -> &'static str {
    let l = line.to_ascii_uppercase();
    if l.contains("/ERROR") || l.contains(" ERROR") || l.contains("EXCEPTION") || l.contains("SEVERE") {
        "error"
    } else if l.contains("/WARN") || l.contains(" WARN") {
        "warn"
    } else {
        "info"
    }
}

/// Запускает стрим игровых логов на сайт на время игровой сессии.
///
/// `game_dir` — каталог игры (там лежит launcher-game.log), `session_id` —
/// идентификатор запуска (для группировки строк в админке). Поток живёт,
/// пока `launcher::is_game_running()` истинно, затем досылает хвост и выходит.
pub fn start_log_stream(game_dir: std::path::PathBuf, session_id: String) {
    if LOG_STREAM_RUNNING.swap(true, Ordering::SeqCst) {
        return; // уже стримим
    }

    std::thread::spawn(move || {
        let log_path = game_dir.join("launcher-game.log");
        let client = http_client();
        let mut offset: u64 = 0;

        // Токен читаем один раз в начале — сессия не меняется во время игры.
        let token = load_settings().session_token.unwrap_or_default();

        loop {
            let running = crate::launcher::is_game_running();

            // Читаем новые строки, начиная с прошлого смещения.
            if let Ok(mut f) = std::fs::File::open(&log_path) {
                if let Ok(meta) = f.metadata() {
                    let len = meta.len();
                    // Файл пересоздаётся при каждом запуске — если он «усох»,
                    // сбрасываем смещение в начало.
                    if len < offset {
                        offset = 0;
                    }
                    if len > offset && f.seek(SeekFrom::Start(offset)).is_ok() {
                        let reader = BufReader::new(&mut f);
                        let mut batch: Vec<LogLine> = Vec::new();
                        for line in reader.lines().map_while(Result::ok) {
                            let trimmed = line.trim_end();
                            if trimmed.is_empty() {
                                continue;
                            }
                            let truncated: String = trimmed.chars().take(2048).collect();
                            batch.push(LogLine {
                                level: detect_level(&truncated).to_string(),
                                source: "game".to_string(),
                                line: truncated,
                            });
                            // Сервер принимает до 200 строк за раз.
                            if batch.len() >= 200 {
                                send_logs(&client, &token, &session_id, std::mem::take(&mut batch));
                            }
                        }
                        offset = len;
                        if !batch.is_empty() {
                            send_logs(&client, &token, &session_id, batch);
                        }
                    }
                }
            }

            if !running {
                break; // игра закрыта — хвост уже отправлен
            }
            std::thread::sleep(LOG_POLL_INTERVAL);
        }

        LOG_STREAM_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Отправляет пачку строк на сайт (blocking). Ошибки проглатываются.
fn send_logs(
    client: &Option<reqwest::blocking::Client>,
    token: &str,
    session_id: &str,
    lines: Vec<LogLine>,
) {
    if lines.is_empty() || token.is_empty() {
        return;
    }
    let Some(client) = client else { return };
    let _ = client
        .post(format!("{}/api/launcher/logs", api_base()))
        .header("User-Agent", launcher_user_agent())
        .header("Authorization", format!("Bearer {token}"))
        .json(&serde_json::json!({
            "session": session_id,
            "lines": lines,
        }))
        .send();
}
