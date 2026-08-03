import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/2fa/verify
 * Прокси к bot API (bot/api/server.py). Используется плагином BotLink
 * для подтверждения кода 2FA командой /2fa.
 */
export async function POST(request: Request) {
  const botApiBase = (process.env.BOT_API_URL || `http://127.0.0.1:${process.env.API_PORT || "8180"}`).replace(/\/$/, "")
  const apiSecret = process.env.API_SECRET || process.env.BOT_API_SECRET || ""
  const provided = request.headers.get("x-api-secret") ?? ""
  if (!apiSecret || !provided || provided !== apiSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const body = await request.text().catch(() => "")

  try {
    const resp = await fetch(`${botApiBase}/api/2fa/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiSecret ? { "X-Api-Secret": apiSecret } : {}),
        Accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
    const data = await resp.json().catch(() => null)
    return NextResponse.json(data ?? {}, { status: resp.ok ? 200 : 502 })
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
