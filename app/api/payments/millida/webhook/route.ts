import { getDb } from "@/lib/db"
import { getOrder, deliverOrder } from "@/lib/donate"
import { getMillidaConfig, millidaVerifySignature } from "@/lib/payments"
import { notifyAdmins } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/payments/millida/webhook
 * Вебхук Millida Merchant API. Присылается при событиях счёта.
 *
 * Заголовки:
 *   X-Millida-Event     — тип события (invoice.paid | invoice.failed | invoice.delivered)
 *   X-Millida-Signature — `sha256=<hex>`, где hex = HMAC-SHA256(сырое тело, webhookSecret)
 *
 * Тело: { event, data: { id, externalId, status, amountKopecks, playerNickname, paidAt, … } }
 *
 * При invoice.paid находим заказ по externalId (`pe-<orderId>`, кладётся при
 * создании счёта) и начисляем DC на баланс сайта. externalId идемпотентен, а
 * вебхук может прийти повторно — поэтому уже выданный заказ пропускаем.
 */

/** Достаёт наш orderId из externalId вида `pe-<id>`. */
function extractOrderId(externalId: unknown): number | null {
  if (typeof externalId !== "string") return null
  const m = externalId.match(/^pe-(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function POST(request: Request) {
  const raw = await request.text()
  const { webhookSecret } = await getMillidaConfig()

  // Проверка подписи. Без секрета вебхук считаем недоверенным.
  const signature = request.headers.get("x-millida-signature") ?? ""
  if (!millidaVerifySignature(raw, signature, webhookSecret)) {
    console.warn("[millida-webhook] invalid signature")
    return Response.json({ error: "invalid signature" }, { status: 403 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 })
  }

  const event = String(payload.event ?? request.headers.get("x-millida-event") ?? "")
  const data = payload.data as Record<string, unknown> | undefined

  // Нас интересует только успешная оплата.
  if (event !== "invoice.paid") {
    return Response.json({ ok: true, ignored: event })
  }

  const status = String(data?.status ?? "").toUpperCase()
  if (status && status !== "PAID") {
    return Response.json({ ok: true, status })
  }

  const db = getDb()

  // Сопоставляем оплату с заказом: сначала по externalId (`pe-<orderId>`),
  // затем фолбэк — по payment_ref (`mld-<invoice id>`).
  let orderId = extractOrderId(data?.externalId)
  if (!orderId && typeof data?.id === "string") {
    const [rows] = await db.query(
      "SELECT id FROM donate_orders WHERE payment_ref = ? AND method = 'millida' AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [`mld-${data.id}`],
    )
    orderId = (rows as Array<{ id: number }>)[0]?.id ?? null
  }

  if (!orderId) {
    console.warn("[millida-webhook] order not found for invoice", data?.id, data?.externalId)
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
    await deliverOrder(orderId, "millida")
  } catch (err) {
    console.error("[millida-webhook] delivery failed:", err)
    void notifyAdmins(
      `⚠️ Оплата заказа #${orderId} (Millida) прошла, но начисление не удалось. Проверьте вручную.`,
    )
    return Response.json({ ok: true, delivery: "failed" })
  }

  const amountKopecks = Number(data?.amountKopecks ?? 0)
  const amountRub = amountKopecks ? (amountKopecks / 100).toFixed(2) : ""
  void notifyAdmins(
    `✅ <b>Оплачен заказ #${orderId}</b>\nИгрок: <code>${order.minecraft_nick}</code>\nТовар: ${order.title}\nСумма: ${amountRub} ₽ (Millida)`,
  )

  return Response.json({ ok: true })
}
