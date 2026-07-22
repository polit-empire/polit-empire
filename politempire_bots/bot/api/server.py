"""HTTP API для Minecraft-плагина.

Плагин на сервере вызывает эти эндпоинты (все запросы с заголовком X-Api-Secret):

POST /api/player/join   {"username": "...", "ip": "..."}
    -> {"require_2fa": true|false}  При require_2fa=true код уже отправлен в Telegram,
       плагин должен заблокировать игрока до POST /api/2fa/verify.

POST /api/2fa/verify    {"username": "...", "code": "..."}
    -> {"ok": true|false}

POST /api/player/quit   {"username": "..."}
    -> {"ok": true}  Закрывает сессию и добавляет наигранное время рефералу.

GET  /api/health        -> {"ok": true}

Учёт 10 минут также ведётся фоновым тиком по открытым сессиям, чтобы награда
выдавалась сразу по достижении порога, а не только при выходе игрока.
"""
import asyncio
import logging
from datetime import datetime

from aiohttp import web

from bot import config, db
from bot.services import referrals, twofa, users
from bot.tg import notify

log = logging.getLogger("api")

TICK_SECONDS = 10


@web.middleware
async def auth_middleware(request: web.Request, handler):
    if request.path.startswith("/api/") and request.path != "/api/health":
        if not config.API_SECRET or request.headers.get("X-Api-Secret") != config.API_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
    return await handler(request)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def handle_player_join(request: web.Request) -> web.Response:
    data = await request.json()
    username = (data.get("username") or "").strip()
    ip = data.get("ip")
    if not username:
        return web.json_response({"error": "username required"}, status=400)

    user = await users.get_by_username(username)

    # Журнал входа
    await db.execute(
        "INSERT INTO bot_auth_log (mc_username, event, ip, success) VALUES (%s, 'join', %s, 1)",
        (username, ip),
    )

    # Открываем игровую сессию (сначала закрываем старую, если не была закрыта)
    await _close_session(username)
    await db.execute(
        "INSERT INTO bot_play_sessions (mc_username, joined_at, last_ticked_at, ip) "
        "VALUES (%s, UTC_TIMESTAMP(), UTC_TIMESTAMP(), %s) "
        "ON DUPLICATE KEY UPDATE joined_at=UTC_TIMESTAMP(), last_ticked_at=UTC_TIMESTAMP(), ip=VALUES(ip)",
        (username, ip),
    )

    if user and user.get("is_banned"):
        return web.json_response({"require_2fa": False, "banned": True,
                                  "reason": user.get("ban_reason") or ""})

    # 2FA
    require = False
    if user and await twofa.is_enabled_for_user(user["minecraft_nick"]):
        if user.get("telegram_id"):
            code = await twofa.create_code(user["minecraft_nick"])
            sent = await notify.send_2fa_code(
                user["telegram_id"], username, code, config.TWOFA_CODE_TTL
            )
            require = sent
            if not sent:
                log.error("Could not deliver 2FA code to %s", username)
        else:
            log.warning("2FA enabled for %s but no telegram_id", username)

    return web.json_response({"require_2fa": require, "banned": False})


async def handle_2fa_verify(request: web.Request) -> web.Response:
    data = await request.json()
    username = (data.get("username") or "").strip()
    code = (data.get("code") or "").strip()
    user = await users.get_by_username(username)
    if not user:
        return web.json_response({"ok": False})
    ok = await twofa.verify_code(user["minecraft_nick"], code)
    await db.execute(
        "INSERT INTO bot_auth_log (mc_username, event, success) VALUES (%s, '2fa', %s)",
        (username, 1 if ok else 0),
    )
    return web.json_response({"ok": ok})


async def _close_session(username: str) -> None:
    session = await db.fetchone(
        "SELECT UNIX_TIMESTAMP(joined_at) AS joined_ts, "
        "UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts, "
        "UNIX_TIMESTAMP() AS now_ts "
        "FROM bot_play_sessions WHERE mc_username=%s", (username,)
    )
    if not session:
        return
    total_session = max(0, session["now_ts"] - session["joined_ts"])
    unticked = max(0, session["now_ts"] - session["ticked_ts"])

    await db.execute("DELETE FROM bot_play_sessions WHERE mc_username=%s", (username,))
    if total_session > 0:
        capped = min(total_session, 24 * 3600)
        if unticked > 0:
            await _add_playtime(username, unticked)
            await referrals.add_playtime(username, unticked)
        await _update_session_stats(username, capped)


async def handle_player_quit(request: web.Request) -> web.Response:
    data = await request.json()
    username = (data.get("username") or "").strip()
    if not username:
        return web.json_response({"error": "username required"}, status=400)
    await db.execute(
        "INSERT INTO bot_auth_log (mc_username, event, success) VALUES (%s, 'quit', 1)",
        (username,),
    )
    await _close_session(username)
    return web.json_response({"ok": True})


async def _add_playtime(username: str, seconds: int) -> None:
    """Добавляет секунды в общее наигранное время игрока (bot_playtime)."""
    if seconds <= 0:
        return
    await db.execute(
        "INSERT INTO bot_playtime (mc_username, total_seconds) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE total_seconds = total_seconds + VALUES(total_seconds)",
        (username, seconds),
    )


async def _update_session_stats(username: str, session_seconds: int) -> None:
    """Обновляет статистику сессий: количество, лучшая, последняя."""
    await db.execute(
        "INSERT INTO bot_playtime (mc_username, session_count, longest_session_seconds, last_session_seconds) "
        "VALUES (%s, 1, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "session_count = session_count + 1, "
        "longest_session_seconds = GREATEST(longest_session_seconds, VALUES(longest_session_seconds)), "
        "last_session_seconds = VALUES(last_session_seconds)",
        (username, session_seconds, session_seconds),
    )


async def _update_live_session_stats(username: str, live_session_seconds: int) -> None:
    """Обновляет лучшую и последнюю сессию для АКТИВНОЙ сессии (не увеличивая session_count)."""
    if live_session_seconds <= 0:
        return
    await db.execute(
        "INSERT INTO bot_playtime (mc_username, session_count, longest_session_seconds, last_session_seconds) "
        "VALUES (%s, 0, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "longest_session_seconds = GREATEST(longest_session_seconds, VALUES(longest_session_seconds)), "
        "last_session_seconds = VALUES(last_session_seconds)",
        (username, live_session_seconds, live_session_seconds),
    )


async def handle_player_playtime(request: web.Request) -> web.Response:
    """GET /api/player/playtime?username=... -> {"playtime_seconds": N, "session_count": N, "longest_session_seconds": N, "last_session_seconds": N}"""
    username = (request.query.get("username") or "").strip()
    if not username:
        return web.json_response({"error": "username required"}, status=400)
    row = await db.fetchone(
        "SELECT total_seconds, session_count, longest_session_seconds, last_session_seconds "
        "FROM bot_playtime WHERE mc_username=%s", (username,)
    )
    # Учитываем также время текущей незакрытой сессии
    session = await db.fetchone(
        "SELECT UNIX_TIMESTAMP(joined_at) AS joined_ts, "
        "UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts, "
        "UNIX_TIMESTAMP() AS now_ts FROM bot_play_sessions WHERE mc_username=%s", (username,)
    )
    live_secs = 0
    unticked_secs = 0
    if session:
        live_secs = max(0, session["now_ts"] - session["joined_ts"])
        unticked_secs = max(0, session["now_ts"] - session["ticked_ts"])

    stored_total = row["total_seconds"] if row else 0
    stored_count = row["session_count"] if row else 0
    stored_longest = row["longest_session_seconds"] if row else 0
    stored_last = row["last_session_seconds"] if row else 0

    total = stored_total + unticked_secs
    count = stored_count + (1 if session else 0)
    longest = max(stored_longest, live_secs) if session else stored_longest
    last = live_secs if session else stored_last

    return web.json_response({
        "playtime_seconds": total,
        "session_count": count,
        "longest_session_seconds": longest,
        "last_session_seconds": last,
    })


async def handle_player_balance(request: web.Request) -> web.Response:
    """GET /api/player/balance?username=... -> {"balance": 100}"""
    username = (request.query.get("username") or "").strip()
    if not username:
        return web.json_response({"error": "username required"}, status=400)
    row = await db.fetchone(
        "SELECT COALESCE(SUM(amount), 0) AS bal FROM bot_balance_log WHERE mc_username=%s",
        (username,),
    )
    balance = row["bal"] if row else 0
    return web.json_response({"balance": int(balance)})


async def _playtime_ticker() -> None:
    """Каждые 10 секунд добавляет время открытым сессиям, чтобы порог 10 минут
    срабатывал без ожидания выхода игрока."""
    while True:
        await asyncio.sleep(TICK_SECONDS)
        try:
            sessions = await db.fetchall(
                "SELECT mc_username, UNIX_TIMESTAMP(joined_at) AS joined_ts, "
                "UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts, "
                "UNIX_TIMESTAMP() AS now_ts FROM bot_play_sessions"
            )
            for s in sessions:
                delta = max(0, s["now_ts"] - s["ticked_ts"])
                live_secs = max(0, s["now_ts"] - s["joined_ts"])
                await db.execute(
                    "UPDATE bot_play_sessions SET last_ticked_at=FROM_UNIXTIME(%s) WHERE mc_username=%s",
                    (s["now_ts"], s["mc_username"]),
                )
                if delta > 0:
                    await _add_playtime(s["mc_username"], delta)
                    await referrals.add_playtime(s["mc_username"], delta)
                await _update_live_session_stats(s["mc_username"], live_secs)
        except Exception:
            log.exception("playtime ticker error")


async def start_api() -> None:
    app = web.Application(middlewares=[auth_middleware])
    app.router.add_get("/api/health", handle_health)
    app.router.add_post("/api/player/join", handle_player_join)
    app.router.add_post("/api/player/quit", handle_player_quit)
    app.router.add_post("/api/2fa/verify", handle_2fa_verify)
    app.router.add_get("/api/player/playtime", handle_player_playtime)
    app.router.add_get("/api/player/balance", handle_player_balance)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, config.API_HOST, config.API_PORT)
    await site.start()
    log.info("API listening on %s:%s", config.API_HOST, config.API_PORT)

    asyncio.create_task(_playtime_ticker())
