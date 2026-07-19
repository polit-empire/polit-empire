import { listProducts, getSetting } from "@/lib/donate"

/**
 * GET /api/donate/products
 * Публичный список активных товаров + параметры бонуса DC для витрины.
 */
export async function GET() {
  const [products, threshold, percent] = await Promise.all([
    listProducts(true),
    getSetting("dc_bonus_threshold", "250"),
    getSetting("dc_bonus_percent", "10"),
  ])

  return Response.json({
    products: products.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      description: p.description,
      priceRub: p.price_rub,
      groupName: p.group_name,
      durationDays: p.duration_days,
      dcAmount: p.dc_amount,
      accent: p.accent,
    })),
    dcBonus: { threshold: Number(threshold), percent: Number(percent) },
  })
}
