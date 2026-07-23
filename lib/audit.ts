import { getDb } from "@/lib/db"

/**
 * Аудит-логирование действий в админ-панели и событий аккаунтов.
 *
 * Все функции здесь «fire-and-forget»: они НИКОГДА не бросают исключение и не
 * ломают основной запрос (бан игрока, вход в лаунчер и т.п.). Если запись в лог
 * не удалась — это логируется в консоль сервера, но пользователю ошибка не
 * возвращается. Логи — вспомогательная функция, они не должны блокировать
 * бизнес-действие.
 */

/** IP клиента с учётом прокси (Cloudflare / nginx перед приложением). */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first.slice(0, 45)
  }
  const real = req.headers.get("x-real-ip")?.trim()
  return real ? real.slice(0, 45) : null
}

/**
 * Версия лаунчера из User-Agent. Лаунчер шлёт UA вида
 * "PolitEmpireLauncher/2.0.0 (...)" — вытаскиваем номер версии, если он есть.
 */
export function launcherVersionFromReq(req: Request): string | null {
  const ua = req.headers.get("user-agent") || ""
  const m = ua.match(/PolitEmpire[^/]*\/([0-9][\w.\-]*)/i)
  return m ? m[1].slice(0, 32) : null
}

/** Записывает действие администратора в admin_logs. Не бросает. */
export async function logAdminAction(entry: {
  adminNick: string
  action: string
  targetNick?: string | null
  detail?: string | null
  ip?: string | null
}): Promise<void> {
  try {
    const db = getDb()
    await db.query(
      `INSERT INTO admin_logs (admin_nick, action, target_nick, detail, ip)
       VALUES (?, ?, ?, ?, ?)`,
      [
        entry.adminNick.slice(0, 32),
        entry.action.slice(0, 48),
        entry.targetNick ? entry.targetNick.slice(0, 32) : null,
        entry.detail ? entry.detail.slice(0, 1024) : null,
        entry.ip ?? null,
      ],
    )
  } catch (err) {
    console.error("[audit] logAdminAction failed:", err)
  }
}

/** Записывает событие аккаунта (вход в лаунчер / ЛК и т.п.) в account_events. Не бросает. */
export async function logAccountEvent(entry: {
  eventType: string
  nick?: string | null
  ip?: string | null
  hwid?: string | null
  launcherVersion?: string | null
  detail?: string | null
}): Promise<void> {
  try {
    const db = getDb()
    await db.query(
      `INSERT INTO account_events (event_type, minecraft_nick, ip, hwid, launcher_version, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.eventType.slice(0, 32),
        entry.nick ? entry.nick.slice(0, 32) : null,
        entry.ip ?? null,
        entry.hwid ? entry.hwid.slice(0, 64) : null,
        entry.launcherVersion ? entry.launcherVersion.slice(0, 32) : null,
        entry.detail ? entry.detail.slice(0, 512) : null,
      ],
    )
  } catch (err) {
    console.error("[audit] logAccountEvent failed:", err)
  }
}
