"""Конфигурация из переменных окружения (.env)."""
import os

from dotenv import load_dotenv

load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


# --- База данных (существующая, ничего не ломаем) ---
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = _int("DB_PORT", 3306)
DB_NAME = os.getenv("DB_NAME", "polit_empire")
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# --- Telegram ---
TG_BOT_TOKEN = os.getenv("TG_BOT_TOKEN", "")
# Прокси для доступа к api.telegram.org, если он заблокирован у хостинга.
# Поддерживаются http://, https://, socks5:// (напр. socks5://user:pass@1.2.3.4:1080).
# Пусто = подключаться к Telegram напрямую.
TG_PROXY = os.getenv("TG_PROXY", "").strip()
# ID администраторов бота через запятую (дополнение к таблице bot_admins)
ADMIN_TELEGRAM_IDS: frozenset[int] = frozenset(
    int(x) for x in os.getenv("ADMIN_TELEGRAM_IDS", "").replace(" ", "").split(",") if x.isdigit()
)

# Ссылки на соцсети (можно переопределить через .env)
SOCIAL_DISCORD = os.getenv("SOCIAL_DISCORD", "https://discord.gg/p3zYrGdCqw")
SOCIAL_TELEGRAM = os.getenv("SOCIAL_TELEGRAM", "https://t.me/politempire")
SOCIAL_MAP = os.getenv("SOCIAL_MAP", "https://map.politempire.org")
SOCIAL_SITE = os.getenv("SOCIAL_SITE", "https://politempire.org")


# --- Discord ---
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN", "")
DISCORD_GUILD_ID = _int("DISCORD_GUILD_ID", 0)
# Канал, в названии которого показывать онлайн (голосовой или текстовый). 0 = выключено.
DISCORD_STATUS_CHANNEL_ID = _int("DISCORD_STATUS_CHANNEL_ID", 0)
# Интервал обновления онлайна в секундах (Discord ограничивает переименование канала ~2 раза в 10 минут)
ONLINE_UPDATE_INTERVAL = _int("ONLINE_UPDATE_INTERVAL", 60)
CHANNEL_RENAME_INTERVAL = _int("CHANNEL_RENAME_INTERVAL", 300)
# Канал новостей: посты из него сохраняются в БД и показываются в лаунчере. 0 = выключено.
DISCORD_NEWS_CHANNEL_ID = _int("DISCORD_NEWS_CHANNEL_ID", 0)
# Сколько последних постов подтягивать из истории канала при старте
NEWS_BACKFILL_LIMIT = _int("NEWS_BACKFILL_LIMIT", 20)
# Канал для логов античита (сообщения о нарушениях из лаунчера). 0 = выключено.
DISCORD_ANTICHEAT_CHANNEL_ID = _int("DISCORD_ANTICHEAT_CHANNEL_ID", 1516453506188316903)
# Как часто проверять новые события античита в БД (секунды)
ANTICHEAT_POLL_INTERVAL = _int("ANTICHEAT_POLL_INTERVAL", 15)

# --- Minecraft ---
MC_HOST = os.getenv("MC_HOST", "127.0.0.1")
MC_PORT = _int("MC_PORT", 25565)
RCON_HOST = os.getenv("RCON_HOST", MC_HOST)
RCON_PORT = _int("RCON_PORT", 25575)
RCON_PASSWORD = os.getenv("RCON_PASSWORD", "")

# --- HTTP API для плагина ---
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = _int("API_PORT", _int("PORT", 8180))
# Секрет, который плагин передаёт в заголовке X-Api-Secret
API_SECRET = os.getenv("API_SECRET", "")

# --- GML (панель управления) ---
# Адрес gml-web-proxy; бот работает в network_mode: host, поэтому localhost
GML_API_URL = os.getenv("GML_API_URL", "http://127.0.0.1:5003").rstrip("/")
# Сервисный аккаунт панели GML (создайте отдельного пользователя в панели)
GML_PANEL_LOGIN = os.getenv("GML_PANEL_LOGIN", "")
GML_PANEL_PASSWORD = os.getenv("GML_PANEL_PASSWORD", "")

# --- Логика ---
# Сколько секунд игрок должен провести на сервере, чтобы реферал засчитался
REFERRAL_PLAYTIME_SECONDS = _int("REFERRAL_PLAYTIME_SECONDS", 600)
# Время жизни 2FA-кода в секундах
TWOFA_CODE_TTL = _int("TWOFA_CODE_TTL", 300)
