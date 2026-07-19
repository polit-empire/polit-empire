import { getDb, type UserRow } from "@/lib/db"
import { getSessionUser } from "@/lib/session"

/**
 * Определение администратора сайта. Источники (любой даёт права):
 *  - ник в ADMIN_NICKS (через запятую)
 *  - telegram_id в ADMIN_TELEGRAM_IDS (через запятую) — тот же список, что у бота
 *  - telegram_id есть в таблице bot_admins (управляется Telegram-ботом)
 */

function envSet(name: string): Set<string> {
  return new Set(
    (process.env[name] || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  )
}

export async function isAdminUser(user: UserRow | null): Promise<boolean> {
  if (!user) return false

  const adminNicks = envSet("ADMIN_NICKS")
  if (adminNicks.has(user.minecraft_nick.toLowerCase())) return true

  if (user.telegram_id != null) {
    const adminTgIds = envSet("ADMIN_TELEGRAM_IDS")
    if (adminTgIds.has(String(user.telegram_id))) return true
    try {
      const db = getDb()
      const [rows] = await db.query("SELECT 1 FROM bot_admins WHERE telegram_id = ? LIMIT 1", [user.telegram_id])
      if ((rows as unknown[]).length > 0) return true
    } catch {
      // Таблица bot_admins создаётся ботом; при её отсутствии просто игнорируем.
    }
  }
  return false
}

/** Возвращает игрока сессии, если он админ, иначе null. */
export async function getAdminUser(): Promise<UserRow | null> {
  const user = await getSessionUser()
  if (!user) return null
  return (await isAdminUser(user)) ? user : null
}
