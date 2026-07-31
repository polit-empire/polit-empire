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
    public_endpoints = ["/api/health", "/api/player/playtime", "/api/player/playtime/top"]
    if request.path.startswith("/api/") and request.path not in public_endpoints:
        if not config.API_SECRET or request.headers.get("X-Api-Secret") != config.API_SECRET:
            return web.json_response({"error": "unauthorized"}, status=401)
    return await handler(request)


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True})


async def handle_player_join(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        username = (data.get("username") or "").strip()
        ip = data.get("ip")
        if not username:
            return web.json_response({"error": "username required"}, status=400)

        try:
            user = await users.get_by_username(username)
        except Exception:
            log.exception("Error getting user from site DB, proceeding without 2FA")
            user = None

        # Журнал входа
        try:
            await db.execute(
                "INSERT INTO bot_auth_log (mc_username, event, ip, success) VALUES (%s, 'join', %s, 1)",
                (username, ip),
            )
        except Exception:
            log.exception("Failed to insert into bot_auth_log")

        # Открываем игровую сессию
        await _close_session(username)
        try:
            await db.execute(
                "INSERT INTO bot_play_sessions (mc_username, joined_at, last_ticked_at, plugin_last_seen, ip) "
                "VALUES (%s, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP(), %s) "
                "ON DUPLICATE KEY UPDATE joined_at=UTC_TIMESTAMP(), last_ticked_at=UTC_TIMESTAMP(), plugin_last_seen=UTC_TIMESTAMP(), ip=VALUES(ip)",
                (username, ip),
            )
        except Exception:
            log.exception("Failed to insert into bot_play_sessions")

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
    except Exception:
        log.exception("Error in handle_player_join")
        return web.json_response({"error": "internal server error"}, status=500)


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
    try:
        session = await db.fetchone(
            "SELECT UNIX_TIMESTAMP(joined_at) AS joined_ts, "
            "UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts, "
            "UNIX_TIMESTAMP() AS now_ts "
            "FROM bot_play_sessions WHERE mc_username=%s", (username,)
        )
        if not session:
            return
        now_ts = int(session["now_ts"]) if session.get("now_ts") is not None else 0
        joined_ts = int(session["joined_ts"]) if session.get("joined_ts") is not None else now_ts
        ticked_ts = int(session["ticked_ts"]) if session.get("ticked_ts") is not None else joined_ts

        total_session = max(0, now_ts - joined_ts)
        unticked = max(0, now_ts - ticked_ts)

        await db.execute("DELETE FROM bot_play_sessions WHERE mc_username=%s", (username,))
        if total_session > 0:
            capped = min(total_session, 24 * 3600)
            if unticked > 0:
                await _add_playtime(username, unticked)
                await referrals.add_playtime(username, unticked)
            await _update_session_stats(username, capped)
    except Exception:
        log.exception("Error closing session for %s", username)


async def handle_player_quit(request: web.Request) -> web.Response:
    try:
        data = await request.json()
        username = (data.get("username") or "").strip()
        if not username:
            return web.json_response({"error": "username required"}, status=400)
        try:
            await db.execute(
                "INSERT INTO bot_auth_log (mc_username, event, success) VALUES (%s, 'quit', 1)",
                (username,),
            )
        except Exception:
            log.exception("Failed to insert into bot_auth_log for quit")
        await _close_session(username)
        return web.json_response({"ok": True})
    except Exception:
        log.exception("Error handling player quit")
        return web.json_response({"error": "internal server error"}, status=500)


async def _add_playtime(username: str, seconds: int) -> None:
    """Добавляет секунды в общее наигранное время игрока (bot_playtime)."""
    if seconds <= 0:
        return
    sec = int(seconds)
    await db.execute(
        "INSERT INTO bot_playtime (mc_username, total_seconds, session_count, longest_session_seconds, last_session_seconds) "
        "VALUES (%s, %s, 0, 0, 0) "
        "ON DUPLICATE KEY UPDATE total_seconds = total_seconds + VALUES(total_seconds)",
        (username, sec),
    )


async def _update_session_stats(username: str, session_seconds: int) -> None:
    """Обновляет статистику сессий: количество, лучшая, последняя."""
    sec = int(session_seconds)
    await db.execute(
        "INSERT INTO bot_playtime (mc_username, total_seconds, session_count, longest_session_seconds, last_session_seconds) "
        "VALUES (%s, 0, 1, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "session_count = session_count + 1, "
        "longest_session_seconds = GREATEST(longest_session_seconds, VALUES(longest_session_seconds)), "
        "last_session_seconds = VALUES(last_session_seconds)",
        (username, sec, sec),
    )


async def _update_live_session_stats(username: str, live_session_seconds: int) -> None:
    """Обновляет лучшую и последнюю сессию для АКТИВНОЙ сессии (не увеличивая session_count)."""
    sec = int(live_session_seconds)
    if sec <= 0:
        return
    await db.execute(
        "INSERT INTO bot_playtime (mc_username, total_seconds, session_count, longest_session_seconds, last_session_seconds) "
        "VALUES (%s, 0, 0, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "longest_session_seconds = GREATEST(longest_session_seconds, VALUES(longest_session_seconds)), "
        "last_session_seconds = VALUES(last_session_seconds)",
        (username, sec, sec),
    )


async def handle_player_playtime(request: web.Request) -> web.Response:
    """GET /api/player/playtime?username=... -> {"playtime_seconds": N, "session_count": N, "longest_session_seconds": N, "last_session_seconds": N}"""
    try:
        username = (request.query.get("username") or "").strip()
        if not username:
            return web.json_response({"error": "username required"}, status=400)
            
        if config.API_SECRET and request.headers.get("X-Api-Secret") == config.API_SECRET:
            try:
                await db.execute("UPDATE bot_play_sessions SET plugin_last_seen=UTC_TIMESTAMP() WHERE mc_username=%s", (username,))
            except Exception:
                pass
                
        row = await db.fetchone(
            "SELECT total_seconds, session_count, longest_session_seconds, last_session_seconds "
            "FROM bot_playtime WHERE mc_username=%s", (username,)
        )
        session = await db.fetchone(
            "SELECT UNIX_TIMESTAMP(joined_at) AS joined_ts, "
            "UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts, "
            "UNIX_TIMESTAMP() AS now_ts FROM bot_play_sessions WHERE mc_username=%s", (username,)
        )
        live_secs = 0
        unticked_secs = 0
        if session:
            now_ts = int(session["now_ts"]) if session.get("now_ts") is not None else 0
            joined_ts = int(session["joined_ts"]) if session.get("joined_ts") is not None else now_ts
            ticked_ts = int(session["ticked_ts"]) if session.get("ticked_ts") is not None else joined_ts
            live_secs = max(0, now_ts - joined_ts)
            unticked_secs = max(0, now_ts - ticked_ts)

        stored_total = int(row["total_seconds"]) if row and row.get("total_seconds") is not None else 0
        stored_count = int(row["session_count"]) if row and row.get("session_count") is not None else 0
        stored_longest = int(row["longest_session_seconds"]) if row and row.get("longest_session_seconds") is not None else 0
        stored_last = int(row["last_session_seconds"]) if row and row.get("last_session_seconds") is not None else 0

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
    except Exception:
        log.exception("Error handling player playtime")
        # Вместо 500 возвращаем нули, чтобы плагин не отваливался
        return web.json_response({
            "playtime_seconds": 0,
            "session_count": 0,
            "longest_session_seconds": 0,
            "last_session_seconds": 0,
        })


async def handle_player_playtime_top(request: web.Request) -> web.Response:
    """GET /api/player/playtime/top?limit=10 -> {"top": [{"username": "...", "playtime_seconds": N}, ...]}"""
    try:
        limit = int(request.query.get("limit", 10))
        limit = min(50, max(1, limit))
        rows = await db.fetchall(
            "SELECT mc_username, total_seconds FROM bot_playtime ORDER BY total_seconds DESC LIMIT %s",
            (limit,)
        )
        top = [{"username": r["mc_username"], "playtime_seconds": r["total_seconds"]} for r in rows]
        return web.json_response({"top": top})
    except Exception:
        log.exception("Error handling player playtime top")
        return web.json_response({"error": "internal server error"}, status=500)


async def handle_player_balance(request: web.Request) -> web.Response:
    """GET /api/player/balance?username=... -> {"balance": 100}"""
    try:
        username = (request.query.get("username") or "").strip()
        if not username:
            return web.json_response({"error": "username required"}, status=400)
        row = await db.fetchone(
            "SELECT COALESCE(SUM(amount), 0) AS bal FROM bot_balance_log WHERE mc_username=%s",
            (username,),
        )
        balance = row["bal"] if row else 0
        return web.json_response({"balance": int(balance)})
    except Exception:
        log.exception("Error handling player balance")
        return web.json_response({"balance": 0})


async def _playtime_ticker() -> None:
    """Каждые 10 секунд добавляет время открытым сессиям, чтобы порог 10 минут
    срабатывал без ожидания выхода игрока."""
    while True:
        await asyncio.sleep(TICK_SECONDS)
        try:
            sessions = await db.fetchall(
                "SELECT mc_username, UNIX_TIMESTAMP(joined_at) AS joined_ts, "
                "UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts, "
                "UNIX_TIMESTAMP() AS now_ts, "
                "UNIX_TIMESTAMP(plugin_last_seen) AS plugin_last_seen_ts "
                "FROM bot_play_sessions"
            )
            for s in sessions:
                now_ts = int(s["now_ts"]) if s.get("now_ts") is not None else 0
                plugin_last_seen_ts = int(s["plugin_last_seen_ts"]) if s.get("plugin_last_seen_ts") is not None else now_ts
                
                if now_ts - plugin_last_seen_ts > 120:
                    log.info("Closing ghost session for %s (no keep-alive from plugin)", s["mc_username"])
                    await _close_session(s["mc_username"])
                    continue
                
                joined_ts = int(s["joined_ts"]) if s.get("joined_ts") is not None else now_ts
                ticked_ts = int(s["ticked_ts"]) if s.get("ticked_ts") is not None else joined_ts
                delta = max(0, now_ts - ticked_ts)
                live_secs = max(0, now_ts - joined_ts)
                await db.execute(
                    "UPDATE bot_play_sessions SET last_ticked_at=FROM_UNIXTIME(%s) WHERE mc_username=%s",
                    (now_ts, s["mc_username"]),
                )
                if delta > 0:
                    await _add_playtime(s["mc_username"], delta)
                    await referrals.add_playtime(s["mc_username"], delta)
                await _update_live_session_stats(s["mc_username"], live_secs)
        except Exception:
            log.exception("playtime ticker error")


async def handle_root(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "message": "PolitEmpire Bot API is running!"})


async def start_api() -> None:
    app = web.Application()
    app.middlewares.append(auth_middleware)
    app.router.add_get("/", handle_root)
    app.router.add_get("/api/health", handle_health)
    app.router.add_post("/api/player/join", handle_player_join)
    app.router.add_post("/api/player/quit", handle_player_quit)
    app.router.add_post("/api/2fa/verify", handle_2fa_verify)
    app.router.add_get("/api/player/playtime", handle_player_playtime)
    app.router.add_get("/api/player/playtime/top", handle_player_playtime_top)
    app.router.add_get("/api/player/balance", handle_player_balance)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, config.API_HOST, config.API_PORT)
    await site.start()
    log.info("API listening on %s:%s", config.API_HOST, config.API_PORT)

    asyncio.create_task(_playtime_ticker())
