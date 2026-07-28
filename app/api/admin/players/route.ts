import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"
import { getActivePrivilege, getDcBalance } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

/**
 * Список игроков + сводка (бан, привилегия, DC).
 *
 * Результаты сортируются по присутствию: в игре -> в лаунчере -> офлайн.
 * Пагинация не даёт тяжёлому списку перегружать БД, но позволяет админке
 * последовательно показать абсолютно всех зарегистрированных игроков.
 */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const params = new URL(req.url).searchParams
  const q = params.get("q")?.trim() ?? ""
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  )
  const offset = (page - 1) * pageSize
  const like = `%${q}%`
  const db = getDb()

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM users u
     WHERE u.minecraft_nick LIKE ?`,
    [like],
  )
  const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0)

  // launcher_online: heartbeat свежее 90с; launcher_status: idle|playing.
  // in_game: игрок числится в активной игровой сессии (плагин сервера).
  const [rows] = await db.query(
    `SELECT u.minecraft_nick, u.is_banned, u.ban_reason, u.ban_expires, u.telegram_id, u.last_login,
            u.last_hwid, u.last_ip,
            hb.status AS launcher_status,
            (hb.last_seen IS NOT NULL AND hb.last_seen > (NOW() - INTERVAL 90 SECOND)) AS launcher_online,
            (ps.mc_username IS NOT NULL) AS in_game
     FROM users u
     LEFT JOIN launcher_heartbeats hb ON hb.minecraft_nick = u.minecraft_nick
     LEFT JOIN bot_play_sessions ps ON ps.mc_username = u.minecraft_nick
     WHERE u.minecraft_nick LIKE ?
     ORDER BY
       (ps.mc_username IS NOT NULL) DESC,
       (hb.last_seen IS NOT NULL AND hb.last_seen > (NOW() - INTERVAL 90 SECOND)) DESC,
       CASE WHEN hb.status = 'playing' THEN 0 WHEN hb.status = 'idle' THEN 1 ELSE 2 END ASC,
       u.last_login DESC,
       u.minecraft_nick ASC
     LIMIT ? OFFSET ?`,
    [like, pageSize, offset],
  )
  const users = rows as Array<{
    minecraft_nick: string
    is_banned: number
    ban_reason: string | null
    ban_expires: Date | null
    telegram_id: number | null
    last_login: Date | null
    last_hwid: string | null
    last_ip: string | null
    launcher_status: string | null
    launcher_online: number
    in_game: number
  }>

  const enriched = await Promise.all(
    users.map(async (u) => {
      const [priv, dc] = await Promise.all([
        getActivePrivilege(u.minecraft_nick),
        getDcBalance(u.minecraft_nick),
      ])
      return {
        ...u,
        launcher_online: Boolean(u.launcher_online),
        in_game: Boolean(u.in_game),
        privilege: priv?.group_name ?? null,
        privilege_expires: priv?.expires_at ?? null,
        ban_expires: u.ban_expires ?? null,
        dc,
      }
    }),
  )

  return NextResponse.json({
    players: enriched,
    page,
    pageSize,
    total,
    hasMore: offset + enriched.length < total,
  })
}
