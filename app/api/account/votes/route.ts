import { getSessionUser } from "@/lib/session"
import { getDb } from "@/lib/db"
import { getVoteSites, getSetting } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/account/votes
 * Для личного кабинета: список мониторингов + когда игрок голосовал последний
 * раз на каждом (чтобы показать, доступен ли голос) + суммарно заработано DC.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Не авторизован" }, { status: 401 })

  const [sites, cooldownRaw] = await Promise.all([
    getVoteSites(),
    getSetting("vote_cooldown_hours", "24"),
  ])
  const cooldownHours = Math.max(1, Number(cooldownRaw) || 24)
  const db = getDb()

  // Последний голос по каждому мониторингу для этого игрока.
  const [rows] = await db.query(
    `SELECT site_id, MAX(created_at) AS last_at FROM vote_log
      WHERE minecraft_nick = ? GROUP BY site_id`,
    [user.minecraft_nick],
  )
  const lastBySite = new Map<string, string>()
  for (const r of rows as Array<{ site_id: string; last_at: string }>) {
    lastBySite.set(r.site_id, r.last_at)
  }

  const [earnedRows] = await db.query(
    `SELECT COALESCE(SUM(bonus), 0) AS total FROM vote_log WHERE minecraft_nick = ?`,
    [user.minecraft_nick],
  )
  const totalEarned = Number((earnedRows as Array<{ total: number }>)[0]?.total ?? 0)

  const now = Date.now()
  const cooldownMs = cooldownHours * 3_600_000
  const sitesOut = sites.map((s) => {
    const last = lastBySite.get(s.id) ?? null
    const lastMs = last ? new Date(last).getTime() : 0
    const availableAt = lastMs ? new Date(lastMs + cooldownMs).toISOString() : null
    const available = !lastMs || now >= lastMs + cooldownMs
    return { id: s.id, name: s.name, url: s.url, bonus: s.bonus, available, availableAt }
  })

  return Response.json({ sites: sitesOut, cooldownHours, totalEarned })
}
