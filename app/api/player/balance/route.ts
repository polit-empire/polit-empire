import { NextRequest } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/player/balance?username=...
 *
 * Прокси к bot API (http://127.0.0.1:8180/api/player/balance).
 * Возвращает DC-баланс игрока из bot_balance_log (общий журнал сайта/бота).
 * Используется плагином BotLink для плейсхолдера %botlink_dc%.
 */
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")
  if (!username) {
    return Response.json({ error: "username required" }, { status: 400 })
  }

  const botApiBase = process.env.BOT_API_URL || `http://127.0.0.1:${process.env.API_PORT || "8180"}`
  const apiSecret = process.env.API_SECRET || process.env.BOT_API_SECRET || ""

  if (!apiSecret) {
    return Response.json({ error: "API secret not configured" }, { status: 500 })
  }

  try {
    const url = `${botApiBase}/api/player/balance?username=${encodeURIComponent(username)}`
    const resp = await fetch(url, {
      headers: { "X-Api-Secret": apiSecret, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    const data = await resp.json()
    return Response.json(data, { status: resp.status })
  } catch {
    return Response.json({ balance: 0 }, { status: 200 })
  }
}
