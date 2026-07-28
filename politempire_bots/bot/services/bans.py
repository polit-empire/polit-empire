"""Единая точка бана/разбана игрока.

Что происходит при бане (из любого источника — TG-бот или панель GML):
  1. users.is_banned=1 в БД сайта (блокирует вход через лаунчер);
  2. RCON `ban` на Minecraft-сервере — игрока нельзя пустить на сервер,
     причина при заходе отображается корректно (без \\u-эскейпов GML);
  3. RCON `kick` — если игрок сейчас онлайн, его выкидывает немедленно;
  4. уведомление игроку в Telegram (если привязан).

Плюс фоновая синхронизация: раз в BAN_SYNC_INTERVAL секунд сравниваем
список забаненных в панели GML с БД сайта и приводим всё к единому виду.
"""
import asyncio
import hashlib
import logging

from bot import db, rcon
from bot.services import gml, users
from bot.tg import notify

log = logging.getLogger("bans")

# Значения, по которым можно банить напрямую (без ника).
_BAN_TABLES = {"hwid": ("banned_hwids", "hwid"), "uuid": ("banned_uuids", "uuid"), "ip": ("banned_ips", "ip")}


def offline_uuid(nick: str) -> str:
    """Детерминированный offline-UUID Minecraft по нику (как на сайте)."""
    h = bytearray(hashlib.md5(f"OfflinePlayer:{nick}".encode()).digest())
    h[6] = (h[6] & 0x0F) | 0x30  # версия 3
    h[8] = (h[8] & 0x3F) | 0x80  # variant
    x = h.hex()
    return f"{x[0:8]}-{x[8:12]}-{x[12:16]}-{x[16:20]}-{x[20:]}"


async def _accounts_for_value(kind: str, value: str) -> list[str]:
    """Ники аккаунтов, связанных с данным значением (для каскадного бана)."""
    if kind == "hwid":
        rows = await db.fetchall("SELECT minecraft_nick FROM users WHERE last_hwid=%s", (value,))
        return [r["minecraft_nick"] for r in rows]
    if kind == "ip":
        rows = await db.fetchall("SELECT minecraft_nick FROM users WHERE last_ip=%s", (value,))
        return [r["minecraft_nick"] for r in rows]
    if kind == "uuid":
        target = value.lower()
        rows = await db.fetchall("SELECT minecraft_nick FROM users")
        return [r["minecraft_nick"] for r in rows if offline_uuid(r["minecraft_nick"]) == target]
    return []


async def ban_value(kind: str, value: str, reason: str, source: str = "tg") -> tuple[int, list[str]]:
    """Бан по «сырому» значению (HWID / UUID / IP), без выбора из списка ников.

    1. заносит значение в соответствующий чёрный список (banned_hwids/uuids/ips);
    2. штатно банит все связанные с ним аккаунты (БД + сервер + TG + панель GML).

    Возвращает (сколько аккаунтов забанено, их ники).
    """
    table, col = _BAN_TABLES[kind]
    value = value.strip()
    reason = reason or "Причина не указана"

    nicks = await _accounts_for_value(kind, value)
    primary = nicks[0] if nicks else None

    await db.execute(
        f"INSERT INTO {table} ({col}, mc_username, reason) VALUES (%s, %s, %s) "
        f"ON DUPLICATE KEY UPDATE reason=VALUES(reason), mc_username=VALUES(mc_username)",
        (value, primary, reason),
    )
    log.info("Banned %s=%s (accounts: %s)", kind, value, nicks or "—")

    for nick in nicks:
        await ban(nick, reason, source=source)
    return len(nicks), nicks


async def unban_value(kind: str, value: str, source: str = "tg") -> bool:
    """Снимает бан по значению и разбанивает связанный аккаунт (если был)."""
    table, col = _BAN_TABLES[kind]
    value = value.strip()

    row = await db.fetchone(f"SELECT mc_username FROM {table} WHERE {col}=%s", (value,))
    if row is None:
        return False
    await db.execute(f"DELETE FROM {table} WHERE {col}=%s", (value,))
    linked = row.get("mc_username")
    if linked:
        await unban(linked, source=source)
    log.info("Unbanned %s=%s", kind, value)
    return True

BAN_SYNC_INTERVAL = 10  # секунд (быстрый кик после бана в панели GML)
GML_BAN_REASON = "Заблокирован администрацией"
# Старый текст причины — для снятия банов, выданных до переименования
_LEGACY_GML_REASONS = ("Заблокирован администрацией (панель управления)",)


async def _rcon_safe(coro, what: str) -> None:
    try:
        await coro
    except Exception:
        log.warning("RCON %s failed (server offline?)", what)


async def ban(username: str, reason: str, source: str = "tg", hwid: bool = False) -> bool:
    """Полный бан: БД + панель GML + сервер (ban+kick) + уведомление.

    hwid=True — дополнительно банит устройство игрока (last_hwid):
    вход в лаунчер с этого компьютера станет невозможен для любых аккаунтов.
    """
    user = await users.get_by_username(username)
    if not user:
        return False
    nick = user["minecraft_nick"]
    reason = reason or "Причина не указана"

    await db.execute(
        "UPDATE users SET is_banned=1, ban_reason=%s WHERE minecraft_nick=%s",
        (reason, nick),
    )
    if hwid:
        if user.get("last_hwid"):
            await db.execute(
                "INSERT INTO banned_hwids (hwid, mc_username, reason) VALUES (%s, %s, %s) "
                "ON DUPLICATE KEY UPDATE reason=VALUES(reason)",
                (user["last_hwid"], nick, reason),
            )
            log.info("HWID %s banned (player %s)", user["last_hwid"], nick)
        else:
            log.warning("HWID ban requested for %s, but last_hwid is empty", nick)
    # Зеркалим в панель GML (если бан пришёл не из неё самой)
    if source != "gml-panel":
        await gml.ban_player(nick)
    await _rcon_safe(rcon.ban_player(nick, reason), f"ban {nick}")
    await _rcon_safe(rcon.kick_player(nick, f"Вы заблокированы: {reason}"), f"kick {nick}")

    if user.get("telegram_id"):
        await notify.send_ban_notice(int(user["telegram_id"]), nick, reason)
    log.info("Banned %s (source=%s): %s", nick, source, reason)
    return True


async def unban(username: str, source: str = "tg") -> bool:
    """Полный разбан: БД + pardon на сервере + уведомление."""
    user = await users.get_by_username(username)
    if not user:
        return False
    nick = user["minecraft_nick"]

    await db.execute(
        "UPDATE users SET is_banned=0, ban_reason=NULL WHERE minecraft_nick=%s",
        (nick,),
    )
    # Снимаем бан устройства, если он был выдан по этому игроку
    await db.execute("DELETE FROM banned_hwids WHERE mc_username=%s", (nick,))
    # Зеркалим разбан в панель GML (если он пришёл не из неё самой)
    if source != "gml-panel":
        await gml.pardon_player(nick)
    await _rcon_safe(rcon.pardon_player(nick), f"pardon {nick}")

    if user.get("telegram_id"):
        await notify.send_unban_notice(int(user["telegram_id"]), nick)
    log.info("Unbanned %s (source=%s)", nick, source)
    return True


async def _sync_once() -> None:
    """Односторонняя синхронизация: баны панели GML -> БД сайта + сервер.

    Баны, выданные через TG-бота, GML не трогает: снимаем только те,
    что были помечены как выданные панелью (ban_reason = GML_BAN_REASON).
    """
    gml_banned = await gml.list_banned_players()
    if gml_banned is None:
        return  # GML недоступен — ничего не меняем

    rows = await db.fetchall(
        "SELECT minecraft_nick, is_banned, ban_reason FROM users"
    )
    for row in rows:
        nick = row["minecraft_nick"]
        in_gml = nick.lower() in gml_banned
        in_db = bool(row["is_banned"])

        if in_gml and not in_db:
            # Забанили в панели — распространяем на БД, сервер, TG
            await ban(nick, GML_BAN_REASON, source="gml-panel")
        elif not in_gml and in_db and row["ban_reason"] in (GML_BAN_REASON, *_LEGACY_GML_REASONS):
            # Разбанили в панели — снимаем только «панельные» баны
            await unban(nick, source="gml-panel")


async def sync_loop() -> None:
    """Фоновая задача: держит баны GML-панели, БД и сервера в согласии."""
    if not gml.is_configured():
        log.warning("GML не настроен (GML_PANEL_LOGIN/PASSWORD) — синхронизация банов выключена")
        return
    log.info("Ban sync started (every %ss)", BAN_SYNC_INTERVAL)
    while True:
        try:
            await _sync_once()
        except Exception:
            log.exception("Ban sync iteration failed")
        wait = max(BAN_SYNC_INTERVAL, gml.get_backoff())
        await asyncio.sleep(wait)
