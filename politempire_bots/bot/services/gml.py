"""Клиент Gml.Web.Api: статус бана игрока в панели GML.

Бот авторизуется в API панели под сервисным аккаунтом (GML_PANEL_LOGIN /
GML_PANEL_PASSWORD — создайте отдельного пользователя в панели) и по нику
игрока запрашивает /api/v1/players, чтобы узнать, забанен ли он в GML.
"""
import logging
import time

import aiohttp

from bot import config

log = logging.getLogger("gml")

_token: str | None = None
_token_ts: float = 0.0
_TOKEN_TTL = 20 * 60  # перезапрашиваем токен раз в 20 минут
_gml_backoff: int = 0  # текущая задержка между попытками (сек)
_GML_MAX_BACKOFF: int = 300  # максимум 5 минут


def is_configured() -> bool:
    return bool(config.GML_API_URL and config.GML_PANEL_LOGIN and config.GML_PANEL_PASSWORD)


def get_backoff() -> int:
    """Текущая задержка между попытками GML-signin (сек). 0 = можно пробовать."""
    return _gml_backoff


async def _signin(session: aiohttp.ClientSession) -> str | None:
    global _token, _token_ts, _gml_backoff
    try:
        async with session.post(
            f"{config.GML_API_URL}/api/v1/users/signin",
            json={"Login": config.GML_PANEL_LOGIN, "Password": config.GML_PANEL_PASSWORD},
            timeout=aiohttp.ClientTimeout(total=15),
        ) as res:
            if res.status != 200:
                detail = (await res.text())[:300]
                log.warning(
                    "GML signin failed: HTTP %s, ответ: %s | Проверьте GML_PANEL_LOGIN/"
                    "GML_PANEL_PASSWORD и GML_API_URL в .env.",
                    res.status,
                    detail,
                )
                _gml_backoff = min(_gml_backoff * 2 or 30, _GML_MAX_BACKOFF)
                return None
            body = await res.json()
            _token = (body.get("data") or {}).get("accessToken")
            _token_ts = time.monotonic()
            _gml_backoff = 0
            return _token
    except Exception:
        log.warning("GML signin error (timeout/unreachable): GML_API_URL=%s", config.GML_API_URL)
        _gml_backoff = min(_gml_backoff * 2 or 30, _GML_MAX_BACKOFF)
        return None


async def _find_player_uuid(session: aiohttp.ClientSession, mc_username: str) -> str | None:
    """UUID игрока в GML по нику (нужен для ban/pardon через API панели)."""
    async with session.get(
        f"{config.GML_API_URL}/api/v1/players",
        params={"findName": mc_username, "take": 20, "offset": 0},
        headers={"Authorization": f"Bearer {_token}"},
        timeout=aiohttp.ClientTimeout(total=10),
    ) as res:
        if res.status != 200:
            log.warning("GML players lookup failed: HTTP %s", res.status)
            return None
        body = await res.json()
        for p in body.get("data") or []:
            name = p.get("name") or p.get("Name") or ""
            if name.lower() == mc_username.lower():
                return p.get("uuid") or p.get("Uuid")
    return None


async def _set_ban_state(mc_username: str, banned: bool) -> bool:
    """Банит/разбанивает игрока в панели GML (POST /players/ban | /players/pardon)."""
    if not is_configured():
        return False
    async with aiohttp.ClientSession() as session:
        global _token
        if not _token or (time.monotonic() - _token_ts) > _TOKEN_TTL:
            if not await _signin(session):
                return False
        try:
            uuid = await _find_player_uuid(session, mc_username)
            if not uuid:
                log.info("GML: игрок %s не найден, бан в панели пропущен", mc_username)
                return False
            endpoint = "ban" if banned else "pardon"
            async with session.post(
                f"{config.GML_API_URL}/api/v1/players/{endpoint}",
                json=[uuid],
                headers={"Authorization": f"Bearer {_token}"},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as res:
                if res.status != 200:
                    log.warning("GML %s %s failed: HTTP %s", endpoint, mc_username, res.status)
                    return False
                return True
        except Exception:
            log.exception("GML %s error for %s", "ban" if banned else "pardon", mc_username)
            return False


async def ban_player(mc_username: str) -> bool:
    """Помечает игрока забаненным в панели GML."""
    return await _set_ban_state(mc_username, True)


async def pardon_player(mc_username: str) -> bool:
    """Снимает бан игрока в панели GML."""
    return await _set_ban_state(mc_username, False)


def _is_banned(p: dict) -> bool:
    return bool(
        p.get("isBanned") or p.get("IsBanned")
        or p.get("isBannedPermanent") or p.get("IsBannedPermanent")
    )


async def list_banned_players() -> set[str] | None:
    """Возвращает множество ников (lowercase), забаненных в панели GML.

    None — если GML недоступен или не настроен (чтобы синхронизация
    не сняла баны по ошибке при сетевом сбое).
    """
    if not is_configured():
        return None
    banned: set[str] = set()
    async with aiohttp.ClientSession() as session:
        global _token
        if not _token or (time.monotonic() - _token_ts) > _TOKEN_TTL:
            if not await _signin(session):
                return None
        offset, take = 0, 100
        for _page in range(100):  # защита от бесконечного цикла
            try:
                async with session.get(
                    f"{config.GML_API_URL}/api/v1/players",
                    params={"take": take, "offset": offset},
                    headers={"Authorization": f"Bearer {_token}"},
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as res:
                    if res.status == 401:
                        if not await _signin(session):
                            return None
                        continue
                    if res.status != 200:
                        log.warning("GML players list failed: HTTP %s", res.status)
                        return None
                    body = await res.json()
                    players = body.get("data") or []
            except Exception:
                log.exception("GML players list error")
                return None
            for p in players:
                name = (p.get("name") or p.get("Name") or "").strip()
                if name and _is_banned(p):
                    banned.add(name.lower())
            if len(players) < take:
                break
            offset += take
    return banned


async def get_ban_status(mc_username: str) -> dict | None:
    """Возвращает {'banned': bool, 'found': bool} по данным панели GML.

    None — если GML недоступен или не настроен (статус неизвестен).
    """
    if not is_configured():
        return None
    async with aiohttp.ClientSession() as session:
        global _token
        if not _token or (time.monotonic() - _token_ts) > _TOKEN_TTL:
            if not await _signin(session):
                return None
        for attempt in (1, 2):
            try:
                async with session.get(
                    f"{config.GML_API_URL}/api/v1/players",
                    params={"findName": mc_username, "take": 20, "offset": 0},
                    headers={"Authorization": f"Bearer {_token}"},
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as res:
                    if res.status == 401 and attempt == 1:
                        # токен протух — перелогиниваемся и пробуем ещё раз
                        if not await _signin(session):
                            return None
                        continue
                    if res.status != 200:
                        log.warning("GML players query failed: HTTP %s", res.status)
                        return None
                    body = await res.json()
                    players = body.get("data") or []
                    for p in players:
                        name = p.get("name") or p.get("Name") or ""
                        if name.lower() == mc_username.lower():
                            banned = bool(
                                p.get("isBanned") or p.get("IsBanned")
                                or p.get("isBannedPermanent") or p.get("IsBannedPermanent")
                            )
                            return {"banned": banned, "found": True}
                    return {"banned": False, "found": False}
            except Exception:
                log.exception("GML players query error")
                return None
    return None
