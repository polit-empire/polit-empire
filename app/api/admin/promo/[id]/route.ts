import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const { id } = await params
  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ error: "bad request" }, { status: 400 })

  const FIELDS: Record<string, string> = {
    code: "code",
    discount_type: "discount_type",
    discount_value: "discount_value",
    max_uses: "max_uses",
    min_amount_rub: "min_amount_rub",
    product_ids: "product_ids",
    expires_at: "expires_at",
    is_active: "is_active",
  }

  const sets: string[] = []
  const values: unknown[] = []
  for (const [key, col] of Object.entries(FIELDS)) {
    if (key in b) {
      sets.push(`${col} = ?`)
      if (key === "code") {
        values.push(String(b[key]).toUpperCase().trim())
      } else if (key === "is_active") {
        values.push(b[key] ? 1 : 0)
      } else if (key === "expires_at") {
        values.push(b[key] ? new Date(b[key]) : null)
      } else {
        values.push(b[key])
      }
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "нет полей" }, { status: 400 })

  values.push(Number(id))
  const db = getDb()
  await db.query(`UPDATE promo_codes SET ${sets.join(", ")} WHERE id = ?`, values)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const { id } = await params
  const db = getDb()
  await db.query("DELETE FROM promo_code_usage WHERE promo_id = ?", [Number(id)])
  await db.query("DELETE FROM promo_codes WHERE id = ?", [Number(id)])
  return NextResponse.json({ ok: true })
}
