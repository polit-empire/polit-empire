import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FIELDS: Record<string, string> = {
  kind: "kind",
  name: "name",
  description: "description",
  price_rub: "price_rub",
  group_name: "group_name",
  duration_days: "duration_days",
  dc_amount: "dc_amount",
  rcon_command: "rcon_command",
  accent: "accent",
  sort_order: "sort_order",
  is_active: "is_active",
  icon_item: "icon_item",
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const { id } = await params
  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ error: "bad request" }, { status: 400 })

  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, col] of Object.entries(FIELDS)) {
    if (key in b) {
      sets.push(`${col} = ?`)
      values.push(key === "is_active" ? (b[key] ? 1 : 0) : b[key])
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "нет полей" }, { status: 400 })

  values.push(Number(id))
  const db = getDb()
  await db.query(`UPDATE donate_products SET ${sets.join(", ")} WHERE id = ?`, values)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const { id } = await params
  const db = getDb()
  await db.query("DELETE FROM donate_products WHERE id = ?", [Number(id)])
  return NextResponse.json({ ok: true })
}
