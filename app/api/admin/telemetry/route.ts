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
 *  section=anticheat  — события античита (anticheat_events), фильтр ?nick=
 *  section=errors     — ошибки лаунчера/игры (telemetry, error-типы), ?nick=
 *  section=logs       — live-логи (launcher_logs), ?nick= обязателен, ?after=<id>
 *  section=players    — список ников для выбора (кто присылал телеметрию)
 */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const section = url.searchParams.get("section") ?? "anticheat"
  const nick = url.searchParams.get("nick")?.trim() || ""
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
      if (nick) {
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
      if (nick) {
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
      if (!nick) return NextResponse.json({ error: "нужен nick" }, { status: 400 })
      const after = Number(url.searchParams.get("after") || 0)
      if (after > 0) {
        // Инкрементальная подгрузка новых строк по курсору.
        const [rows] = await db.query(
          `SELECT id, session, level, source, line, created_at
           FROM launcher_logs
           WHERE minecraft_nick = ? AND id > ?
           ORDER BY id ASC LIMIT 500`,
          [nick, after],
        )
        return NextResponse.json({ lines: rows })
      }
      // Хвост: последние 400 строк в хронологическом порядке.
      const [rows] = await db.query(
        `SELECT id, session, level, source, line, created_at FROM (
           SELECT id, session, level, source, line, created_at
           FROM launcher_logs
           WHERE minecraft_nick = ?
           ORDER BY id DESC LIMIT 400
         ) AS tail ORDER BY id ASC`,
        [nick],
      )
      return NextResponse.json({ lines: rows })
    }

    return NextResponse.json({ error: "неизвестная секция" }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
