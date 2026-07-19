import { z } from "zod"
import { getSessionUser } from "@/lib/session"
import { checkRateLimit } from "@/lib/rate-limit"
import { cancelOrder } from "@/lib/donate"

/**
 * POST /api/account/orders/cancel  { orderId }
 * Игрок отменяет собственный неоплаченный заказ (status = pending).
 */
const schema = z.object({ orderId: z.number().int().positive() })

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "order-cancel", 30, 60_000)
  if (limited) return limited

  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Не авторизован" }, { status: 401 })

  let parsed
  try {
    parsed = schema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 })

  const ok = await cancelOrder(parsed.data.orderId, user.minecraft_nick)
  if (!ok) return Response.json({ error: "Заказ нельзя отменить" }, { status: 400 })
  return Response.json({ ok: true })
}
