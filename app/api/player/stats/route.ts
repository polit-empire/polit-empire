import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const nick = searchParams.get("nick") || searchParams.get("username")

  if (!nick) {
    return NextResponse.json({ error: "Missing nick" }, { status: 400 })
  }

  try {
    const db = await getDb()
    const [rows] = await db.query(
      `SELECT kills, deaths, town FROM player_stats WHERE minecraft_nick = ?`,
      [nick],
    )
    const stats = (rows as any[])[0]

    if (!stats) {
      return NextResponse.json({ kills: 0, deaths: 0, town: null })
    }

    return NextResponse.json({
      kills: stats.kills,
      deaths: stats.deaths,
      town: stats.town,
    })
  } catch (err: any) {
    console.error("[GET /api/player/stats]", err)
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
