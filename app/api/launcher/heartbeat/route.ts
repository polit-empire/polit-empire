import { z } from "zod"
import { getDb } from "@/lib/db"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  status: z.enum(["idle", "playing"]).optional().default("idle"),
  launcher_version: z.string().max(32).optional(),
  os: z.string().max(64).optional(),
})

/**
 * POST /api/launcher/heartbeat
 *
 * Лаунчер раз в ~30 секунд сообщает, что он запущен и в каком состоянии
 * (idle — открыт, playing — идёт игра). По свежести last_seen админка
 * показывает индикатор «лаунчер запущен». Авторизация — Bearer-токен.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "launcher-heartbeat", 60, 60_000)
  if (limited) return limited

  const user = await authenticatePlayer(request)
  if (!user) return unauthorized()

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 })
  }

  const db = getDb()
  await db.query(
    `INSERT INTO launcher_heartbeats (minecraft_nick, status, launcher_version, os, last_seen)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       launcher_version = VALUES(launcher_version),
       os = VALUES(os),
       last_seen = NOW()`,
    [user.minecraft_nick, parsed.data.status, parsed.data.launcher_version ?? null, parsed.data.os ?? null],
  )

  return Response.json({ ok: true })
}
