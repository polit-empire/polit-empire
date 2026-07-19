import mysql from "mysql2/promise"

let rawPool: mysql.Pool | null = null
let proxyPool: mysql.Pool | null = null
let readyPromise: Promise<void> | null = null

/**
 * Raw connection pool WITHOUT the migration guard.
 * Used only by lib/schema.ts to run the migration itself.
 */
export function getRawDb(): mysql.Pool {
  if (!rawPool) {
    rawPool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: "utf8mb4",
    })
  }
  return rawPool
}

/**
 * Lazily runs the schema migration exactly once per process.
 * Any query issued through getDb() waits for it to finish first,
 * so tables are guaranteed to exist before application queries run.
 */
function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = import("./schema")
      .then((m) => m.ensureSchema())
      .catch((err) => {
        // Allow a retry on the next query instead of caching the failure.
        readyPromise = null
        throw err
      })
  }
  return readyPromise
}

/**
 * Application-facing pool: query/execute wait for the migration first.
 */
export function getDb(): mysql.Pool {
  if (!proxyPool) {
    const target = getRawDb()
    proxyPool = new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop === "query" || prop === "execute") {
          return async (...args: unknown[]) => {
            await ensureReady()
            // @ts-expect-error - dynamic dispatch of query/execute
            return obj[prop](...args)
          }
        }
        return Reflect.get(obj, prop, receiver)
      },
    }) as mysql.Pool
  }
  return proxyPool
}

export interface UserRow {
  minecraft_nick: string
  password_hash: string | null
  is_banned: number
  ban_reason: string | null
  api_token: string | null
  telegram_id: number | null
  created_at: Date | null
  last_login: Date | null
}

export async function findUserByNick(nick: string): Promise<UserRow | null> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM users WHERE minecraft_nick = ? LIMIT 1", [nick])
  const list = rows as UserRow[]
  return list.length > 0 ? list[0] : null
}

export async function findUserByApiTokenHash(tokenHash: string): Promise<UserRow | null> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM users WHERE api_token = ? LIMIT 1", [tokenHash])
  const list = rows as UserRow[]
  return list.length > 0 ? list[0] : null
}

/** Adds an admin-panel notification (e.g. new registration). Never throws. */
export async function createNotification(type: string, title: string, body?: string): Promise<void> {
  try {
    const db = getDb()
    await db.query("INSERT INTO notifications (type, title, body) VALUES (?, ?, ?)", [type, title, body ?? null])
  } catch (err) {
    console.error("[notifications] failed to create:", err)
  }
}
