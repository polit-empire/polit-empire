import { z } from "zod"
import { getSessionUser } from "@/lib/session"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  getProduct,
  createOrder,
  computeDcBonus,
  getDcBalance,
  logDc,
  deliverOrder,
} from "@/lib/donate"
import { createMyDonatePayment, createEasyDonatePayment, createMillidaPayment, createDonatelloPayment } from "@/lib/payments"
import { notifyAdmins } from "@/lib/telegram"

/**
 * POST /api/donate/purchase
 * Покупка товара. Тело:
 *   { productId, method }                         — товар из каталога
 *   { customDc, method }                          — произвольное пополнение DC
 * method: mydonate | easydonate | millida | donatello | dc (оплата балансом DC — только для привилегий)
 *
 * Денежные методы создают заказ pending и возвращают ссылку на оплату
 * (или требуют ручного подтверждения, если провайдер не настроен).
 * Оплата балансом DC выдаётся мгновенно.
 */

const bodySchema = z.object({
  productId: z.number().int().positive().optional(),
  customDc: z.number().int().min(1).max(100000).optional(),
  method: z.enum(["mydonate", "easydonate", "millida", "donatello", "dc"]),
})

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "donate-purchase", 20, 60_000)
  if (limited) return limited

  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Войдите в личный кабинет" }, { status: 401 })
  if (user.is_banned === 1) return Response.json({ error: "Аккаунт заблокирован" }, { status: 403 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 })

  const { productId, customDc, method } = parsed.data
  const nick = user.minecraft_nick

  /* ---------- Произвольное пополнение DC ---------- */
  if (customDc && !productId) {
    if (method === "dc") {
      return Response.json({ error: "DC нельзя пополнить балансом DC" }, { status: 400 })
    }
    const bonus = await computeDcBonus(customDc)
    const totalDc = customDc + bonus
    // Donatello работает в гривнах: 1₴ = 1 DC (до бонуса). Бонус применяется
    // на сайте, так же как с рублёвыми провайдерами.
    const amountRub = method === "donatello" ? customDc : customDc // UAH для Donatello, RUB для остальных
    const title = `Пополнение ${customDc} DC${bonus ? ` (+${bonus} бонус)` : ""}`
    return startMoneyOrder({ nick, productId: null, kind: "dc", title, amountRub, dcAmount: totalDc, method })
  }

  /* ---------- Товар из каталога ---------- */
  if (!productId) return Response.json({ error: "Не выбран товар" }, { status: 400 })
  const product = await getProduct(productId)
  if (!product || product.is_active !== 1) {
    return Response.json({ error: "Товар недоступен" }, { status: 404 })
  }

  // Привилегия и предмет покупаются только за баланс DC — мгновенно.
  if (product.kind === "privilege" || product.kind === "item") {
    if (method !== "dc") {
      return Response.json({ error: "Этот товар покупается только за DC" }, { status: 400 })
    }
    const costDc = product.price_rub // цена задаётся в DC
    const balance = await getDcBalance(nick)
    if (balance < costDc) {
      return Response.json({ error: `Недостаточно DC: нужно ${costDc}, у вас ${balance}` }, { status: 400 })
    }
    const orderId = await createOrder({
      nick,
      productId: product.id,
      kind: product.kind,
      title: `${product.name} (за DC)`,
      amountRub: 0,
      dcAmount: 0,
      method: "dc",
      status: "paid",
    })
    // Списываем DC и выдаём товар по RCON.
    await logDc(nick, -costDc, `Покупка «${product.name}» (заказ #${orderId})`, "site")
    try {
      await deliverOrder(orderId, "site")
    } catch (err) {
      console.error("[purchase] deliver privilege via DC failed:", err)
      return Response.json(
        { error: "Оплата прошла, но выдача не удалась. Обратитесь к администратору.", orderId },
        { status: 502 },
      )
    }
    void notifyAdmins(
      `🛒 <b>Новый заказ #${orderId}</b>\nИгрок: <code>${nick}</code>\nТовар: ${product.name}\nОплата: баланс DC (${costDc} DC)\nСтатус: выдан автоматически`,
    )
    return Response.json({ ok: true, delivered: true, orderId })
  }

  if (product.kind === "dc") {
    // Пакет DC — только денежная оплата, с бонусом.
    if (method === "dc") return Response.json({ error: "Недопустимый способ оплаты" }, { status: 400 })
    const bonus = await computeDcBonus(product.dc_amount)
    const totalDc = product.dc_amount + bonus
    const title = `${product.name}${bonus ? ` (+${bonus} бонус)` : ""}`
    return startMoneyOrder({
      nick,
      productId: product.id,
      kind: "dc",
      title,
      amountRub: product.price_rub,
      dcAmount: totalDc,
      method,
    })
  }

  return Response.json({ error: "Недопустимый товар или способ оплаты" }, { status: 400 })
}

/** Создаёт денежный заказ и инвойс у провайдера (или ручное подтверждение). */
async function startMoneyOrder(o: {
  nick: string
  productId: number | null
  kind: string
  title: string
  amountRub: number
  dcAmount: number
  method: "mydonate" | "easydonate" | "millida" | "donatello"
}): Promise<Response> {
  const methodLabel =
    o.method === "mydonate"
      ? "MyDonate"
      : o.method === "millida"
        ? "Millida"
        : o.method === "donatello"
          ? "Donatello"
          : "EasyDonate"
  const orderId = await createOrder({
    nick: o.nick,
    productId: o.productId,
    kind: o.kind,
    title: o.title,
    amountRub: o.amountRub,
    dcAmount: o.dcAmount,
    method: o.method,
    status: "pending",
  })

  const invoice =
    o.method === "mydonate"
      ? await createMyDonatePayment({ orderId, amountRub: o.amountRub, nick: o.nick })
      : o.method === "millida"
        ? await createMillidaPayment({ orderId, amountRub: o.amountRub, nick: o.nick, title: o.title })
        : o.method === "donatello"
          ? await createDonatelloPayment({ orderId, dcAmount: o.dcAmount })
          : await createEasyDonatePayment({ orderId, amountRub: o.amountRub, nick: o.nick })

  const { getDb } = await import("@/lib/db")
  const db = getDb()

  // Провайдер настроен, но платёж не создан (неверные реквизиты/сбой API).
  // Не оставляем «висящий» заказ в ручной обработке — отменяем его и
  // возвращаем понятную причину, чтобы покупатель и админ видели, что не так.
  if (invoice.error) {
    await db.query("UPDATE donate_orders SET status = 'canceled', note = ? WHERE id = ?", [
      invoice.error.slice(0, 255),
      orderId,
    ])
    void notifyAdmins(
      `⚠️ <b>Заказ #${orderId} не создан</b>\nИгрок: <code>${o.nick}</code>\nТо��ар: ${o.title}\nО��лата: ${methodLabel}\nПричина: ${invoice.error}`,
    )
    // ВАЖНО: отвечаем HTTP 200, а не 5xx. Обратный прокси на проде
    // (proxy_intercept_errors) подменяет тело 5xx-ответов на свою HTML-страницу,
    // из-за чего реальная причина от EasyDonate до браузера не доходила и
    // пользователь видел только «Ошибка 502». Статус кладём в тело (ok:false).
    return Response.json({ ok: false, error: invoice.error, orderId })
  }

  await db.query("UPDATE donate_orders SET payment_ref = ?, pay_url = ?, note = ? WHERE id = ?", [
    invoice.paymentRef,
    invoice.payUrl,
    invoice.manual ? "Ожидает ручного подтверждения администратором" : null,
    orderId,
  ])

  void notifyAdmins(
    `🛒 <b>Новый заказ #${orderId}</b>\nИгрок: <code>${o.nick}</code>\nТовар: ${o.title}\nСумма: ${o.amountRub} ₽\nОплата: ${methodLabel}\nСтатус: ${invoice.manual ? "ожидает ручного подтверждения" : "ожидает оплаты"}`,
  )

  return Response.json({
    ok: true,
    orderId,
    payUrl: invoice.payUrl,
    manual: invoice.manual,
    orderCode: invoice.orderCode,
    amountUah: invoice.amountUah,
    requiresConfirmation: invoice.requiresConfirmation,
    message: invoice.manual
      ? "Провайдер оплаты не настроен. После оплаты администратор подтвердит заказ вручную."
      : null,
  })
}
