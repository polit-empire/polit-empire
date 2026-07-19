import { getVoteSites, getSetting } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/vote/sites
 * Публичный список мониторингов для витрины (название, ссылка, бонус) +
 * кулдаун. Секретный ключ колбэка НЕ отдаётся.
 */
export async function GET() {
  const [sites, cooldown] = await Promise.all([getVoteSites(), getSetting("vote_cooldown_hours", "24")])
  return Response.json({
    sites: sites.map((s) => ({ id: s.id, name: s.name, url: s.url, bonus: s.bonus })),
    cooldownHours: Math.max(1, Number(cooldown) || 24),
  })
}
