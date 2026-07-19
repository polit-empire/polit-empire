"""Логика двухфакторной аутентификации.

Таблицы bot_2fa / bot_2fa_codes ключуются НИКОМ игрока (mc_username),
т.к. в таблице users сайта PK — minecraft_nick. Параметр user_id во всех
функциях — это ник (строка); имя сохранено для совместимости с handlers.
"""
import secrets
from datetime import datetime, timedelta

from bot import config, db


async def is_enabled_for_user(user_id) -> bool:
    force = await db.get_setting("force_2fa", "0")
    if force == "1":
        return True
    row = await db.fetchone(
        "SELECT enabled FROM bot_2fa WHERE mc_username=%s", (str(user_id),)
    )
    return bool(row and row["enabled"])


async def set_enabled(user_id, enabled: bool) -> None:
    await db.execute(
        "INSERT INTO bot_2fa (mc_username, enabled) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)",
        (str(user_id), 1 if enabled else 0),
    )


async def create_code(user_id) -> str:
    """Создаёт одноразовый код, инвалидируя предыдущие."""
    nick = str(user_id)
    await db.execute(
        "UPDATE bot_2fa_codes SET used=1 WHERE mc_username=%s AND used=0", (nick,)
    )
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = datetime.utcnow() + timedelta(seconds=config.TWOFA_CODE_TTL)
    await db.execute(
        "INSERT INTO bot_2fa_codes (mc_username, code, expires_at) VALUES (%s, %s, %s)",
        (nick, code, expires),
    )
    return code


async def verify_code(user_id, code: str) -> bool:
    """Проверяет код. Код одноразовый: помечается использованным при успехе."""
    row = await db.fetchone(
        "SELECT id FROM bot_2fa_codes "
        "WHERE mc_username=%s AND code=%s AND used=0 AND expires_at > UTC_TIMESTAMP() "
        "ORDER BY id DESC LIMIT 1",
        (str(user_id), code.strip()),
    )
    if not row:
        return False
    await db.execute("UPDATE bot_2fa_codes SET used=1 WHERE id=%s", (row["id"],))
    return True
