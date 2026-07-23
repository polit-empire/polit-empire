import fs from 'fs'
import path from 'path'
import { getDb } from '@/lib/db'

/**
 * Тикеты поддержки: типы, файловое хранилище вложений и запросы к БД.
 *
 * Вложения (скриншоты) хранятся на диске так же, как скины (см.
 * app/api/skin): {STORAGE_DIR}/ticket-attachments/{messageId}.{ext}. В БД —
 * только mime и расширение; сам файл отдаётся через /api/support/attachment/[id]
 * с проверкой доступа (владелец тикета или админ).
 */

export type TicketStatus = 'open' | 'answered' | 'closed'

export interface TicketRow {
  id: number
  minecraft_nick: string
  subject: string
  status: TicketStatus
  created_at: string
  updated_at: string
  last_message_at: string
}

export interface TicketMessageRow {
  id: number
  ticket_id: number
  author_nick: string
  is_admin: number
  body: string | null
  attachment_mime: string | null
  attachment_ext: string | null
  created_at: string
}

/** Лимит размера вложения (4 МБ) и допустимые форматы изображений. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const MAX_SUBJECT_LEN = 160
export const MAX_BODY_LEN = 4000

/** Каталог для файлов-вложений тикетов (рядом со скинами, под STORAGE_DIR). */
export function attachmentsDir(): string {
  return path.join(process.env.STORAGE_DIR || '/opt/polit-empire/sborka', 'ticket-attachments')
}

export function attachmentFilePath(messageId: number, ext: string): string {
  return path.join(attachmentsDir(), `${messageId}.${ext}`)
}

/**
 * Определяет тип изображения по «магическим» байтам (без доверия к заголовку
 * Content-Type от клиента). Возвращает mime+ext или null, если это не
 * поддерживаемое изображение (PNG / JPEG / WebP / GIF).
 */
export function detectImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' }
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { mime: 'image/gif', ext: 'gif' }
  }
  // WebP: "RIFF"???? "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}

/** Результат разбора загруженного изображения из multipart-формы. */
export type ParsedAttachment =
  | { ok: true; buf: Buffer; mime: string; ext: string }
  | { ok: false; error: string }
  | null

/**
 * Извлекает изображение из поля формы. Возвращает:
 *  • null — файла нет (поле пустое);
 *  • { ok: false, error } — файл есть, но слишком большой или не изображение;
 *  • { ok: true, ... } — валидное изображение (mime/ext по магическим байтам).
 */
export async function parseFormImage(value: FormDataEntryValue | null): Promise<ParsedAttachment> {
  if (!value || typeof value === 'string') return null
  const file = value as File
  if (file.size === 0) return null
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'Файл больше 4 МБ' }
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const kind = detectImage(buf)
  if (!kind) {
    return { ok: false, error: 'Поддерживаются только изображения (PNG, JPEG, WebP, GIF)' }
  }
  return { ok: true, buf, mime: kind.mime, ext: kind.ext }
}

/** Сохраняет вложение на диск. Никогда не бросает (ошибка = вложение пропущено). */
export function saveAttachment(messageId: number, buf: Buffer, ext: string): boolean {
  try {
    const dir = attachmentsDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(attachmentFilePath(messageId, ext), buf)
    return true
  } catch (err) {
    console.error('[support] saveAttachment failed:', err)
    return false
  }
}

/** Удаляет файлы-вложения указанных сообщений (best-effort). */
export function deleteAttachments(messages: Array<{ id: number; attachment_ext: string | null }>): void {
  for (const m of messages) {
    if (!m.attachment_ext) continue
    try {
      fs.rmSync(attachmentFilePath(m.id, m.attachment_ext), { force: true })
    } catch {
      // файл мог не существовать — не критично
    }
  }
}

/* ------------------------------------------------------------------ */
/* Запросы к БД                                                        */
/* ------------------------------------------------------------------ */

/** Тикет по id (или null). */
export async function getTicket(id: number): Promise<TicketRow | null> {
  const db = getDb()
  const [rows] = await db.query('SELECT * FROM support_tickets WHERE id = ? LIMIT 1', [id])
  const list = rows as TicketRow[]
  return list.length > 0 ? list[0] : null
}

/** Все сообщения тикета в хронологическом порядке. */
export async function listTicketMessages(ticketId: number): Promise<TicketMessageRow[]> {
  const db = getDb()
  const [rows] = await db.query(
    'SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY id ASC',
    [ticketId],
  )
  return rows as TicketMessageRow[]
}

/**
 * Добавляет сообщение в тикет и обновляет его статус/время. Возвращает id
 * созданного сообщения (вложение сохраняется вызывающим кодом по этому id).
 *  • сообщение игрока (isAdmin=false)  → статус 'open'   (ждёт админа)
 *  • сообщение админа (isAdmin=true)   → статус 'answered' (ждёт игрока)
 */
export async function addTicketMessage(opts: {
  ticketId: number
  authorNick: string
  isAdmin: boolean
  body: string
  attachmentMime?: string | null
  attachmentExt?: string | null
}): Promise<number> {
  const db = getDb()
  const [res] = await db.query(
    `INSERT INTO support_messages (ticket_id, author_nick, is_admin, body, attachment_mime, attachment_ext)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      opts.ticketId,
      opts.authorNick,
      opts.isAdmin ? 1 : 0,
      opts.body || null,
      opts.attachmentMime ?? null,
      opts.attachmentExt ?? null,
    ],
  )
  const messageId = (res as { insertId: number }).insertId
  await db.query(
    'UPDATE support_tickets SET status = ?, last_message_at = NOW() WHERE id = ?',
    [opts.isAdmin ? 'answered' : 'open', opts.ticketId],
  )
  return messageId
}

/** Привязывает сохранённое вложение к сообщению (после записи файла на диск). */
export async function setMessageAttachment(
  messageId: number,
  mime: string,
  ext: string,
): Promise<void> {
  const db = getDb()
  await db.query(
    'UPDATE support_messages SET attachment_mime = ?, attachment_ext = ? WHERE id = ?',
    [mime, ext, messageId],
  )
}
