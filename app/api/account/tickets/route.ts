import { getSessionUser } from '@/lib/session'
import { getDb } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { notifyAdmins } from '@/lib/telegram'
import {
  MAX_BODY_LEN,
  MAX_SUBJECT_LEN,
  addTicketMessage,
  parseFormImage,
  saveAttachment,
  setMessageAttachment,
  type TicketRow,
} from '@/lib/support'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET  /api/account/tickets — список тикетов текущего игрока (свежие сверху).
 * POST /api/account/tickets — создать тикет (multipart: subject, body, image?).
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'Не авторизован' }, { status: 401 })

  const db = getDb()
  const [rows] = await db.query(
    `SELECT t.id, t.subject, t.status, t.created_at, t.last_message_at,
            (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
     FROM support_tickets t
     WHERE t.minecraft_nick = ?
     ORDER BY t.last_message_at DESC
     LIMIT 100`,
    [user.minecraft_nick],
  )
  return Response.json({ tickets: rows })
}

export async function POST(request: Request) {
  const limited = checkRateLimit(request, 'ticket-create', 10, 60_000)
  if (limited) return limited

  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'Не авторизован' }, { status: 401 })
  if (user.is_banned === 1) {
    return Response.json({ error: 'Аккаунт заблокирован' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const subject = String(form.get('subject') ?? '').trim()
  const body = String(form.get('body') ?? '').trim()
  if (subject.length < 3 || subject.length > MAX_SUBJECT_LEN) {
    return Response.json({ error: 'Тема: от 3 до 160 символов' }, { status: 400 })
  }
  if (body.length < 5 || body.length > MAX_BODY_LEN) {
    return Response.json({ error: 'Опишите проблему подробнее (5–4000 символов)' }, { status: 400 })
  }

  const image = await parseFormImage(form.get('image'))
  if (image && !image.ok) {
    return Response.json({ error: image.error }, { status: 400 })
  }

  // Ограничим число открытых тикетов на игрока, чтобы не спамили.
  const db = getDb()
  const [openRows] = await db.query(
    "SELECT COUNT(*) AS c FROM support_tickets WHERE minecraft_nick = ? AND status <> 'closed'",
    [user.minecraft_nick],
  )
  if (Number((openRows as Array<{ c: number }>)[0]?.c ?? 0) >= 10) {
    return Response.json(
      { error: 'Слишком много открытых тикетов. Дождитесь ответа по текущим.' },
      { status: 429 },
    )
  }

  const [res] = await db.query(
    'INSERT INTO support_tickets (minecraft_nick, subject, status) VALUES (?, ?, ?)',
    [user.minecraft_nick, subject, 'open'],
  )
  const ticketId = (res as { insertId: number }).insertId

  const messageId = await addTicketMessage({
    ticketId,
    authorNick: user.minecraft_nick,
    isAdmin: false,
    body,
    attachmentMime: image && image.ok ? image.mime : null,
    attachmentExt: image && image.ok ? image.ext : null,
  })

  if (image && image.ok) {
    const stored = saveAttachment(messageId, image.buf, image.ext)
    if (!stored) {
      // Файл не сохранился — снимаем ссылку на вложение, но тикет оставляем.
      await setMessageAttachment(messageId, '', '').catch(() => {})
      await db
        .query('UPDATE support_messages SET attachment_mime = NULL, attachment_ext = NULL WHERE id = ?', [messageId])
        .catch(() => {})
    }
  }

  void notifyAdmins(
    `🆘 <b>Новый тикет #${ticketId}</b>\nИгрок: <code>${user.minecraft_nick}</code>\nТема: ${subject}`,
  )

  return Response.json({ ok: true, id: ticketId } satisfies { ok: true; id: number } & Partial<TicketRow>)
}
