import { NextRequest } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/player/playtime?username=...
 *
 * Прокси к bot API (http://127.0.0.1:8180/api/player/playtime).
 * Лаунчер использует этот эндпоинт для получения реального наигранного времени
 * из БД (таблица bot_playtime) — того же источника, что и плейсхолдер
 * %botlink_playtime% на сервере. Это гарантирует, что время в лаунчере
 * совпадает с временем в игре.
 *
 * Авторизация: лаунчер не шлёт X-Api-Secret (он есть только у плагина),
 * поэтому мы добавляем его здесь на стороне сервера.
 */
export async function GET(request: NextRequest) {
  const username = request.nextUrl.searchParams.get("username")
  if (!username) {
    return Response.json({ error: "username required" }, { status: 400 })
  }

  const apiPort = process.env.API_PORT || "8180"
  const apiSecret = process.env.API_SECRET || process.env.BOT_API_SECRET || ""

  if (!apiSecret) {
    return Response.json({ error: "API secret not configured" }, { status: 500 })
  }

  try {
    const url = `http://127.0.0.1:${apiPort}/api/player/playtime?username=${encodeURIComponent(username)}`
    const resp = await fetch(url, {
      headers: { "X-Api-Secret": apiSecret, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    const data = await resp.json()
    return Response.json(data, { status: resp.status })
  } catch {
    return Response.json({ playtime_seconds: 0 }, { status: 200 })
  }
}
