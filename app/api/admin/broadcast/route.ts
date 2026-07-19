import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { rconExec, isRconConfigured } from "@/lib/rcon"
import { broadcastToBotUsers } from "@/lib/telegram"
import { sendChannelMessage, DISCORD_DEVBLOG_CHANNEL_ID } from "@/lib/discord"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface Targets {
  server?: boolean
  telegram?: boolean
  discord?: boolean
  discord_devblog?: boolean
}

/**
 * Рассылка сообщения по выбранным каналам:
 *  - server          — всем игрокам на сервере командой `bc` (RCON);
 *  - telegram        — всем пользователям бота с привязанным TG (не забаненным);
 *  - discord         — в канал новостей ботом (DISCORD_TOKEN);
 *  - discord_devblog — в канал дев-блога ботом.
 *
 * Тело: { message, targets: { server, telegram, discord, discord_devblog } }.
 * Ошибка одного канала не отменяет остальные — возвращаем статус по каждому.
 */
export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = await req.json().catch(() => null)
  const message = typeof b?.message === "string" ? b.message.trim() : ""
  if (!message) return NextResponse.json({ error: "Пустое сообщение" }, { status: 400 })

  const targets: Targets = b?.targets && typeof b.targets === "object" ? b.targets : { server: true }
  if (!targets.server && !targets.telegram && !targets.discord && !targets.discord_devblog) {
    return NextResponse.json({ error: "Не выбран ни один канал рассылки" }, { status: 400 })
  }

  const results: Record<string, { ok: boolean; detail: string }> = {}

  // 1. Сервер (RCON `bc`).
  if (targets.server) {
    if (!isRconConfigured()) {
      results.server = { ok: false, detail: "RCON не настроен" }
    } else {
      try {
        await rconExec([`bc ${message}`])
        results.server = { ok: true, detail: "Отправлено на сервер" }
      } catch (err) {
        results.server = { ok: false, detail: `RCON: ${err instanceof Error ? err.message : "ошибка"}` }
      }
    }
  }

  // 2. Telegram — всем пользователям бота.
  if (targets.telegram) {
    if (!process.env.TG_BOT_TOKEN) {
      results.telegram = { ok: false, detail: "TG_BOT_TOKEN не задан" }
    } else {
      const { sent, failed } = await broadcastToBotUsers(message)
      results.telegram = {
        ok: sent > 0 || failed === 0,
        detail: `Telegram: доставлено ${sent}${failed ? `, ошибок ${failed}` : ""}`,
      }
    }
  }

  // 3. Discord — в канал новостей.
  if (targets.discord) {
    const res = await sendChannelMessage(message)
    results.discord = { ok: res.ok, detail: res.ok ? "Отправлено в Discord" : res.error || "Discord: ошибка" }
  }

  // 4. Discord — в канал дев-блога.
  if (targets.discord_devblog) {
    const res = await sendChannelMessage(message, DISCORD_DEVBLOG_CHANNEL_ID)
    results.discord_devblog = {
      ok: res.ok,
      detail: res.ok ? "Отправлено в дев-блог" : res.error || "Дев-блог: ошибка",
    }
  }

  const anyOk = Object.values(results).some((r) => r.ok)
  return NextResponse.json({ ok: anyOk, results }, { status: anyOk ? 200 : 502 })
}
