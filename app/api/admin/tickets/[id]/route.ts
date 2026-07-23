import { NextResponse } from 'next/server'
import { getAdminUser } from '@/lib/admin'
import { getDb } from '@/lib/db'
import { sendTelegramMessage } from '@/lib/telegram'
import { logAdminAction, clientIp } from '@/lib/audit'
import {
  MAX_BODY_LEN,
  addTicketMessage,
  deleteAttachments,
  getTicket,
  listTicketMessages,
  parseFormImage,
  saveAttachment,
  setMessageAttachment,
  type TicketStatus,
} from '@/lib/support'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Отправляет игроку уведомление в Telegram (если привязан). Не бросает. */
async function notifyOwner(nick: string, text: string): Promise<void> {
  try {
    const db = getDb()
    const [rows] = await db.query('SELECT telegram_id FROM users WHERE minecraft_nick = ? LIMIT 1', [nick])
    const tg = (rows as Array<{ telegram_id: number | null }>)[0]?.telegram_id
    if (tg) await sendTelegramMessage(tg, text)
  } catch {
    // уведомление не критично
  }
}

/** GET — тикет + переписка. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Некорректный тикет' }, { status: 400 })
  }
  const ticket = await getTicket(ticketId)
  if (!ticket) return NextResponse.json({ error: 'Тикет не найден' }, { status: 404 })
  const messages = await listTicketMessages(ticketId)
  return NextResponse.json({ ticket, messages })
}

/** POST — ответ администратора (multipart: body, image?). Переводит в 'answered'. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Некорректный тикет' }, { status: 400 })
  }
  const ticket = await getTicket(ticketId)
  if (!ticket) return NextResponse.json({ error: 'Тикет не найден' }, { status: 404 })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const body = String(form.get('body') ?? '').trim()
  const image = await parseFormImage(form.get('image'))
  if (image && !image.ok) {
    return NextResponse.json({ error: image.error }, { status: 400 })
  }
  if (body.length === 0 && !(image && image.ok)) {
    return NextResponse.json({ error: 'Введите сообщение или приложите файл' }, { status: 400 })
  }
  if (body.length > MAX_BODY_LEN) {
    return NextResponse.json({ error: 'Сообщение слишком длинное' }, { status: 400 })
  }

  const messageId = await addTicketMessage({
    ticketId,
    authorNick: admin.minecraft_nick,
    isAdmin: true,
    body,
    attachmentMime: image && image.ok ? image.mime : null,
    attachmentExt: image && image.ok ? image.ext : null,
  })
  if (image && image.ok && !saveAttachment(messageId, image.buf, image.ext)) {
    await setMessageAttachment(messageId, '', '').catch(() => {})
  }

  await logAdminAction({
    adminNick: admin.minecraft_nick,
    action: 'ticket_reply',
    targetNick: ticket.minecraft_nick,
    detail: `Ответ в тикете #${ticketId} «${ticket.subject}»`,
    ip: clientIp(request),
  })
  void notifyOwner(
    ticket.minecraft_nick,
    `📩 <b>Ответ поддержки по тикету #${ticketId}</b>\n${ticket.subject}\n\nОткрой личный кабинет на сайте, чтобы прочитать.`,
  )

  return NextResponse.json({ ok: true })
}

/** PATCH — сменить статус (open | closed). answered ставится ответом админа. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Некорректный тикет' }, { status: 400 })
  }
  const ticket = await getTicket(ticketId)
  if (!ticket) return NextResponse.json({ error: 'Тикет не найден' }, { status: 404 })

  const b = await request.json().catch(() => null)
  const status = b?.status as TicketStatus | undefined
  if (status !== 'open' && status !== 'closed') {
    return NextResponse.json({ error: 'Допустимо: open или closed' }, { status: 400 })
  }

  const db = getDb()
  await db.query('UPDATE support_tickets SET status = ? WHERE id = ?', [status, ticketId])

  await logAdminAction({
    adminNick: admin.minecraft_nick,
    action: status === 'closed' ? 'ticket_close' : 'ticket_reopen',
    targetNick: ticket.minecraft_nick,
    detail: `${status === 'closed' ? 'Закрыт' : 'Открыт'} тикет #${ticketId} «${ticket.subject}»`,
    ip: clientIp(request),
  })

  return NextResponse.json({ ok: true, status })
}

/** DELETE — полностью удалить тикет, его сообщения и файлы-вложения. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const ticketId = Number((await params).id)
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return NextResponse.json({ error: 'Некорректный тикет' }, { status: 400 })
  }
  const ticket = await getTicket(ticketId)
  if (!ticket) return NextResponse.json({ error: 'Тикет не найден' }, { status: 404 })

  // Сначала удаляем файлы-вложения, затем строки БД.
  const messages = await listTicketMessages(ticketId)
  deleteAttachments(messages)

  const db = getDb()
  await db.query('DELETE FROM support_messages WHERE ticket_id = ?', [ticketId])
  await db.query('DELETE FROM support_tickets WHERE id = ?', [ticketId])

  await logAdminAction({
    adminNick: admin.minecraft_nick,
    action: 'ticket_delete',
    targetNick: ticket.minecraft_nick,
    detail: `Удалён тикет #${ticketId} «${ticket.subject}»`,
    ip: clientIp(request),
  })

  return NextResponse.json({ ok: true })
}
