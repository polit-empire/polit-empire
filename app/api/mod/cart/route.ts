import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { getDb } from "@/lib/db"
import { getProduct } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/mod/cart
 * Корзина игрока: оплаченные, но ещё не выданные заказы (status='paid').
 * Каждый элемент можно «Забрать» через /api/mod/claim.
 */
export async function GET(request: Request) {
  const user = await authenticatePlayer(request)
  if (!user) return unauthorized("Требуется вход в игру через лаунчер")

  const db = getDb()
  const [rows] = await db.query(
    `SELECT id, product_id, kind, title, created_at
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
    created_at: Date
  }>

  // Иконка для GUI берётся из товара (icon_item).
  const items = await Promise.all(
    orders.map(async (o) => {
      const product = o.product_id ? await getProduct(o.product_id) : null
      const icon =
        product?.icon_item ||
        (o.kind === "privilege" ? "minecraft:golden_helmet" : o.kind === "dc" ? "minecraft:sunflower" : "minecraft:chest")
      return {
        orderId: o.id,
        kind: o.kind,
        title: o.title,
        icon,
        createdAt: o.created_at,
      }
    }),
  )

  return Response.json({ items })
}
