import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/player/playtime?username=...
 *
 * Возвращает наигранное время игрока (та же логика, что в ботовом
 * GET /api/player/playtime). Сначала проксируем запрос к боту (BOT_API_URL
 * или локальный 127.0.0.1:8180), чтобы учесть «живые» минуты незакрытой
 * сессии. Если бот недоступен — читаем таблицы напрямую из БД (общей с
 * ботом), чтобы лаунчер/плохая плашка не показывали пустоту.
 *
 * Раньше этот эндпоинт делал redirect на внешний адрес бота (Render),
 * но тот сервис отключён/нестабилен — клиенты получали 503/HTML и видели
 * «ещё не играли».
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const username = (searchParams.get("username") || "").trim()

  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 })
  }

  const botApiBase = (process.env.BOT_API_URL || `http://127.0.0.1:${process.env.API_PORT || "8180"}`).replace(/\/$/, "")
  const apiSecret = process.env.API_SECRET || process.env.BOT_API_SECRET || ""

  try {
    const resp = await fetch(
      `${botApiBase}/api/player/playtime?username=${encodeURIComponent(username)}`,
      {
        headers: {
          ...(apiSecret ? { "X-Api-Secret": apiSecret } : {}),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      },
    )

    const data = await resp.json().catch(() => null)
    if (resp.ok && data && typeof data.playtime_seconds === "number") {
      return NextResponse.json(data, { status: 200 })
    }
  } catch {
    // Бот недоступен — идём ниже в БД напрямую.
  }

  return NextResponse.json(await fetchPlaytimeFromDb(username))
}

/** Читает наигранное время из общей с ботом БД (как в bot/api/server.py). */
async function fetchPlaytimeFromDb(username: string) {
  try {
    const db = await getDb()

    const [rows] = await db.query(
      `SELECT total_seconds, session_count, longest_session_seconds, last_session_seconds
       FROM bot_playtime WHERE mc_username = ?`,
      [username],
    )
    const [sessions] = await db.query(
      `SELECT UNIX_TIMESTAMP(joined_at) AS joined_ts,
              UNIX_TIMESTAMP(COALESCE(last_ticked_at, joined_at)) AS ticked_ts,
              UNIX_TIMESTAMP() AS now_ts
       FROM bot_play_sessions WHERE mc_username = ?`,
      [username],
    )

    const row = (rows as any[])[0]
    const session = (sessions as any[])[0]

    const storedTotal = row?.total_seconds ?? 0
    const storedCount = row?.session_count ?? 0
    const storedLongest = row?.longest_session_seconds ?? 0
    const storedLast = row?.last_session_seconds ?? 0

    let live = 0
    let unticked = 0
    if (session) {
      const now = Number(session.now_ts) || 0
      const joined = Number(session.joined_ts) || now
      const ticked = Number(session.ticked_ts) || joined
      live = Math.max(0, now - joined)
      unticked = Math.max(0, now - ticked)
    }

    return {
      playtime_seconds: Number(storedTotal) + unticked,
      session_count: Number(storedCount) + (session ? 1 : 0),
      longest_session_seconds: session ? Math.max(Number(storedLongest), live) : Number(storedLongest),
      last_session_seconds: session ? live : Number(storedLast),
    }
  } catch (err: any) {
    console.error("[GET /api/player/playtime] DB fallback failed", err)
    return {
      playtime_seconds: 0,
      session_count: 0,
      longest_session_seconds: 0,
      last_session_seconds: 0,
    }
  }
}