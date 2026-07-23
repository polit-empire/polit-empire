import { NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/admin'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100
const STATUSES = ['open', 'answered', 'closed']

/**
 * GET /api/admin/tickets?status=&q=&page=&pageSize=
 * Список всех тикетов для админ-панели. Фильтр по статусу, поиск по нику/теме
 * (LIKE, как в разделе «Игроки»), пагинация.
 */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const params = new URL(req.url).searchParams
  const status = params.get('status')?.trim() ?? ''
  const q = params.get('q')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(params.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  )
  const offset = (page - 1) * pageSize

  const where: string[] = []
  const whereParams: unknown[] = []
  if (STATUSES.includes(status)) {
    where.push('t.status = ?')
    whereParams.push(status)
  }
  if (q) {
    where.push('(t.minecraft_nick LIKE ? OR t.subject LIKE ?)')
    whereParams.push(`%${q}%`, `%${q}%`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = getDb()

  const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM support_tickets t ${whereSql}`, whereParams)
  const total = Number((countRows as Array<{ total: number }>)[0]?.total ?? 0)

  const [rows] = await db.query(
    `SELECT t.id, t.minecraft_nick, t.subject, t.status, t.created_at, t.last_message_at,
            (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
     FROM support_tickets t
     ${whereSql}
     ORDER BY (t.status = 'open') DESC, t.last_message_at DESC
     LIMIT ? OFFSET ?`,
    [...whereParams, pageSize, offset],
  )

  // Сводка по статусам (для бейджей вкладок).
  const [countsRows] = await db.query('SELECT status, COUNT(*) AS c FROM support_tickets GROUP BY status')
  const counts: Record<string, number> = { open: 0, answered: 0, closed: 0 }
  for (const r of countsRows as Array<{ status: string; c: number }>) counts[r.status] = Number(r.c)

  return NextResponse.json({
    tickets: rows,
    counts,
    page,
    pageSize,
    total,
    hasMore: offset + (rows as unknown[]).length < total,
  })
}
