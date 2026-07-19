import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { listOrders, deliverOrder, getOrder } from "@/lib/donate"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const orders = await listOrders(undefined, 100)
  return NextResponse.json({ orders })
}

/** Подтверждение оплаты вручную (крипта) или отмена заказа. */
export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = await req.json().catch(() => null)
  const orderId = Number(b?.order_id)
  const action = b?.action as string
  if (!orderId || !action) return NextResponse.json({ error: "bad request" }, { status: 400 })

  const order = await getOrder(orderId)
  if (!order) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })

  if (action === "confirm") {
    try {
      await deliverOrder(orderId, admin.minecraft_nick)
      return NextResponse.json({ ok: true, message: "Заказ выдан" })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: msg }, { status: 502 })
    }
  }
  if (action === "cancel") {
    const db = getDb()
    await db.query("UPDATE donate_orders SET status = 'canceled' WHERE id = ?", [orderId])
    return NextResponse.json({ ok: true, message: "Заказ отменён" })
  }
  return NextResponse.json({ error: "неизвестное действие" }, { status: 400 })
}
