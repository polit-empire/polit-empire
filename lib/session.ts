import { cookies } from "next/headers"
import { getDb, type UserRow } from "@/lib/db"
import { generateApiToken, sha256 } from "@/lib/tokens"

/**
 * Сессии личного кабинета. Вход — по нику+паролю (как в лаунчере).
 * Cookie `pe_session` хранит сырой токен, в БД лежит только его sha256.
 */

export const SESSION_COOKIE = "pe_session"
const SESSION_TTL_DAYS = 30

/** Создаёт сессию для игрока и ставит httpOnly-cookie. Возвращает сырой токен. */
export async function createSession(nick: string): Promise<string> {
  const raw = generateApiToken()
  const hash = sha256(raw)
  const db = getDb()
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000)
  await db.query("INSERT INTO web_sessions (token, minecraft_nick, expires_at) VALUES (?, ?, ?)", [
    hash,
    nick,
    expires,
  ])
  const store = await cookies()
  store.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  })
  return raw
}

/** Удаляет текущую сессию (logout). */
export async function destroySession(): Promise<void> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (raw) {
    try {
      const db = getDb()
      await db.query("DELETE FROM web_sessions WHERE token = ?", [sha256(raw)])
    } catch {
      /* ignore */
    }
  }
  store.delete(SESSION_COOKIE)
}

/** Возвращает игрока текущей сессии или null. Чистит просроченные сессии. */
export async function getSessionUser(): Promise<UserRow | null> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (!raw || raw.length < 32) return null
  const db = getDb()
  const [rows] = await db.query(
    `SELECT u.* FROM web_sessions s
     JOIN users u ON u.minecraft_nick = s.minecraft_nick
     WHERE s.token = ? AND s.expires_at > NOW() LIMIT 1`,
    [sha256(raw)],
  )
  const list = rows as UserRow[]
  return list.length > 0 ? list[0] : null
}
