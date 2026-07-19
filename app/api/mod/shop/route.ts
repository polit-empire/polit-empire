import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { listProducts, getDcBalance, getSetting } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Иконка предмета по умолчанию в зависимости от типа товара. */
function defaultIcon(kind: string): string {
  if (kind === "privilege") return "minecraft:golden_helmet"
  if (kind === "dc") return "minecraft:sunflower"
  return "minecraft:chest"
}

/**
 * GET /api/mod/shop
 * Каталог товаров для игрового меню + текущий баланс DC игрока и параметры
 * бонуса. Товары обновляются динамически из БД (админка редактирует их).
 */
export async function GET(request: Request) {
  const user = await authenticatePlayer(request)
  if (!user) return unauthorized("Требуется вход в игру через лаунчер")
  if (user.is_banned === 1) return Response.json({ error: "Аккаунт заблокирован" }, { status: 403 })

  const [products, balance, threshold, percent] = await Promise.all([
    listProducts(true),
    getDcBalance(user.minecraft_nick),
    getSetting("dc_bonus_threshold", "250"),
    getSetting("dc_bonus_percent", "10"),
  ])

  return Response.json({
    nick: user.minecraft_nick,
    balance,
    dcBonus: { threshold: Number(threshold), percent: Number(percent) },
    products: products.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      description: p.description,
      // Для привилегий/предметов цена в DC (price_rub хранит стоимость в DC).
      // Для пакетов DC price_rub — цена в валюте, dcAmount — сколько DC дают.
      priceDc: p.kind === "dc" ? 0 : p.price_rub,
      priceMoney: p.kind === "dc" ? p.price_rub : 0,
      dcAmount: p.dc_amount,
      durationDays: p.duration_days,
      accent: p.accent,
      icon: p.icon_item || defaultIcon(p.kind),
      // Можно ли купить прямо в игре за DC.
      buyableInGame: p.kind === "privilege" || p.kind === "item",
    })),
  })
}
