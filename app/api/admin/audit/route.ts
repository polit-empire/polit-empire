import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 100

/**
 * GET /api/admin/audit?section=...&q=&page=&pageSize=
 *
 *  section=admin         — журнал действий администраторов (admin_logs)
 *  section=logins        — входы в лаунчер / личный кабинет (account_events)
 *  section=registrations — регистрации аккаунтов (users.created_at; аккаунты
 *                          создаёт Telegram-бот, поэтому источник — сама таблица
 *                          users, а не account_events)
 *
 * Поиск ?q= работает через LIKE (как в разделе «Игроки»), пагинация — page/pageSize.
 */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const params = new URL(req.url).searchParams
  const section = params.get("section") ?? "admin"
  const q = params.get("q")?.trim() ?? ""
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(params.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  )
  const offset = (page - 1) * pageSize
  const like = `%${q}%`
  const db = getDb()

  try {
    if (section === "admin") {
      const where = q ? "WHERE admin_nick LIKE ? OR target_nick LIKE ? OR action LIKE ? OR detail LIKE ?" : ""
      const whereParams = q ? [like, like, like, like] : []
      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM admin_logs ${where}`, whereParams)
      const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0)
      const [rows] = await db.query(
        `SELECT id, admin_nick, action, target_nick, detail, ip, created_at
         FROM admin_logs ${where}
         ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...whereParams, pageSize, offset],
      )
      return NextResponse.json({ rows, page, pageSize, total, hasMore: offset + (rows as unknown[]).length < total })
    }

    if (section === "logins") {
      const where = q ? "WHERE minecraft_nick LIKE ? OR ip LIKE ? OR detail LIKE ? OR event_type LIKE ?" : ""
      const whereParams = q ? [like, like, like, like] : []
      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM account_events ${where}`, whereParams)
      const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0)
      const [rows] = await db.query(
        `SELECT id, event_type, minecraft_nick, ip, hwid, launcher_version, detail, created_at
         FROM account_events ${where}
         ORDER BY id DESC LIMIT ? OFFSET ?`,
        [...whereParams, pageSize, offset],
      )
      return NextResponse.json({ rows, page, pageSize, total, hasMore: offset + (rows as unknown[]).length < total })
    }

    if (section === "registrations") {
      const where = q ? "WHERE minecraft_nick LIKE ?" : ""
      const whereParams = q ? [like] : []
      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM users ${where}`, whereParams)
      const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0)
      const [rows] = await db.query(
        `SELECT minecraft_nick, telegram_id, created_at, last_login, last_ip, last_hwid, is_banned
         FROM users ${where}
         ORDER BY created_at DESC, minecraft_nick ASC LIMIT ? OFFSET ?`,
        [...whereParams, pageSize, offset],
      )
      return NextResponse.json({ rows, page, pageSize, total, hasMore: offset + (rows as unknown[]).length < total })
    }

    return NextResponse.json({ error: "неизвестная секция" }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
