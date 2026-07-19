import crypto from "crypto"
import { getDb } from "@/lib/db"
import { rconExec, isRconConfigured } from "@/lib/rcon"
import { sendTelegramMessage } from "@/lib/telegram"

/**
 * Единая логика банов на сайте — паритет с Telegram-ботом (services/bans.py):
 *  - бан аккаунта: users.is_banned + RCON ban/kick + уведомление в TG;
 *  - бан по «сырому» значению (HWID / UUID / IP): заносим в чёрный список и
 *    каскадно баним связанные аккаунты;
 *  - опция ban+device: дополнительно блокируем устройство игрока (last_hwid).
 */

export type BanKind = "hwid" | "uuid" | "ip"

const BAN_TABLES: Record<BanKind, { table: string; col: string }> = {
  hwid: { table: "banned_hwids", col: "hwid" },
  uuid: { table: "banned_uuids", col: "uuid" },
  ip: { table: "banned_ips", col: "ip" },
}

/** Детерминированный offline-UUID Minecraft по нику (как в боте и на сервере). */
export function offlineUuid(nick: string): string {
  const h = crypto.createHash("md5").update(`OfflinePlayer:${nick}`).digest()
  h[6] = (h[6] & 0x0f) | 0x30 // версия 3
  h[8] = (h[8] & 0x3f) | 0x80 // variant
  const x = h.toString("hex")
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}

async function rconSafe(commands: string[]): Promise<void> {
  if (!isRconConfigured()) return
  try {
    await rconExec(commands)
  } catch {
    // Сервер офлайн — БД-бан всё равно применён.
  }
}

async function notifyPlayer(nick: string, text: string): Promise<void> {
  try {
    const db = getDb()
    const [rows] = await db.query("SELECT telegram_id FROM users WHERE minecraft_nick = ? LIMIT 1", [nick])
    const tg = (rows as Array<{ telegram_id: number | null }>)[0]?.telegram_id
    if (tg) await sendTelegramMessage(tg, text)
  } catch {
    // уведомление не критично
  }
}

/**
 * Полный бан аккаунта: БД + сервер (ban+kick) + TG-уведомление.
 * withHwid=true — дополнительно банит устройство игрока (last_hwid).
 */
export async function banAccount(
  nick: string,
  reason: string,
  opts: { withHwid?: boolean } = {},
): Promise<void> {
  const db = getDb()
  reason = reason || "Нарушение правил"

  const [rows] = await db.query(
    "SELECT last_hwid FROM users WHERE minecraft_nick = ? LIMIT 1",
    [nick],
  )
  const lastHwid = (rows as Array<{ last_hwid: string | null }>)[0]?.last_hwid ?? null

  await db.query("UPDATE users SET is_banned = 1, ban_reason = ? WHERE minecraft_nick = ?", [reason, nick])

  if (opts.withHwid && lastHwid) {
    await db.query(
      "INSERT INTO banned_hwids (hwid, mc_username, reason) VALUES (?, ?, ?) " +
        "ON DUPLICATE KEY UPDATE reason = VALUES(reason), mc_username = VALUES(mc_username)",
      [lastHwid, nick, reason],
    )
  }

  await rconSafe([`ban ${nick} ${reason}`, `kick ${nick} Вы заблокированы: ${reason}`])
  await notifyPlayer(nick, `⛔️ Ваш аккаунт <b>${nick}</b> заблокирован.\nПричина: ${reason}`)
}

/** Полный разбан аккаунта: БД + pardon + снятие бана устройства + TG. */
export async function unbanAccount(nick: string): Promise<void> {
  const db = getDb()
  await db.query("UPDATE users SET is_banned = 0, ban_reason = NULL WHERE minecraft_nick = ?", [nick])
  await db.query("DELETE FROM banned_hwids WHERE mc_username = ?", [nick])
  await rconSafe([`pardon ${nick}`])
  await notifyPlayer(nick, `✅ Ваш аккаунт <b>${nick}</b> разблокирован.`)
}

/** Ники аккаунтов, связанных со значением (для каскадного бана). */
async function accountsForValue(kind: BanKind, value: string): Promise<string[]> {
  const db = getDb()
  if (kind === "hwid") {
    const [rows] = await db.query("SELECT minecraft_nick FROM users WHERE last_hwid = ?", [value])
    return (rows as Array<{ minecraft_nick: string }>).map((r) => r.minecraft_nick)
  }
  if (kind === "ip") {
    const [rows] = await db.query("SELECT minecraft_nick FROM users WHERE last_ip = ?", [value])
    return (rows as Array<{ minecraft_nick: string }>).map((r) => r.minecraft_nick)
  }
  // uuid — сверяем offline-UUID по всем игрокам
  const target = value.toLowerCase()
  const [rows] = await db.query("SELECT minecraft_nick FROM users")
  return (rows as Array<{ minecraft_nick: string }>)
    .map((r) => r.minecraft_nick)
    .filter((n) => offlineUuid(n) === target)
}

/**
 * Бан по «сырому» значению (HWID / UUID / IP): заносит в чёрный список и
 * каскадно банит связанные аккаунты. Возвращает список забаненных ников.
 */
export async function banValue(kind: BanKind, rawValue: string, reason: string): Promise<string[]> {
  const db = getDb()
  const { table, col } = BAN_TABLES[kind]
  const value = rawValue.trim()
  reason = reason || "Причина не указана"

  const nicks = await accountsForValue(kind, value)
  const primary = nicks[0] ?? null

  await db.query(
    `INSERT INTO ${table} (${col}, mc_username, reason) VALUES (?, ?, ?) ` +
      "ON DUPLICATE KEY UPDATE reason = VALUES(reason), mc_username = VALUES(mc_username)",
    [value, primary, reason],
  )
  for (const nick of nicks) {
    await banAccount(nick, reason)
  }
  return nicks
}

/** Снимает бан по значению и разбанивает связанный аккаунт (если был). */
export async function unbanValue(kind: BanKind, rawValue: string): Promise<boolean> {
  const db = getDb()
  const { table, col } = BAN_TABLES[kind]
  const value = rawValue.trim()

  const [rows] = await db.query(`SELECT mc_username FROM ${table} WHERE ${col} = ? LIMIT 1`, [value])
  const found = (rows as Array<{ mc_username: string | null }>)[0]
  if (!found) return false

  await db.query(`DELETE FROM ${table} WHERE ${col} = ?`, [value])
  if (found.mc_username) await unbanAccount(found.mc_username)
  return true
}
