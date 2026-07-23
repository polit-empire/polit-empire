import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Типы событий телеметрии, которые считаем «ошибками у игрока».
const ERROR_EVENTS = ["game_crash", "download_error", "auth_error", "error"]

/**
 * GET /api/admin/telemetry?section=...
 *
 *  section=anticheat  — события античита (anticheat_events)
 *  section=errors     — ошибки лаунчера/игры (telemetry, error-типы)
 *  section=logs       — live-логи (launcher_logs), ?after=<id> для докачки
 *  section=players    — список ников для выбора (кто присылал телеметрию)
 *
 * Поиск (как в разделе «Игроки»): параметр ?q= фильтрует по нику и связанным
 * полям через LIKE. Для обратной совместимости также принимается ?nick= (точное
 * совпадение). Пустой q в anticheat/errors — все события; в logs — последние
 * строки всех игроков.
 */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const section = url.searchParams.get("section") ?? "anticheat"
  const nick = url.searchParams.get("nick")?.trim() || ""
  const q = url.searchParams.get("q")?.trim() || ""
  const like = `%${q}%`
  const db = getDb()

  try {
    if (section === "players") {
      // Уникальные ники из всех источников телеметрии (последние активные).
      const [rows] = await db.query(
        `SELECT nick, MAX(ts) AS last_ts FROM (
           SELECT minecraft_nick AS nick, created_at AS ts FROM anticheat_events WHERE minecraft_nick IS NOT NULL
           UNION ALL
           SELECT minecraft_nick AS nick, created_at AS ts FROM telemetry WHERE minecraft_nick IS NOT NULL
           UNION ALL
           SELECT minecraft_nick AS nick, created_at AS ts FROM launcher_logs
           UNION ALL
           SELECT minecraft_nick AS nick, last_seen AS ts FROM launcher_heartbeats
         ) AS u
         GROUP BY nick ORDER BY last_ts DESC LIMIT 200`,
      )
      return NextResponse.json({ players: rows })
    }

    if (section === "anticheat") {
      const params: unknown[] = []
      let where = ""
      if (q) {
        // Поиск по нику, деталям, типу события и HWID.
        where =
          "WHERE minecraft_nick LIKE ? OR detail LIKE ? OR kind LIKE ? OR hwid LIKE ?"
        params.push(like, like, like, like)
      } else if (nick) {
        where = "WHERE minecraft_nick = ?"
        params.push(nick)
      }
      const [rows] = await db.query(
        `SELECT id, minecraft_nick, hwid, kind, detail, source, created_at
         FROM anticheat_events ${where}
         ORDER BY id DESC LIMIT 200`,
        params,
      )
      return NextResponse.json({ events: rows })
    }

    if (section === "errors") {
      const placeholders = ERROR_EVENTS.map(() => "?").join(",")
      const params: unknown[] = [...ERROR_EVENTS]
      let extra = ""
      if (q) {
        extra = "AND (minecraft_nick LIKE ? OR message LIKE ? OR event_type LIKE ?)"
        params.push(like, like, like)
      } else if (nick) {
        extra = "AND minecraft_nick = ?"
        params.push(nick)
      }
      const [rows] = await db.query(
        `SELECT id, event_type, minecraft_nick, launcher_version, os, java_version, message, created_at
         FROM telemetry
         WHERE event_type IN (${placeholders}) ${extra}
         ORDER BY id DESC LIMIT 200`,
        params,
      )
      return NextResponse.json({ events: rows })
    }

    if (section === "logs") {
      // Совместимость: если пришёл точный nick (старый dropdown) — используем его,
      // иначе строим фильтр по q (LIKE). Пустой запрос => последние строки всех.
      const search = q || nick
      const after = Number(url.searchParams.get("after") || 0)

      if (after > 0) {
        // Инкрементальная подгрузка новых строк по курсору.
        const params: unknown[] = [after]
        let filter = ""
        if (search) {
          filter = nick && !q ? "AND minecraft_nick = ?" : "AND minecraft_nick LIKE ?"
          params.push(nick && !q ? nick : `%${search}%`)
        }
        const [rows] = await db.query(
          `SELECT id, minecraft_nick, session, level, source, line, created_at
           FROM launcher_logs
           WHERE id > ? ${filter}
           ORDER BY id ASC LIMIT 500`,
          params,
        )
        return NextResponse.json({ lines: rows })
      }

      // Хвост: последние 400 строк в хронологическом порядке.
      const params: unknown[] = []
      let where = ""
      if (search) {
        where = nick && !q ? "WHERE minecraft_nick = ?" : "WHERE minecraft_nick LIKE ?"
        params.push(nick && !q ? nick : `%${search}%`)
      }
      const [rows] = await db.query(
        `SELECT id, minecraft_nick, session, level, source, line, created_at FROM (
           SELECT id, minecraft_nick, session, level, source, line, created_at
           FROM launcher_logs
           ${where}
           ORDER BY id DESC LIMIT 400
         ) AS tail ORDER BY id ASC`,
        params,
      )
      return NextResponse.json({ lines: rows })
    }

    return NextResponse.json({ error: "неизвестная секция" }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
