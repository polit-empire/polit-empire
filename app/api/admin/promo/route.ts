import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { listPromoCodes, createPromoCode, batchCreatePromoCodes } from "@/lib/promo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const promos = await listPromoCodes()
  return NextResponse.json({ promos })
}

export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = await req.json().catch(() => null)
  if (!b) return NextResponse.json({ error: "bad request" }, { status: 400 })

  // Пакетная генерация
  if (b.batch && typeof b.batch === "number" && b.batch > 1) {
    if (!b.discount_type || !b.discount_value) {
      return NextResponse.json({ error: "discount_type и discount_value обязательны" }, { status: 400 })
    }
    const codes = await batchCreatePromoCodes(b.batch, {
      discount_type: b.discount_type,
      discount_value: Number(b.discount_value),
      max_uses: Number(b.max_uses) || 0,
      min_amount_rub: Number(b.min_amount_rub) || 0,
      product_ids: b.product_ids || null,
      expires_at: b.expires_at ? new Date(b.expires_at) : null,
      length: Number(b.code_length) || 8,
    })
    return NextResponse.json({ ok: true, count: codes.length, codes })
  }

  // Одиночное создание
  if (!b.discount_type || b.discount_value === undefined) {
    return NextResponse.json({ error: "discount_type и discount_value обязательны" }, { status: 400 })
  }

  const promo = await createPromoCode({
    code: b.code,
    discount_type: b.discount_type,
    discount_value: Number(b.discount_value),
    max_uses: Number(b.max_uses) || 0,
    min_amount_rub: Number(b.min_amount_rub) || 0,
    product_ids: b.product_ids || null,
    expires_at: b.expires_at ? new Date(b.expires_at) : null,
    length: Number(b.code_length) || 8,
  })
  return NextResponse.json({ ok: true, promo })
}
