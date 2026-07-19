import { z } from "zod"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getOrder, deliverOrder } from "@/lib/donate"
import { notifyAdmins } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({ orderId: z.number().int().positive() })

/**
 * POST /api/mod/claim   { orderId }
 * «Забрать» товар из корзины. Выполняет команду выдачи на игровом сервере
 * через RCON (deliverOrder) и помечает заказ выданным. Игрок может забрать
 * только свой заказ в статусе 'paid'.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "mod-claim", 30, 60_000)
  if (limited) return limited

  const user = await authenticatePlayer(request)
  if (!user) return unauthorized("Требуется вход в игру через лаунчер")

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Не указан заказ" }, { status: 400 })

  const order = await getOrder(parsed.data.orderId)
  if (!order || order.minecraft_nick !== user.minecraft_nick) {
    return Response.json({ error: "Заказ не найден" }, { status: 404 })
  }
  if (order.status === "delivered") {
    return Response.json({ ok: true, alreadyDelivered: true, message: "Уже получено" })
  }
  if (order.status !== "paid") {
    return Response.json({ error: "Этот заказ нельзя забрать" }, { status: 400 })
  }

  // Игрок должен быть онлайн, чтобы предмет/привилегия выдались командой.
  try {
    await deliverOrder(order.id, "mod")
  } catch (err) {
    console.error("[mod/claim] deliver failed:", err)
    void notifyAdmins(
      `⚠️ <b>Выдача из корзины не удалась</b>\nЗаказ #${order.id}\nИгрок: <code>${order.minecraft_nick}</code>\nПричина: ${err instanceof Error ? err.message : String(err)}`,
    )
    return Response.json(
      { error: "Не удалось выдать. Зайди на сервер и попробуй снова.", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }

  return Response.json({ ok: true, delivered: true, message: "Товар выдан!" })
}
