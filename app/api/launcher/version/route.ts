import { getDb } from "@/lib/db"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/launcher/version
 * Return { version, downloadUrl, changelog } for the active launcher build.
 */
export async function GET(request: Request) {
  const limited = checkRateLimit(request, "launcher-version", 30, 60_000)
  if (limited) return limited

  const db = getDb()
  const [rows] = await db.query(
    "SELECT version, changelog FROM launcher_versions WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
  )
  const versions = rows as { version: string; changelog: string | null }[]

  if (versions.length === 0) {
    return Response.json({ error: "Версия лаунчера не опубликована" }, { status: 404 })
  }

  const base = process.env.PUBLIC_BASE_URL || new URL(request.url).origin
  return Response.json({
    version: versions[0].version,
    downloadUrl: `${base}/api/launcher/download`,
    changelog: versions[0].changelog || "",
  })
}
