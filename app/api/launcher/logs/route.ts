import { z } from "zod"
import { getDb } from "@/lib/db"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const lineSchema = z.object({
  level: z.enum(["info", "warn", "error", "debug"]).optional().default("info"),
  source: z.enum(["game", "launcher"]).optional().default("game"),
  line: z.string().min(1).max(2048),
})

const bodySchema = z.object({
  session: z.string().max(64).optional().default(""),
  lines: z.array(lineSchema).min(1).max(200),
})

// Сколько последних строк лога хранить на игрока (скользящее окно).
const KEEP_PER_NICK = 800

/**
 * POST /api/launcher/logs
 *
 * Лаунчер стримит строки вывода игры/лаунчера пачками. Строки складываются
 * в launcher_logs и показываются в админке (лайв-логи). Чтобы таблица не
 * росла бесконечно, на каждого игрока держим только последние KEEP_PER_NICK
 * строк. Авторизация — Bearer-токен.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "launcher-logs", 120, 60_000)
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

  const nick = user.minecraft_nick
  const session = parsed.data.session || null
  const db = getDb()

  const values = parsed.data.lines.map((l) => [nick, session, l.level, l.source, l.line])
  await db.query(
    "INSERT INTO launcher_logs (minecraft_nick, session, level, source, line) VALUES ?",
    [values],
  )

  // Скользящее окно: удаляем всё, что старше KEEP_PER_NICK последних строк.
  await db.query(
    `DELETE FROM launcher_logs
     WHERE minecraft_nick = ?
       AND id <= (
         SELECT min_id FROM (
           SELECT MIN(id) AS min_id FROM (
             SELECT id FROM launcher_logs
             WHERE minecraft_nick = ?
             ORDER BY id DESC LIMIT ?
           ) AS keep
         ) AS bound
       ) - 1`,
    [nick, nick, KEEP_PER_NICK],
  )

  return Response.json({ ok: true, stored: parsed.data.lines.length })
}
