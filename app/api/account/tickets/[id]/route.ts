import { getSessionUser } from '@/lib/session'
import { checkRateLimit } from '@/lib/rate-limit'
import { notifyAdmins } from '@/lib/telegram'
import {
  MAX_BODY_LEN,
  addTicketMessage,
  getTicket,
  listTicketMessages,
  parseFormImage,
  saveAttachment,
  setMessageAttachment,
} from '@/lib/support'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET  /api/account/tickets/[id] — тикет игрока + вся переписка.
 * POST /api/account/tickets/[id] — добавить ответ (multipart: body, image?).
 *   Ответ игрока переводит тикет в статус open (ждёт админа); если тикет был
 *   закрыт — он переоткрывается.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return Response.json({ error: 'Некорректный тикет' }, { status: 400 })
  }

  const ticket = await getTicket(ticketId)
  if (!ticket || ticket.minecraft_nick !== user.minecraft_nick) {
    return Response.json({ error: 'Тикет не найден' }, { status: 404 })
  }

  const messages = await listTicketMessages(ticketId)
  return Response.json({ ticket, messages })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = checkRateLimit(request, 'ticket-reply', 30, 60_000)
  if (limited) return limited

  const user = await getSessionUser()
  if (!user) return Response.json({ error: 'Не авторизован' }, { status: 401 })
  if (user.is_banned === 1) {
    return Response.json({ error: 'Аккаунт заблокирован' }, { status: 403 })
  }

  const { id } = await params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return Response.json({ error: 'Некорректный тикет' }, { status: 400 })
  }

  const ticket = await getTicket(ticketId)
  if (!ticket || ticket.minecraft_nick !== user.minecraft_nick) {
    return Response.json({ error: 'Тикет не найден' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const body = String(form.get('body') ?? '').trim()
  const image = await parseFormImage(form.get('image'))
  if (image && !image.ok) {
    return Response.json({ error: image.error }, { status: 400 })
  }
  if (body.length === 0 && !(image && image.ok)) {
    return Response.json({ error: 'Введите сообщение или приложите файл' }, { status: 400 })
  }
  if (body.length > MAX_BODY_LEN) {
    return Response.json({ error: 'Сообщение слишком длинное' }, { status: 400 })
  }

  const messageId = await addTicketMessage({
    ticketId,
    authorNick: user.minecraft_nick,
    isAdmin: false,
    body,
    attachmentMime: image && image.ok ? image.mime : null,
    attachmentExt: image && image.ok ? image.ext : null,
  })

  if (image && image.ok && !saveAttachment(messageId, image.buf, image.ext)) {
    await setMessageAttachment(messageId, '', '').catch(() => {})
  }

  void notifyAdmins(
    `💬 <b>Ответ игрока в тикете #${ticketId}</b>\nИгрок: <code>${user.minecraft_nick}</code>`,
  )

  return Response.json({ ok: true })
}
