import { getDb } from "@/lib/db"
import { getOrder, deliverOrder } from "@/lib/donate"
import { getEasyDonateConfig, easydonateSign } from "@/lib/payments"
import { notifyAdmins } from "@/lib/telegram"
import { safeEqual } from "@/lib/tokens"

/**
 * POST /api/shop/webhook
 * Callback EasyDonate (указан в настройках магазина). После успешной оплаты
 * EasyDonate шлёт JSON с полями payment_id, cost, customer, products, signature.
 *
 * Проверяем подпись HMAC-SHA256("payment_id@cost@customer", shopKey), находим
 * заказ по payment_ref = `ed-<payment_id>` и проводим его:
 *   - DC: начисляем на баланс сайта (bot_balance_log) БЕЗ RCON — монеты в игре
 *     выдаёт сам плагин EasyDonate командой dc give.
 *   - привилегия (на случай ручной настройки товара): выдаём по RCON.
 */
export async function POST(request: Request) {
  let payload: Record<string, unknown>
  try {
    payload = (await request.json().catch(async () => {
      const form = await request.formData()
      return Object.fromEntries(form.entries())
    })) as Record<string, unknown>
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 })
  }

  const paymentId = String(payload.payment_id ?? "")
  const cost = payload.cost ?? ""
  const customer = String(payload.customer ?? "")
  const signature = String(payload.signature ?? "")

  if (!paymentId || !customer || !signature) {
    return Response.json({ error: "missing fields" }, { status: 400 })
  }

  const { shopKey } = await getEasyDonateConfig()
  if (!shopKey) {
    console.error("[shop-webhook] shop key not configured")
    return Response.json({ error: "not configured" }, { status: 500 })
  }

  // EasyDonate передаёт cost как число; для подписи используем исходную форму.
  // Сравнение подписи — константное по времени (timingSafeEqual через safeEqual).
  const expected = easydonateSign(paymentId, String(cost), customer, shopKey)
  if (!safeEqual(expected.toLowerCase(), signature.toLowerCase())) {
    console.warn("[shop-webhook] bad signature for payment", paymentId)
    return Response.json({ error: "bad signature" }, { status: 403 })
  }

  const db = getDb()
  const [rows] = await db.query(
    "SELECT id FROM donate_orders WHERE payment_ref = ? LIMIT 1",
    [`ed-${paymentId}`],
  )
  const orderId = (rows as Array<{ id: number }>)[0]?.id
  if (!orderId) {
    console.warn("[shop-webhook] order not found for payment", paymentId)
    return Response.json({ error: "order not found" }, { status: 404 })
  }

  const order = await getOrder(orderId)
  if (!order) return Response.json({ error: "order not found" }, { status: 404 })
  if (order.status === "delivered") return Response.json({ ok: true, already: true })

  await db.query(
    "UPDATE donate_orders SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?",
    [orderId],
  )

  try {
    // DC выдаёт плагин EasyDonate в игре — RCON не трогаем, только баланс сайта.
    await deliverOrder(orderId, "easydonate", { skipRcon: order.kind === "dc" })
  } catch (err) {
    console.error("[shop-webhook] delivery failed:", err)
    void notifyAdmins(
      `⚠️ Оплата заказа #${orderId} прошла, но начисление не удалось. Проверьте вручную.`,
    )
    return Response.json({ ok: true, delivery: "failed" })
  }

  void notifyAdmins(
    `✅ <b>Оплачен заказ #${orderId}</b>\nИгрок: <code>${order.minecraft_nick}</code>\nТовар: ${order.title}\nСумма: ${cost} ₽ (EasyDonate)`,
  )

  return Response.json({ ok: true })
}
