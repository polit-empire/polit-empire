import { z } from "zod"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getProduct, getDcBalance, logDc, createOrder, getSetting } from "@/lib/donate"
import { notifyAdmins } from "@/lib/telegram"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({ productId: z.number().int().positive() })

/**
 * POST /api/mod/purchase   { productId }
 * Покупка товара из игрового меню за баланс DC. Привилегии и предметы
 * (kind privilege|item|other) списывают DC и создают заказ со статусом 'paid' —
 * он попадает в «корзину» игрока. Выдача происходит позже, когда игрок
 * нажимает «Забрать» в корзине (см. /api/mod/claim).
 *
 * Пакеты DC (kind='dc') за реальные деньги в игре купить нельзя — возвращаем
 * ссылку на сайт.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "mod-purchase", 30, 60_000)
  if (limited) return limited

  const user = await authenticatePlayer(request)
  if (!user) return unauthorized("Требуется вход в игру через лаунчер")
  if (user.is_banned === 1) return Response.json({ error: "Аккаунт заблокирован" }, { status: 403 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Не выбран товар" }, { status: 400 })

  const nick = user.minecraft_nick
  const product = await getProduct(parsed.data.productId)
  if (!product || product.is_active !== 1) {
    return Response.json({ error: "Товар недоступен" }, { status: 404 })
  }

  // Пакеты DC — только на сайте (реальные деньги). Ссылку строим из
  // ПУБЛИЧНОГО адреса сайта: сначала настройка site_url из админки, затем
  // env-переменные, и только в крайнем случае — origin запроса (это и был
  // источник localhost, если мод стучится на локальный сервер).
  if (product.kind === "dc") {
    const configured = (await getSetting("site_url", "")).trim()
    const base = (
      configured ||
      process.env.SITE_URL ||
      process.env.PUBLIC_BASE_URL ||
      new URL(request.url).origin
    ).replace(/\/+$/, "")
    const webUrl = `${base}/donate`
    return Response.json({
      ok: false,
      requiresPayment: true,
      webUrl,
      error: "Пакеты DC пополняются на сайте. Открой раздел «Донат».",
    })
  }

  if (product.kind !== "privilege" && product.kind !== "item" && product.kind !== "other") {
    return Response.json({ error: "Этот товар нельзя купить в игре" }, { status: 400 })
  }

  // Цена в DC хранится в price_rub.
  const costDc = product.price_rub
  if (costDc <= 0) return Response.json({ error: "У товара не задана цена в DC" }, { status: 400 })

  const balance = await getDcBalance(nick)
  if (balance < costDc) {
    return Response.json(
      { error: `Недостаточно DC: нужно ${costDc}, у вас ${balance}`, balance },
      { status: 400 },
    )
  }

  // Создаём заказ со статусом 'paid' (в корзине, не выдан) и списываем DC.
  const orderId = await createOrder({
    nick,
    productId: product.id,
    kind: product.kind,
    title: product.name,
    amountRub: 0,
    dcAmount: 0,
    method: "dc",
    status: "paid",
    note: "Куплено в игре — ожидает получения из корзины",
  })
  await logDc(nick, -costDc, `Покупка «${product.name}» в игре (заказ #${orderId})`, "mod")

  void notifyAdmins(
    `🎮 <b>Покупка в игре #${orderId}</b>\nИгрок: <code>${nick}</code>\nТовар: ${product.name}\nЦена: ${costDc} DC\nСтатус: в корзине (ожидает получения)`,
  )

  const newBalance = await getDcBalance(nick)
  return Response.json({
    ok: true,
    orderId,
    balance: newBalance,
    message: "Товар добавлен в корзину. Забери его в корзине.",
  })
}
