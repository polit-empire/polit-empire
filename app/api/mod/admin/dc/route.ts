import { z } from "zod"
import { getSetting, getDcBalance, logDc } from "@/lib/donate"
import { safeEqual } from "@/lib/tokens"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  action: z.enum(["give", "take", "set", "get"]),
  nick: z.string().min(1).max(32),
  amount: z.number().int().min(0).max(10_000_000).optional(),
  reason: z.string().max(255).optional(),
})

/**
 * POST /api/mod/admin/dc   { action, nick, amount?, reason? }
 * Серверные команды /dc (give|take|set|get). Авторизация — заголовок
 * X-Mod-Key, который сверяется с настройкой mod_admin_key. Меняет DC-баланс
 * в общем журнале bot_balance_log (тот же, что и у сайта/бота).
 */
export async function POST(request: Request) {
  const configuredKey = await getSetting("mod_admin_key", "")
  if (!configuredKey) {
    return Response.json({ error: "Команды /dc отключены: не задан mod_admin_key" }, { status: 403 })
  }
  const provided = request.headers.get("x-mod-key") ?? ""
  if (!provided || !safeEqual(provided, configuredKey)) {
    return Response.json({ error: "Неверный ключ" }, { status: 401 })
  }

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Некорректные параметры" }, { status: 400 })

  const { action, nick, reason } = parsed.data
  const amount = parsed.data.amount ?? 0

  if (action === "get") {
    const balance = await getDcBalance(nick)
    return Response.json({ ok: true, nick, balance })
  }

  if ((action === "give" || action === "take" || action === "set") && parsed.data.amount == null) {
    return Response.json({ error: "Не указано количество" }, { status: 400 })
  }

  if (action === "give") {
    await logDc(nick, amount, reason || "Выдача DC командой /dc", "mod-admin")
  } else if (action === "take") {
    await logDc(nick, -amount, reason || "Списание DC командой /dc", "mod-admin")
  } else if (action === "set") {
    const current = await getDcBalance(nick)
    const delta = amount - current
    if (delta !== 0) await logDc(nick, delta, reason || `Установка баланса ${amount} DC`, "mod-admin")
  }

  const balance = await getDcBalance(nick)
  return Response.json({ ok: true, nick, balance })
}
