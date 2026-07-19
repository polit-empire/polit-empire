import { getDb } from "@/lib/db"
import { deliverOrder } from "@/lib/donate"
import { notifyAdmins } from "@/lib/telegram"

/** Нормализованный донат (единый вид для cron-опроса и колбэка). */
export interface NormalizedDonation {
  donationId: string
  message: string
  amountUah: number
  currency: string
  donorName: string | null
}

export interface ProcessResult {
  status:
    | "processed"
    | "already"
    | "no_code"
    | "unknown_code"
    | "invalid_currency"
    | "insufficient_amount"
    | "deliver_failed"
  orderId: number | null
  detail?: string
}

/**
 * Начисляет один донат Donatello по коду заказа. Идемпотентна: повторный
 * вызов с тем же donationId вернёт "already" и ничего не начислит (защита
 * через UNIQUE-индекс donatello_payments.donation_id). Используется и cron-ом,
 * и колбэком, поэтому логика начисления в одном месте.
 */
export async function processDonatelloDonation(d: NormalizedDonation): Promise<ProcessResult> {
  const db = getDb()

  if (!d.donationId) {
    return { status: "no_code", orderId: null, detail: "empty donationId" }
  }

  // Уже обработан?
  const [existingRows] = await db.query("SELECT id FROM donatello_payments WHERE donation_id = ? LIMIT 1", [
    d.donationId,
  ])
  if ((existingRows as Array<unknown>).length > 0) {
    return { status: "already", orderId: null }
  }

  // Код заказа: ищем в комментарии и имени донатора. Формат PE-<orderId>-<rand>.
  const haystack = `${d.message} ${d.donorName ?? ""}`
  const codeMatch = haystack.match(/\bPE-\d+-[A-Z0-9]+/i)
  if (!codeMatch) {
    await db.query(
      `INSERT INTO donatello_payments (donation_id, amount_uah, currency, donor_name, message, status, error_message, processed_at)
       VALUES (?, ?, ?, ?, ?, 'no_code', 'Код заказа не найден в комментарии', NOW())`,
      [d.donationId, d.amountUah, d.currency, d.donorName, d.message],
    )
    return { status: "no_code", orderId: null }
  }
  const orderCode = codeMatch[0].toUpperCase()

  // Ищем ожидающий заказ.
  const [orderRows] = await db.query(
    `SELECT id, minecraft_nick, dc_amount, amount_rub FROM donate_orders
     WHERE payment_ref = ? AND method = 'donatello' AND status = 'pending' LIMIT 1`,
    [orderCode],
  )
  const order = (orderRows as Array<{
    id: number
    minecraft_nick: string
    dc_amount: number
    amount_rub: number
  }>)[0]
  if (!order) {
    await db.query(
      `INSERT INTO donatello_payments (donation_id, amount_uah, currency, donor_name, message, status, error_message, processed_at)
       VALUES (?, ?, ?, ?, ?, 'unknown_code', 'Заказ не найден или уже оплачен', NOW())`,
      [d.donationId, d.amountUah, d.currency, d.donorName, d.message],
    )
    return { status: "unknown_code", orderId: null, detail: orderCode }
  }

  // Валюта.
  if (d.currency !== "UAH") {
    await db.query(
      `INSERT INTO donatello_payments (donation_id, order_id, amount_uah, currency, donor_name, message, status, error_message, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'invalid_currency', ?, NOW())`,
      [d.donationId, order.id, d.amountUah, d.currency, d.donorName, d.message, `Ожидалась UAH, получено ${d.currency}`],
    )
    return { status: "invalid_currency", orderId: order.id, detail: d.currency }
  }

  // Сумма: 1₴ = 1 DC. Требуем оплату не меньше исходной суммы заказа.
  if (d.amountUah < order.amount_rub) {
    await db.query(
      `INSERT INTO donatello_payments (donation_id, order_id, amount_uah, currency, donor_name, message, status, error_message, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'insufficient_amount', ?, NOW())`,
      [
        d.donationId,
        order.id,
        d.amountUah,
        d.currency,
        d.donorName,
        d.message,
        `Ожидалось ${order.amount_rub}₴, получено ${d.amountUah}₴`,
      ],
    )
    return { status: "insufficient_amount", orderId: order.id, detail: `${d.amountUah} < ${order.amount_rub}` }
  }

  // Записываем донат и помечаем заказ оплаченным.
  await db.query(
    `INSERT INTO donatello_payments (donation_id, order_id, amount_uah, currency, donor_name, message, status, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'processed', NOW())`,
    [d.donationId, order.id, d.amountUah, d.currency, d.donorName, d.message],
  )
  await db.query("UPDATE donate_orders SET status = 'paid', paid_at = NOW() WHERE id = ?", [order.id])

  // Выдача (DC + RCON). При ошибке заказ остаётся paid для ручной выдачи.
  try {
    await deliverOrder(order.id, "donatello")
    void notifyAdmins(
      `💰 <b>Donatello: заказ #${order.id} оплачен</b>\nИгрок: <code>${order.minecraft_nick}</code>\nСумма: ${d.amountUah} ₴\nDC: ${order.dc_amount}\nСтатус: выдан автоматически`,
    )
    return { status: "processed", orderId: order.id }
  } catch (err) {
    console.error("[donatello] deliverOrder failed:", err)
    void notifyAdmins(
      `⚠️ <b>Donatello: заказ #${order.id} оплачен, но выдача не удалась</b>\nИгрок: <code>${order.minecraft_nick}</code>\nСумма: ${d.amountUah} ₴\nDC: ${order.dc_amount}\nПричина: ${err instanceof Error ? err.message : String(err)}\nТребуется выдать вручную.`,
    )
    return { status: "deliver_failed", orderId: order.id, detail: String(err) }
  }
}
