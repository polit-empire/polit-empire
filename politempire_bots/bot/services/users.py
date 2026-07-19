"""Работа с таблицей users сайта politempire.org.

Реальная схема users (создаётся сайтом, lib/schema.ts):
  minecraft_nick VARCHAR(32) PRIMARY KEY  -- ник игрока (он же логин и "id")
  password_hash  VARCHAR(255)             -- формат: scrypt$<salt hex>$<hash hex>
  is_banned      TINYINT(1)
  ban_reason     VARCHAR(512)
  api_token      VARCHAR(64)
  telegram_id    BIGINT NULL
  created_at     TIMESTAMP
  last_login     TIMESTAMP NULL

Колонок id/username/email/token/uuid/is_admin/balance в таблице НЕТ.
Для совместимости с кодом бота каждая функция возвращает словарь с
дополнительными ключами:
  id       -> minecraft_nick (строка!)
  username -> minecraft_nick
  password -> password_hash
  balance  -> сумма из журнала bot_balance_log

Пароли хэшируются scrypt в формате, совместимом с Node.js
(crypto.scryptSync(password, saltHex, 64), N=16384, r=8, p=1),
чтобы сайт, GML-мост (/api/gml/auth) и бот видели одни и те же аккаунты.
"""
import hashlib
import hmac
import logging
import re
import secrets

from bot import config, db

log = logging.getLogger(__name__)

NICK_RE = re.compile(r"^[a-zA-Z0-9_]{3,16}$")

_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 64
_SCRYPT_MAXMEM = 64 * 1024 * 1024

# SELECT с подсчётом баланса из журнала начислений
_SELECT = (
    "SELECT u.*, COALESCE((SELECT SUM(b.amount) FROM bot_balance_log b "
    "WHERE b.mc_username = u.minecraft_nick), 0) AS balance FROM users u "
)


def is_valid_nick(nick: str) -> bool:
    return bool(NICK_RE.match(nick))


def is_valid_password(password: str) -> bool:
    """Политика сайта: 6-64 символа, без пробельных символов."""
    return 6 <= len(password) <= 64 and not re.search(r"\s", password)


def hash_password(password: str) -> str:
    """scrypt$<salt hex>$<hash hex> — идентично lib/passwords.ts на сайте.

    ВАЖНО: соль — это hex-СТРОКА, она передаётся в scrypt как байты
    ASCII-строки (так делает Node), а не как декодированные из hex байты.
    """
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt.encode(),
        n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN, maxmem=_SCRYPT_MAXMEM,
    )
    return f"scrypt${salt}${digest.hex()}"


def check_password(password: str, stored: str | None) -> bool:
    """Проверяет пароль против scrypt-хэша сайта."""
    if not stored:
        return False
    parts = stored.split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    _, salt, expected = parts
    try:
        actual = hashlib.scrypt(
            password.encode(), salt=salt.encode(),
            n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P,
            dklen=_SCRYPT_DKLEN, maxmem=_SCRYPT_MAXMEM,
        )
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError):
        return False


def _norm(row: dict | None) -> dict | None:
    """Добавляет ключи-алиасы, которые ожидает код бота."""
    if row is None:
        return None
    row["id"] = row["minecraft_nick"]
    row["username"] = row["minecraft_nick"]
    row["password"] = row.get("password_hash")
    row.setdefault("balance", 0)
    return row


# ---------- Получение ----------

async def get_by_telegram_id(telegram_id: int) -> dict | None:
    return _norm(await db.fetchone(
        _SELECT + "WHERE u.telegram_id=%s", (telegram_id,)
    ))


async def get_by_username(username: str) -> dict | None:
    return _norm(await db.fetchone(
        _SELECT + "WHERE u.minecraft_nick=%s", (username,)
    ))


async def get_by_id(user_id) -> dict | None:
    """id пользователя — это его ник (PK minecraft_nick)."""
    return await get_by_username(str(user_id))


async def list_players(offset: int, limit: int) -> list[dict]:
    rows = await db.fetchall(
        _SELECT + "ORDER BY u.minecraft_nick ASC LIMIT %s OFFSET %s",
        (limit, offset),
    )
    return [_norm(r) for r in rows]


async def count_players() -> int:
    row = await db.fetchone("SELECT COUNT(*) AS c FROM users")
    return int(row["c"]) if row else 0


# ---------- Регистрация / изменение ----------

async def register(telegram_id: int, username: str, password: str) -> tuple[bool, str]:
    """Регистрация/привязка. Возвращает (успех, сообщение)."""
    if not is_valid_nick(username):
        return False, "Некорректный ник: 3-16 символов, буквы/цифры/_."
    if not is_valid_password(password):
        return False, "Некорректный пароль: 6-64 символа без пробелов."

    existing_tg = await get_by_telegram_id(telegram_id)
    if existing_tg:
        return False, f"Этот Telegram уже привязан к нику {existing_tg['username']}."

    user = await get_by_username(username)
    if user:
        # Аккаунт существует: привязываем Telegram только при верном пароле
        if user.get("telegram_id"):
            return False, "Этот ник уже привязан к другому Telegram-аккаунту."
        if not check_password(password, user.get("password_hash")):
            return False, "Неверный пароль от существующего аккаунта."
        await db.execute(
            "UPDATE users SET telegram_id=%s WHERE minecraft_nick=%s",
            (telegram_id, user["minecraft_nick"]),
        )
        return True, f"Telegram привязан к существующему аккаунту {username}."

    try:
        await db.execute(
            "INSERT INTO users (minecraft_nick, password_hash, telegram_id, is_banned) "
            "VALUES (%s, %s, %s, 0)",
            (username, hash_password(password), telegram_id),
        )
    except Exception:
        log.exception("Registration INSERT failed for username=%s tg=%s", username, telegram_id)
        return False, (
            "Не удалось создать аккаунт (ошибка базы данных). "
            "Сообщите администратору."
        )
    return True, f"Аккаунт {username} зарегистрирован."


async def set_password(user_id, new_password: str) -> None:
    """user_id — ник игрока (PK minecraft_nick)."""
    await db.execute(
        "UPDATE users SET password_hash=%s WHERE minecraft_nick=%s",
        (hash_password(new_password), str(user_id)),
    )


async def set_username(user_id, new_username: str) -> tuple[bool, str]:
    """Смена ника (PK). user_id — текущий ник."""
    old = str(user_id)
    if not is_valid_nick(new_username):
        return False, "Некорректный ник: 3-16 символов, буквы/цифры/_."
    existing = await get_by_username(new_username)
    if existing:
        return False, "Этот ник уже занят другим игроком."
    await db.execute(
        "UPDATE users SET minecraft_nick=%s WHERE minecraft_nick=%s",
        (new_username, old),
    )
    # Обновляем связанные таблицы бота, ключованные ником
    for sql in (
        "UPDATE bot_2fa SET mc_username=%s WHERE mc_username=%s",
        "UPDATE bot_2fa_codes SET mc_username=%s WHERE mc_username=%s",
        "UPDATE bot_discord_links SET mc_username=%s WHERE mc_username=%s",
        "UPDATE bot_balance_log SET mc_username=%s WHERE mc_username=%s",
        "UPDATE bot_referrals SET mc_username=%s WHERE mc_username=%s",
    ):
        try:
            await db.execute(sql, (new_username, old))
        except Exception:
            log.warning("Rename propagation failed: %s", sql)
    return True, "Ник изменён."


# ---------- Админы ----------

def is_super_admin(telegram_id: int) -> bool:
    return telegram_id in config.ADMIN_TELEGRAM_IDS


async def is_bot_admin(telegram_id: int) -> bool:
    if is_super_admin(telegram_id):
        return True
    row = await db.fetchone(
        "SELECT telegram_id FROM bot_admins WHERE telegram_id=%s", (telegram_id,)
    )
    return row is not None


# ---------- Бан / удаление ----------

async def ban(username: str, reason: str, admin_telegram_id: int) -> bool:
    user = await get_by_username(username)
    if not user:
        return False
    await db.execute(
        "UPDATE users SET is_banned=1, ban_reason=%s WHERE minecraft_nick=%s",
        (reason or "Причина не указана", username),
    )
    return True


async def unban(username: str) -> bool:
    user = await get_by_username(username)
    if not user:
        return False
    await db.execute(
        "UPDATE users SET is_banned=0, ban_reason=NULL WHERE minecraft_nick=%s",
        (username,),
    )
    return True


async def delete_account(username: str) -> bool:
    user = await get_by_username(username)
    if not user:
        return False
    await db.execute("DELETE FROM users WHERE minecraft_nick=%s", (username,))
    return True


async def all_telegram_ids() -> list[int]:
    rows = await db.fetchall(
        "SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL AND is_banned=0"
    )
    return [int(r["telegram_id"]) for r in rows]


# ---------- Журнал ----------

async def log_admin_action(admin_telegram_id: int, action: str,
                           target: str | None = None, details: str | None = None) -> None:
    await db.execute(
        "INSERT INTO bot_admin_log (admin_telegram_id, action, target, details) "
        "VALUES (%s, %s, %s, %s)",
        (admin_telegram_id, action, target, details),
    )
