import { NextResponse } from "next/server"
import { getSetting } from "@/lib/donate"
import { processDonatelloDonation } from "@/lib/donatello"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/donatello/callback
 * Реалтайм-колбэк Donatello («Колбеки»): Donatello присылает донат сразу
 * после оплаты. Это надёжнее опроса cron — начисление мгновенное.
 *
 * Проверка подлинности: заголовок `X-Key` должен совпадать с секретным ключом,
 * который вы задаёте и в админке (donatello_callback_key), и в настройках
 * колбэка на Donatello.
 *
 * Тело (по докам): { pubId, clientName, message, amount, currency,
 * actualAmount, actualCurrency, source, createdAt, ... }
 */
export async function POST(request: Request) {
  const enabled = (await getSetting("donatello_enabled", "0")) === "1"
  if (!enabled) {
    return NextResponse.json({ success: false, message: "Donatello отключён" }, { status: 403 })
  }

  const expectedKey = await getSetting("donatello_callback_key", "")
  if (!expectedKey) {
    console.error("[donatello] callback key не настроен")
    return NextResponse.json({ success: false, message: "Callback key не настроен" }, { status: 500 })
  }

  const providedKey = request.headers.get("x-key")
  if (providedKey !== expectedKey) {
    console.error("[donatello] неверный X-Key в колбэке")
    return NextResponse.json({ success: false, message: "Неверный ключ" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, message: "Некорректный JSON" }, { status: 400 })
  }

  // actualAmount — реально полученная сумма (после комиссий), если есть —
  // используем её, иначе amount. Оба приходят строкой.
  const amountUah = Number(body.actualAmount ?? body.amount ?? 0)
  const currency = String(body.actualCurrency ?? body.currency ?? "UAH").toUpperCase()

  const result = await processDonatelloDonation({
    donationId: String(body.pubId ?? body.id ?? ""),
    message: String(body.message ?? ""),
    amountUah,
    currency,
    donorName: (body.clientName ?? null) as string | null,
  })

  // Donatello ждёт 2xx, иначе будет повторять колбэк. Даже если код заказа не
  // найден, отвечаем 200 — повтор не поможет, донат записан со статусом.
  return NextResponse.json({ success: true, status: result.status, orderId: result.orderId })
}
