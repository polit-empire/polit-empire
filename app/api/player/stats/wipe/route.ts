import { getSetting } from "@/lib/donate"
import { safeEqual } from "@/lib/tokens"
import { getRawDb as getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/player/stats/wipe
 * Очищает статистику (K/D/Towny) по запросу от плагина (команда /polit wipe).
 * Требует заголовок X-Mod-Key.
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

  try {
    const db = getDb()
    await db.query("TRUNCATE TABLE player_stats")
    return Response.json({ ok: true })
  } catch (err: any) {
    console.error("[POST /api/player/stats/wipe]", err)
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
