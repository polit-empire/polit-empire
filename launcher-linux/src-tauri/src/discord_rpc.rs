use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Состояние Discord RPC. Клиент хранится в Rust-бэкенде, поэтому presence
/// продолжает работать, когда окно Tauri скрыто в трей во время игры.
struct RpcState {
    client: Option<DiscordIpcClient>,
    launcher_started_at: i64,
}

static RPC: OnceLock<Mutex<RpcState>> = OnceLock::new();

#[derive(Clone, Copy)]
enum PresenceMode {
    Launcher,
    Playing,
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn state() -> &'static Mutex<RpcState> {
    RPC.get_or_init(|| {
        Mutex::new(RpcState {
            client: None,
            launcher_started_at: unix_timestamp(),
        })
    })
}

/// Создаёт IPC-клиент и выполняет handshake с локальным Discord.
/// Ошибка означает только то, что Discord сейчас закрыт/недоступен.
fn connect_client() -> Option<DiscordIpcClient> {
    let application_id = crate::obf_str!("1518173937232511098");
    let mut client = DiscordIpcClient::new(&application_id).ok()?;
    client.connect().ok()?;
    Some(client)
}

fn send_activity(client: &mut DiscordIpcClient, mode: PresenceMode, started_at: i64) -> bool {
    let (details, presence_state) = match mode {
        PresenceMode::Launcher => (
            crate::obf_str!("Polit Empire Launcher"),
            crate::obf_str!("В лаунчере"),
        ),
        PresenceMode::Playing => (
            crate::obf_str!("Polit Empire"),
            crate::obf_str!("Играет на сервере"),
        ),
    };

    let site_label = crate::obf_str!("Открыть сайт");
    let site_url = crate::obf_str!("https://politempire.ru");
    let discord_label = crate::obf_str!("Наш Discord");
    let discord_url = crate::obf_str!("https://discord.gg/dqDx9qsQd9");

    let payload = activity::Activity::new()
        .details(&details)
        .state(&presence_state)
        .timestamps(activity::Timestamps::new().start(started_at))
        .buttons(vec![
            activity::Button::new(&site_label, &site_url),
            activity::Button::new(&discord_label, &discord_url),
        ]);

    client.set_activity(payload).is_ok()
}

/// Обновляет presence. Если старое IPC-соединение оборвалось (например,
/// Discord перезапустили), один раз переподключается и повторяет отправку.
/// Все ошибки некритичны и никогда не мешают запуску лаунчера или Minecraft.
fn update(mode: PresenceMode, started_at: i64) {
    let Ok(mut rpc) = state().lock() else {
        return;
    };

    if rpc.client.is_none() {
        rpc.client = connect_client();
    }

    let sent = rpc
        .client
        .as_mut()
        .map(|client| send_activity(client, mode, started_at))
        .unwrap_or(false);

    if !sent {
        if let Some(client) = rpc.client.as_mut() {
            let _ = client.close();
        }
        rpc.client = connect_client();
        if let Some(client) = rpc.client.as_mut() {
            let _ = send_activity(client, mode, started_at);
        }
    }
}

/// Статус «В лаунчере» с таймером от момента запуска приложения.
pub fn set_launcher() {
    let started_at = state()
        .lock()
        .map(|rpc| rpc.launcher_started_at)
        .unwrap_or_else(|_| unix_timestamp());
    update(PresenceMode::Launcher, started_at);
}

/// Статус «Играет на сервере» с новым таймером игровой сессии.
pub fn set_playing() {
    update(PresenceMode::Playing, unix_timestamp());
}

/// Очищает presence и закрывает IPC при полном выходе из лаунчера.
pub fn shutdown() {
    let Ok(mut rpc) = state().lock() else {
        return;
    };
    if let Some(mut client) = rpc.client.take() {
        let _ = client.clear_activity();
        let _ = client.close();
    }
}
