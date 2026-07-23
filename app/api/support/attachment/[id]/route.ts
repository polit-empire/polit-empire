import fs from 'fs'
import { getSessionUser } from '@/lib/session'
import { isAdminUser } from '@/lib/admin'
import { getDb } from '@/lib/db'
import { attachmentFilePath } from '@/lib/support'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/support/attachment/[id]
 * Отдаёт скриншот-вложение сообщения тикета. Доступ приватный: только автор
 * тикета (владелец) или администратор. id — id сообщения (support_messages).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const messageId = Number(String(id).replace(/\.(png|jpg|jpeg|webp|gif)$/i, ''))
  if (!Number.isInteger(messageId) || messageId <= 0) {
    return Response.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const db = getDb()
  const [rows] = await db.query(
    `SELECT m.attachment_mime, m.attachment_ext, t.minecraft_nick
     FROM support_messages m
     JOIN support_tickets t ON t.id = m.ticket_id
     WHERE m.id = ? LIMIT 1`,
    [messageId],
  )
  const row = (
    rows as Array<{ attachment_mime: string | null; attachment_ext: string | null; minecraft_nick: string }>
  )[0]
  if (!row || !row.attachment_ext || !row.attachment_mime) {
    return Response.json({ error: 'Вложение не найдено' }, { status: 404 })
  }

  // Доступ: владелец тикета либо администратор.
  const isOwner = row.minecraft_nick === user.minecraft_nick
  if (!isOwner && !(await isAdminUser(user))) {
    return Response.json({ error: 'Нет доступа' }, { status: 403 })
  }

  const file = attachmentFilePath(messageId, row.attachment_ext)
  if (!fs.existsSync(file)) {
    return Response.json({ error: 'Файл не найден' }, { status: 404 })
  }

  const data = fs.readFileSync(file)
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': row.attachment_mime,
      'Content-Length': String(data.length),
      // Приватное вложение — не кэшируем у посредников.
      'Cache-Control': 'private, max-age=30',
    },
  })
}
