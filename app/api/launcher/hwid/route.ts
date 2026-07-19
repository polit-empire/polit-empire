import crypto from "crypto"
import { z } from "zod"
import { getDb } from "@/lib/db"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

const bodySchema = z.object({
  hwid: z.string().min(8).max(64),
})

/** Детерминированный offline-UUID по нику (как в /api/gml/auth). */
function offlineUuid(nick: string): string {
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${nick}`, "utf8").digest()
  hash[6] = (hash[6] & 0x0f) | 0x30 // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80 // variant
  const hex = hash.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Достаёт клиентский IP из заголовков прокси (nginx X-Forwarded-For / X-Real-IP). */
function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return request.headers.get("x-real-ip")?.trim() || null
}

/**
 * POST /api/launcher/hwid
 *
 * Лаунчер сообщает HWID устройства после успешного входа/проверки сессии
 * (Authorization: Bearer <token>, тело { hwid }).
 *
 * Сервер:
 *  1. запоминает last_hwid у аккаунта (нужно админам для бана по железу);
 *  2. проверяет HWID по таблице banned_hwids — если устройство забанено,
 *     аккаунт автоматически банится и лаунчер получает banned: true.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "launcher-hwid", 30, 60_000)
  if (limited) return limited

  const user = await authenticatePlayer(request)
  if (!user) return unauthorized()

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: "Invalid hwid" }, { status: 400 })
  }

  const { hwid } = parsed.data
  const db = getDb()

  const ip = clientIp(request)
  const uuid = offlineUuid(user.minecraft_nick)

  // Запоминаем последнее устройство и IP (нужно админам для банов по данным).
  await db.query("UPDATE users SET last_hwid = ?, last_ip = ? WHERE minecraft_nick = ?", [
    hwid,
    ip,
    user.minecraft_nick,
  ])

  // Проверяем все три чёрных списка: HWID устройства, UUID игрока и IP-адрес.
  // Совпадение по любому из них = блокировка (обход через новый аккаунт не работает).
  const [hwidRows] = await db.query("SELECT reason FROM banned_hwids WHERE hwid = ?", [hwid])
  const [uuidRows] = await db.query("SELECT reason FROM banned_uuids WHERE uuid = ?", [uuid])
  const [ipRows] = ip
    ? await db.query("SELECT reason FROM banned_ips WHERE ip = ?", [ip])
    : [[] as Array<{ reason: string | null }>]

  const hit =
    (hwidRows as Array<{ reason: string | null }>)[0] ||
    (uuidRows as Array<{ reason: string | null }>)[0] ||
    (ipRows as Array<{ reason: string | null }>)[0]

  if (hit) {
    const reason = hit.reason || "Заблокировано администрацией"
    // Совпадение с чёрным списком: автоматически баним и этот аккаунт.
    if (user.is_banned !== 1) {
      await db.query("UPDATE users SET is_banned = 1, ban_reason = ? WHERE minecraft_nick = ?", [
        reason,
        user.minecraft_nick,
      ])
      console.warn(`[security] blacklisted device/uuid/ip tried to log in as ${user.minecraft_nick}, account banned`)
    }
    return Response.json({ banned: true, reason })
  }

  return Response.json({ banned: false })
}
