import { getDb } from "@/lib/db"

/**
 * Отправка уведомлений администраторам в Telegram.
 * Использует тот же бот-токен, что и Python-бот (TG_BOT_TOKEN), и тот же
 * список админов: переменная ADMIN_TELEGRAM_IDS (через запятую) + таблица
 * bot_admins. Никогда не бросает исключения — сбой уведомления не должен
 * ломать оформление заказа.
 */

function envAdminIds(): string[] {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
}

async function dbAdminIds(): Promise<string[]> {
  try {
    const db = getDb()
    const [rows] = await db.query("SELECT telegram_id FROM bot_admins")
    return (rows as Array<{ telegram_id: number | string }>)
      .map((r) => String(r.telegram_id))
      .filter((s) => /^\d+$/.test(s))
  } catch {
    return []
  }
}

/** Все telegram_id администраторов (уникальные). */
async function adminChatIds(): Promise<string[]> {
  const ids = new Set<string>([...envAdminIds(), ...(await dbAdminIds())])
  return [...ids]
}

/** Отправляет текстовое сообщение всем администраторам. Ошибки проглатываются. */
export async function notifyAdmins(text: string): Promise<void> {
  const token = process.env.TG_BOT_TOKEN
  if (!token) {
    console.warn("[telegram] TG_BOT_TOKEN не задан — уведомление пропущено")
    return
  }
  let chatIds: string[]
  try {
    chatIds = await adminChatIds()
  } catch {
    chatIds = envAdminIds()
  }
  if (chatIds.length === 0) return

  await Promise.allSettled(
    chatIds.map((chatId) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }).catch((err) => {
        console.error("[telegram] sendMessage failed:", err)
      }),
    ),
  )
}

/** Отправляет одно сообщение конкретному пользователю. Ошибки проглатываются. */
export async function sendTelegramMessage(chatId: number | string, text: string): Promise<boolean> {
  const token = process.env.TG_BOT_TOKEN
  if (!token) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch (err) {
    console.error("[telegram] sendTelegramMessage failed:", err)
    return false
  }
}

/**
 * Рассылка всем пользователям бота: игрокам с привязанным telegram_id,
 * которые не забанены. Совпадает с логикой рассылки самого бота.
 * Возвращает счётчики доставки.
 */
export async function broadcastToBotUsers(text: string): Promise<{ sent: number; failed: number }> {
  const token = process.env.TG_BOT_TOKEN
  if (!token) return { sent: 0, failed: 0 }

  let ids: string[] = []
  try {
    const db = getDb()
    const [rows] = await db.query(
      "SELECT DISTINCT telegram_id FROM users WHERE telegram_id IS NOT NULL AND is_banned = 0",
    )
    ids = (rows as Array<{ telegram_id: number | string }>)
      .map((r) => String(r.telegram_id))
      .filter((s) => /^\d+$/.test(s))
  } catch (err) {
    console.error("[telegram] broadcast: failed to load recipients:", err)
    return { sent: 0, failed: 0 }
  }
  if (ids.length === 0) return { sent: 0, failed: 0 }

  let sent = 0
  let failed = 0
  // Telegram лимитирует ~30 сообщений/сек; шлём небольшими партиями.
  const BATCH = 25
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const results = await Promise.allSettled(batch.map((id) => sendTelegramMessage(id, text)))
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) sent++
      else failed++
    }
    if (i + BATCH < ids.length) await new Promise((res) => setTimeout(res, 1100))
  }
  return { sent, failed }
}
