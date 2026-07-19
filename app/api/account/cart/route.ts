import { getSessionUser } from "@/lib/session"
import { getDb } from "@/lib/db"
import { getProduct } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/account/cart
 * Корзина текущего игрока (web-сессия): оплаченные, но ещё не выданные заказы
 * (status='paid'). Это ровно те же записи, что видит игровой мод через
 * /api/mod/cart — корзина сайта и мода синхронизированы через таблицу
 * donate_orders.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Не авторизован" }, { status: 401 })

  const db = getDb()
  const [rows] = await db.query(
    `SELECT id, product_id, kind, title, amount_rub, dc_amount, created_at
       FROM donate_orders
      WHERE minecraft_nick = ? AND status = 'paid'
      ORDER BY created_at ASC`,
    [user.minecraft_nick],
  )
  const orders = rows as Array<{
    id: number
    product_id: number | null
    kind: string
    title: string
    amount_rub: number
    dc_amount: number
    created_at: Date
  }>

  // Иконка предмета берётся из товара (для единообразия с модом).
  const items = await Promise.all(
    orders.map(async (o) => {
      const product = o.product_id ? await getProduct(o.product_id) : null
      return {
        orderId: o.id,
        kind: o.kind,
        title: o.title,
        icon: product?.icon_item ?? null,
        amountRub: o.amount_rub,
        dcAmount: o.dc_amount,
        createdAt: o.created_at,
      }
    }),
  )

  return Response.json({ items })
}
