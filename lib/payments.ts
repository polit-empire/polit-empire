import crypto from "crypto"
import { getSetting } from "@/lib/donate"

/**
 * Платёжные провайдеры. Реквизиты хранятся в site_settings и меняются в
 * админке. Пока стоят плейсхолдеры — провайдеры считаются «не настроенными»,
 * и заказ создаётся в статусе pending для ручного подтверждения админом.
 *
 * Крипто: Cryptomus-совместимый REST API (создание инвойса + подпись webhook).
 * EasyDonate: платёжная ссылка магазина.
 */

function isPlaceholder(v: string): boolean {
  return !v || v.startsWith("YOUR_") || v.length < 6
}

/**
 * MyDonate. У MyDonate нет server-to-server создания платежа по ключу — их
 * checkout защищён anti-bot токеном (state token) и доступен только с витрины
 * магазина. Поэтому интеграция сделана редиректом: кнопка ведёт покупателя на
 * витрину магазина (politempireshop.mydonate.io), где проходит оплата (СБП,
 * карта) и автоматическая выдача DC в игре плагином MyDonate.
 *
 * Настраивается один параметр — URL витрины (mydonate_shop_url).
 */
export async function getMyDonateConfig(): Promise<{
  shopUrl: string
  enabled: boolean
}> {
  const shopUrl =
    (await getSetting("mydonate_shop_url", "")) ||
    process.env.MYDONATE_SHOP_URL ||
    "https://politempireshop.mydonate.io"
  const enabled = (await getSetting("mydonate_enabled", "0")) === "1"
  return { shopUrl, enabled }
}

export async function myDonateConfigured(): Promise<boolean> {
  const { enabled, shopUrl } = await getMyDonateConfig()
  return enabled && Boolean(shopUrl)
}

export async function donatelloConfigured(): Promise<boolean> {
  const enabled = (await getSetting("donatello_enabled", "0")) === "1"
  const pageUrl = await getSetting("donatello_page_url", "")
  const token = await getSetting("donatello_api_token", "")
  return enabled && !isPlaceholder(pageUrl) && !isPlaceholder(token)
}

const MILLIDA_API = "https://api.millida.net/v2/merchant"

/**
 * Реквизиты Millida Merchant API. Millida выступает как платёжная система:
 * создаём счёт (invoice) на произвольную сумму и перенаправляем покупателя на
 * paymentUrl. После оплаты приходит вебхук invoice.paid, а сайт начисляет DC.
 *
 * Нужны только API-ключ (Bearer mtk_live_…, scope payments) и webhook secret
 * для проверки подписи входящих вебхуков. Значения — из site_settings с
 * фолбэком на переменные окружения.
 */
export async function getMillidaConfig(): Promise<{
  apiKey: string
  webhookSecret: string
  enabled: boolean
}> {
  const apiKey = (await getSetting("millida_api_key", "")) || process.env.MILLIDA_API_KEY || ""
  const webhookSecret =
    (await getSetting("millida_webhook_secret", "")) || process.env.MILLIDA_WEBHOOK_SECRET || ""
  const enabled = (await getSetting("millida_enabled", "0")) === "1"
  return { apiKey, webhookSecret, enabled }
}

export async function millidaConfigured(): Promise<boolean> {
  const { enabled, apiKey } = await getMillidaConfig()
  return enabled && Boolean(apiKey)
}

/**
 * Проверка подписи вебхука Millida. Заголовок X-Millida-Signature имеет вид
 * `sha256=<hex>`, где hex = HMAC-SHA256("сырое тело", webhookSecret).
 * Сравнение выполняется в постоянное время.
 */
export function millidaVerifySignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
  try {
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Достаёт человекочитаемую причину ошибки из ответа Millida. */
function millidaError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, unknown>
  const detail = b.error ?? b.message ?? b.detail
  return typeof detail === "string" && detail ? detail : null
}

/**
 * Millida: создаёт счёт на произвольную сумму через Merchant API и возвращает
 * ссылку на оплату (paymentUrl). Суммы в API — в копейках (1₽ = 100 копеек),
 * поэтому amountKopecks = amountRub * 100.
 *
 * externalId = `pe-<orderId>` — идемпотентный идентификатор заказа: повторный
 * запрос с тем же externalId вернёт тот же счёт. По нему же вебхук находит
 * заказ. Выдачу DC/привилегии делает сайт после вебхука invoice.paid.
 *
 * paymentRef = `mld-<invoice id>`.
 */
export async function createMillidaPayment(params: {
  orderId: number
  amountRub: number
  nick: string
  title?: string
}): Promise<PaymentResult> {
  const { apiKey } = await getMillidaConfig()
  if (!(await millidaConfigured())) {
    return { payUrl: null, paymentRef: null, manual: true }
  }

  try {
    const res = await fetch(`${MILLIDA_API}/invoices`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        externalId: `pe-${params.orderId}`,
        amountKopecks: Math.round(params.amountRub * 100),
        description: params.title || `Пополнение для ${params.nick}`,
        playerNickname: params.nick,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => null)) as {
      id?: string
      paymentUrl?: string
    } | null

    if (!res.ok || !body?.paymentUrl) {
      const reason =
        millidaError(body) || "Millida: не удалось создать счёт. Проверьте API-ключ (scope payments)."
      console.error("[payments] millida invoice failed:", { status: res.status, body })
      return { payUrl: null, paymentRef: null, manual: false, error: reason }
    }

    const ref = body.id ? `mld-${body.id}` : `mld-order-${params.orderId}`
    return { payUrl: body.paymentUrl, paymentRef: ref, manual: false }
  } catch (err) {
    console.error("[payments] millida create error:", err)
    return { payUrl: null, paymentRef: null, manual: false, error: "Millida недоступна. Попробуйте позже." }
  }
}

const EASYDONATE_API = "https://easydonate.ru/api/v3"

/** Реквизиты EasyDonate: из site_settings, с фолбэком на переменные окружения. */
export async function getEasyDonateConfig(): Promise<{
  shopKey: string
  serverId: string
  productId: string
  email: string
}> {
  const shopKey = (await getSetting("easydonate_shop_key", "")) || process.env.EASYDONATE_SHOP_KEY || ""
  const serverId =
    (await getSetting("easydonate_server_id", "")) || process.env.EASYDONATE_SERVER_ID || "138850"
  const productId =
    (await getSetting("easydonate_dc_product_id", "")) || process.env.EASYDONATE_DC_PRODUCT_ID || "1097608"
  const email =
    (await getSetting("easydonate_email", "")) || process.env.EASYDONATE_EMAIL || "shop@politempire.ru"
  return { shopKey, serverId, productId, email }
}

export async function easydonateConfigured(): Promise<boolean> {
  // Как в рабочем старом сайте: достаточно непустых shop_key, server_id и
  // product_id. Никаких эвристик «плейсхолдера» по длине — они ложно
  // помечали реальный ключ как ненастроенный и уводили заказ в ручную оплату.
  const { shopKey, serverId, productId } = await getEasyDonateConfig()
  return Boolean(shopKey) && Boolean(serverId) && Boolean(productId)
}

/** Подпись уведомления EasyDonate: HMAC-SHA256("payment_id@cost@customer", shopKey). */
export function easydonateSign(
  paymentId: string | number,
  cost: string | number,
  customer: string,
  shopKey: string,
): string {
  const hashString = [paymentId, cost, customer].join("@")
  return crypto.createHmac("sha256", shopKey).update(hashString).digest("hex")
}

export interface PaymentResult {
  payUrl: string | null
  paymentRef: string | null
  /** true — требуется ручное подтверждение админом (провайдер не настроен). */
  manual: boolean
  /**
   * Причина отказа, когда провайдер НАСТРОЕН, но создать платёж не удалось
   * (например, EasyDonate вернул «Товар не найден» из-за неверного
   * server_id/product_id). Такой заказ НЕ должен молча уходить в ручную
   * обработку — ошибку показываем покупателю и логируем для админа.
   */
  error?: string | null
  /** orderCode — уникальный код для Donatello (игрок вставляет в комментарий). */
  orderCode?: string | null
  /** amountUah — сумма для Donatello (1₴ = 1 DC, без бонуса). */
  amountUah?: number | null
  /** requiresConfirmation — для Donatello: показать экран с кодом перед переходом. */
  requiresConfirmation?: boolean
}

/**
 * Donatello: создаёт заказ с уникальным кодом и возвращает ссылку на страницу
 * доната автора. Игрок обязан вручную вставить код в комментарий Donatello.
 * paymentRef = уникальный код `PE-<orderId>-<случайные 6 символов>`.
 * amountUah = dcAmount (до применения бонуса), 1₴ = 1 DC.
 */
export async function createDonatelloPayment(params: {
  orderId: number
  dcAmount: number
}): Promise<PaymentResult> {
  if (!(await donatelloConfigured())) {
    return { payUrl: null, paymentRef: null, manual: true }
  }
  const pageUrl = await getSetting("donatello_page_url", "")
  const randomSuffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  const orderCode = `PE-${params.orderId}-${randomSuffix}`
  return {
    payUrl: pageUrl,
    paymentRef: orderCode,
    manual: false,
    orderCode,
    amountUah: params.dcAmount,
    requiresConfirmation: true,
  }
}


/**
 * MyDonate: возвращает ссылку на витрину магазина. Оплату (СБП, карта) и выдачу
 * DC в игре выполняет сам MyDonate через свой плагин — сайту не нужно создавать
 * платёж по API (их checkout защищён anti-bot токеном и недоступен server-side).
 *
 * Заказ на сайте создаётся как запись со статусом pending и помечается ссылкой
 * на витрину; фактическая выдача DC происходит на стороне MyDonate.
 * paymentRef = `mdn-<orderId>`.
 */
export async function createMyDonatePayment(params: {
  orderId: number
  amountRub: number
  nick: string
}): Promise<PaymentResult> {
  const { shopUrl } = await getMyDonateConfig()
  if (!(await myDonateConfigured())) {
    return { payUrl: null, paymentRef: null, manual: true }
  }
  return { payUrl: shopUrl.replace(/\/+$/, ""), paymentRef: `mdn-${params.orderId}`, manual: false }
}

/**
 * EasyDonate: создаёт платёж через официальный API v3 и возвращает ссылку на
 * оплату. Товар-валюта «Donate Coins» (1₽ = 1 DC) покупается в количестве
 * amountRub штук. Выдачу монет в игре делает плагин EasyDonate, сайт лишь
 * начислит DC на баланс после webhook.
 *
 * paymentRef = `ed-<payment_id EasyDonate>` — по нему webhook находит заказ.
 */
export async function createEasyDonatePayment(params: {
  orderId: number
  amountRub: number
  nick: string
  /** Промокод EasyDonate (coupon), если применяется. */
  coupon?: string | null
}): Promise<PaymentResult> {
  // Точный порт рабочего _create_easydonate_payment из старого сайта.
  const { shopKey, serverId, productId, email: cfgEmail } = await getEasyDonateConfig()

  // Провайдер действительно не настроен — только тогда уходим в ручную оплату.
  if (!shopKey) {
    return { payUrl: null, paymentRef: null, manual: true }
  }
  // Ключ есть, но не заданы server_id/product_id — это ошибка конфигурации,
  // а не «ручная оплата»: показываем понятную причину.
  if (!serverId || !productId) {
    return {
      payUrl: null,
      paymentRef: null,
      manual: false,
      error: "EasyDonate: не заданы ID сервера или ID товара DC в настройках.",
    }
  }

  const base = process.env.SITE_URL || "https://politempire.org"
  // EasyDonate требует email. В БД его не храним — генерируем технический,
  // как в старом сайте (customer → безопасный логин → login@domain).
  const safeUser = params.nick.replace(/[^a-zA-Z0-9._-]/g, "") || `user${params.orderId}`
  const email = cfgEmail || `${safeUser}@polit-empire.local`

  // products: {"<id>": <кол-во>}. Товар-валюта DC стоит 1₽/шт, поэтому кол-во
  // равно сумме в рублях (amountRub) → итоговая стоимость = amountRub ₽.
  const query = new URLSearchParams({
    customer: params.nick,
    email,
    server_id: serverId,
    products: JSON.stringify({ [productId]: params.amountRub }),
    success_url: `${base}/shop?payment=success`,
  })
  if (params.coupon) query.set("coupon", params.coupon)

  try {
    const res = await fetch(`${EASYDONATE_API}/shop/payment/create?${query.toString()}`, {
      method: "GET",
      headers: { "Shop-Key": shopKey, "User-Agent": "PolitEmpire/1.0" },
      signal: AbortSignal.timeout(15_000),
    })
    const body = (await res.json().catch(() => null)) as {
      success?: boolean
      response?: { url?: string; payment?: { id?: number | string } } | string
    } | null
    const resp = body?.response

    // Успех — ровно как в старом сайте: HTTP 200 + success + response.url.
    // ID платежа читаем best-effort и НЕ делаем его обязательным, иначе любой
    // отличающийся формат отве��а ложно превращалс�� в «провайдер не настроен».
    if (res.status === 200 && body?.success && typeof resp === "object" && resp?.url) {
      const paymentId = resp.payment?.id
      const paymentRef = paymentId ? `ed-${paymentId}` : `ed-order-${params.orderId}`
      return { payUrl: resp.url, paymentRef, manual: false }
    }

    // Платёж не создан: показываем реальную причину от EasyDonate.
    const reason =
      typeof resp === "string" && resp
        ? resp
        : "EasyDonate отклонил создание платежа. Проверьте Shop-Key, ID сервера и ID товара DC."
    console.error("[payments] easydonate create failed:", { status: res.status, body })
    return { payUrl: null, paymentRef: null, manual: false, error: reason }
  } catch (err) {
    console.error("[payments] easydonate create error:", err)
    return {
      payUrl: null,
      paymentRef: null,
      manual: false,
      error: "EasyDonate недоступен. Попробуйте позже.",
    }
  }
}
