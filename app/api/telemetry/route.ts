import { z } from "zod"
import { getDb } from "@/lib/db"
import { authenticatePlayer } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

const bodySchema = z.object({
  event_type: z.enum(["game_start", "game_crash", "launcher_start", "download_error", "auth_error", "error"]),
  launcher_version: z.string().max(32).optional(),
  os: z.string().max(64).optional(),
  java_version: z.string().max(64).optional(),
  message: z.string().max(4096).optional(),
})

/**
 * POST /api/telemetry
 * Accept a telemetry event from the launcher.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "telemetry", 60, 60_000)
  if (limited) return limited

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: "Invalid event", details: parsed.error.flatten() }, { status: 400 })
  }

  // Nick is derived from the token if present (telemetry also accepted anonymously)
  const user = await authenticatePlayer(request)

  const db = getDb()
  await db.query(
    `INSERT INTO telemetry (event_type, minecraft_nick, launcher_version, os, java_version, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      parsed.data.event_type,
      user?.minecraft_nick ?? null,
      parsed.data.launcher_version ?? null,
      parsed.data.os ?? null,
      parsed.data.java_version ?? null,
      parsed.data.message ?? null,
    ]
  )

  return Response.json({ ok: true })
}
