import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"
import { listProducts } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const products = await listProducts(false)
  return NextResponse.json({ products })
}

export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = await req.json().catch(() => null)
  if (!b || typeof b.name !== "string" || !b.name.trim()) {
    return NextResponse.json({ error: "Название обязательно" }, { status: 400 })
  }

  const db = getDb()
  const kind = b.kind === "dc" ? "dc" : b.kind === "item" ? "item" : "privilege"
  const [res] = await db.query(
    `INSERT INTO donate_products
       (kind, name, description, price_rub, group_name, duration_days, dc_amount, rcon_command, accent, sort_order, is_active, icon_item)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      kind,
      b.name.trim(),
      b.description ?? null,
      Number(b.price_rub) || 0,
      b.group_name ?? null,
      Number(b.duration_days) || 30,
      Number(b.dc_amount) || 0,
      b.rcon_command ?? null,
      b.accent ?? "emerald",
      Number(b.sort_order) || 0,
      b.is_active === false ? 0 : 1,
      b.icon_item ?? null,
    ],
  )
  return NextResponse.json({ ok: true, id: (res as { insertId: number }).insertId })
}
