import { z } from "zod"
import { getDb } from "@/lib/db"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

const eventSchema = z.object({
  kind: z.string().min(1).max(64),
  detail: z.string().max(1024).optional().default(""),
  source: z.string().min(1).max(32).optional().default("dll"),
})

const bodySchema = z.object({
  hwid: z.string().max(64).optional().default(""),
  nickname: z.string().max(32).optional().default(""),
  session: z.string().max(64).optional().default(""),
  events: z.array(eventSchema).min(1).max(50),
})

// Серьёзные события = однозначное вмешательство в игру: засчитываются страйком
// и ведут к бану по железу. Соответствует is_severe() в лаунчере.
//  * injected_module   — неизвестный неподписанный код, загруженный в игру;
//  * cheat_module      — модуль из чёрного списка известных читов;
//  * module_tampered   — подмена доверенного модуля (DLL hijacking): тот же
//                        name, но другой путь/хэш, чем в baseline;
//  * debugger          — к процессу игры подключён отладчик;
//  * overlay_confirmed — подозрительный оверлей подтверждён несколько проходов
//                        подряд (риск-модель: сначала report, потом кик);
//  * overlay_blocked   — оверлей из чёрного списка (DLL завершила процесс);
//  * heartbeat_lost    — DLL перестала слать heartbeat (её выгрузили/заморозили).
const SEVERE_KINDS = new Set([
  "injected_module",
  "cheat_module",
  "module_tampered",
  "debugger",
  "overlay_confirmed",
  "overlay_blocked",
  "heartbeat_lost",
])

// Review-события (overlay_suspicious, suspicious_executable_memory,
// suspicious_thread, unsigned_module, signed_unknown_module, temp_module)
// НЕ входят в SEVERE_KINDS: они логируются для ручного разбора в админке и
// Discord, но сами по себе не банят игрока — это снижает ложные срабатывания.

// Сколько попыток инжекта до бана по железу.
const STRIKE_LIMIT = 3

interface StrikeRow {
  ac_strikes: number
  ac_last_session: string | null
  last_hwid: string | null
}

/**
 * POST /api/launcher/anticheat
 *
 * Лаунчер (античит-DLL + внешний монитор) присылает список нарушений
 * (Authorization: Bearer <token>, тело { hwid, nickname, session, events[] }).
 *
 * Все события складываются в anticheat_events (Discord-бот постит их в канал).
 * Если среди них есть серьёзное (инжект/чит/отладчик), засчитываем игроку
 * одну попытку на игровую сессию; на STRIKE_LIMIT попытке — бан по железу.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "launcher-anticheat", 60, 60_000)
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
    return Response.json({ error: "Invalid payload" }, { status: 400 })
  }

  const { hwid, session, events } = parsed.data
  // Ник берём из авторизованной сессии, а не из тела — его нельзя подделать.
  const nick = user.minecraft_nick
  const db = getDb()

  // 1. Сохраняем все события (для логов в Discord).
  const values = events.map((e) => [nick, hwid || null, e.kind, e.detail || null, e.source])
  await db.query(
    "INSERT INTO anticheat_events (minecraft_nick, hwid, kind, detail, source) VALUES ?",
    [values],
  )

  // 2. Есть ли серьёзные события — считаем попытку инжекта.
  const hasSevere = events.some((e) => SEVERE_KINDS.has(e.kind))
  let banned = false
  let strikes = 0

  if (hasSevere) {
    const [rows] = await db.query(
      "SELECT ac_strikes, ac_last_session, last_hwid FROM users WHERE minecraft_nick = ? LIMIT 1",
      [nick],
    )
    const row = (rows as StrikeRow[])[0]
    const prevStrikes = row?.ac_strikes ?? 0
    const lastSession = row?.ac_last_session ?? null
    const sessionKey = session || "unknown"

    // Одна попытка на игровую сессию: не накручиваем страйки повторными
    // отчётами внутри одного запуска игры.
    if (sessionKey !== lastSession) {
      strikes = prevStrikes + 1
      await db.query(
        "UPDATE users SET ac_strikes = ?, ac_last_session = ?, ac_last_strike = NOW() WHERE minecraft_nick = ?",
        [strikes, sessionKey, nick],
      )

      if (strikes >= STRIKE_LIMIT) {
        const banHwid = hwid || row?.last_hwid || null
        const reason = `Античит: ${strikes} попытки инжекта в игру`
        // Блокируем аккаунт...
        await db.query(
          "UPDATE users SET is_banned = 1, ban_reason = ? WHERE minecraft_nick = ?",
          [reason, nick],
        )
        // ...и устройство (вход с этого компьютера будет запрещён).
        if (banHwid) {
          await db.query(
            "INSERT INTO banned_hwids (hwid, mc_username, reason) VALUES (?, ?, ?) " +
              "ON DUPLICATE KEY UPDATE reason = VALUES(reason)",
            [banHwid, nick, reason],
          )
        }
        // Отдельным событием — чтобы Discord-бот сообщил о бане.
        await db.query(
          "INSERT INTO anticheat_events (minecraft_nick, hwid, kind, detail, source) VALUES (?, ?, ?, ?, ?)",
          [nick, banHwid, "hwid_banned", reason, "server"],
        )
        banned = true
      }
    } else {
      strikes = prevStrikes
    }
  }

  return Response.json({ ok: true, stored: events.length, strikes, banned })
}
