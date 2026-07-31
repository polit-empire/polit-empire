import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const username = searchParams.get("username")
  
  if (!username) {
    return NextResponse.json({ error: "username required" }, { status: 400 })
  }

  const botApiBase = process.env.BOT_API_URL || `http://127.0.0.1:${process.env.API_PORT || "8180"}`
  
  const url = `${botApiBase}/api/player/playtime?username=${encodeURIComponent(username)}`
  
  // Мы редиректим клиент (лаунчер) напрямую к боту (например, на Render),
  // чтобы обойти блокировки исходящих соединений (РКН) на самом VDS.
  return NextResponse.redirect(url)
}
