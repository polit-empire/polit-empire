import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/player/playtime/top?limit=...
 *
 * Топ игроков по наигранному времени. Сначала проксируем к боту
 * (BOT_API_URL), чтобы учесть «живые» минуты незакрытых сессий.
 * Если бот недоступен — читаем напрямую из БД (общей с ботом).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limitRaw = parseInt(searchParams.get("limit") || "10", 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 10

  const botApiBase = (process.env.BOT_API_URL || `http://127.0.0.1:${process.env.API_PORT || "8180"}`).replace(/\/$/, "")
  const apiSecret = process.env.API_SECRET || process.env.BOT_API_SECRET || ""

  try {
    const resp = await fetch(
      `${botApiBase}/api/player/playtime/top?limit=${limit}`,
      {
        headers: {
          ...(apiSecret ? { "X-Api-Secret": apiSecret } : {}),
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
      },
    )
    const data = await resp.json().catch(() => null)
    if (resp.ok && data && Array.isArray(data.top)) {
      return NextResponse.json(data, { status: 200 })
    }
  } catch {
    // Бот недоступен — идём ниже в БД напрямую.
  }

  try {
    const db = await getDb()
    const [rows] = await db.query(
      `SELECT mc_username AS username, total_seconds AS playtime_seconds
       FROM bot_playtime
       WHERE total_seconds > 0
       ORDER BY total_seconds DESC
       LIMIT ?`,
      [limit],
    )
    return NextResponse.json({ top: rows })
  } catch (err: any) {
    console.error("[GET /api/player/playtime/top] DB fallback failed", err)
    return NextResponse.json({ top: [] }, { status: 200 })
  }
}
