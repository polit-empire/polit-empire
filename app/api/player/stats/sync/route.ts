import { z } from "zod"
import { getSetting } from "@/lib/donate"
import { safeEqual } from "@/lib/tokens"
import { getRawDb as getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  nick: z.string().min(1).max(32),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  town: z.string().max(64).nullable(),
})

/**
 * POST /api/player/stats/sync
 * Принимает статистику от плагина. Требует заголовок X-Mod-Key.
 */
export async function POST(request: Request) {
  const configuredKey = await getSetting("mod_admin_key", "")
  if (!configuredKey) {
    return Response.json({ error: "Не задан mod_admin_key" }, { status: 403 })
  }
  const provided = request.headers.get("x-mod-key") ?? ""
  if (!provided || !safeEqual(provided, configuredKey)) {
    return Response.json({ error: "Неверный ключ" }, { status: 401 })
  }

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Некорректные параметры" }, { status: 400 })

  const { nick, kills, deaths, town } = parsed.data

  try {
    const db = getDb()
    await db.query(
      `INSERT INTO player_stats (minecraft_nick, kills, deaths, town) 
       VALUES (?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE kills = VALUES(kills), deaths = VALUES(deaths), town = VALUES(town)`,
      [nick, kills, deaths, town]
    )
    return Response.json({ ok: true })
  } catch (err: any) {
    console.error("[POST /api/player/stats/sync]", err)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
