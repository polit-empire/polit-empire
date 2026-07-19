"""Выдача/списание DC Coin через RCON: dc give <ник> <сумма> / dc take <ник> <сумма>."""
import asyncio
import logging

import aiomcrcon

from bot import config, db

log = logging.getLogger("rcon")
_lock = asyncio.Lock()


async def _send(command: str) -> str:
    async with _lock:
        client = aiomcrcon.Client(config.RCON_HOST, config.RCON_PORT, config.RCON_PASSWORD)
        try:
            await client.connect(timeout=10)
            response, _ = await client.send_cmd(command, timeout=10)
            return response
        finally:
            try:
                await client.close()
            except Exception:
                pass


async def send_command(command: str) -> str:
    """Выполняет произвольную RCON-команду (без записи в журнал)."""
    return await _send(command)


async def give_coins(mc_username: str, amount: int, reason: str, actor: str = "system") -> str:
    """Начисляет DC Coin и пишет журнал."""
    if amount <= 0:
        raise ValueError("amount must be > 0")
    response = await _send(f"dc give {mc_username} {amount}")
    await db.execute(
        "INSERT INTO bot_balance_log (mc_username, amount, reason, actor) VALUES (%s, %s, %s, %s)",
        (mc_username, amount, reason, actor),
    )
    log.info("RCON give %s -> %s: %s", amount, mc_username, response)
    return response


async def ban_player(mc_username: str, reason: str) -> str:
    """Банит игрока на сервере (vanilla banlist) — с нормальной причиной.

    Причина отображается игроку при попытке зайти на сервер без
    искажений кодировки (в отличие от отказа GML authlib, который
    показывал escaped-unicode вида \\u00DA).
    """
    return await _send(f"ban {mc_username} {reason}")


async def pardon_player(mc_username: str) -> str:
    """Снимает бан с игрока на сервере."""
    return await _send(f"pardon {mc_username}")


async def kick_player(mc_username: str, reason: str) -> str:
    """Кикает игрока с сервера (если он сейчас онлайн)."""
    return await _send(f"kick {mc_username} {reason}")


async def take_coins(mc_username: str, amount: int, reason: str, actor: str = "system") -> str:
    """Списывает DC Coin и пишет журнал."""
    if amount <= 0:
        raise ValueError("amount must be > 0")
    response = await _send(f"dc take {mc_username} {amount}")
    await db.execute(
        "INSERT INTO bot_balance_log (mc_username, amount, reason, actor) VALUES (%s, %s, %s, %s)",
        (mc_username, -amount, reason, actor),
    )
    log.info("RCON take %s <- %s: %s", amount, mc_username, response)
    return response
