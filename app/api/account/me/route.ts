import { getSessionUser } from "@/lib/session"
import { isAdminUser } from "@/lib/admin"
import { getDcBalance, getActivePrivilege, listOrders, listProducts } from "@/lib/donate"

/**
 * GET /api/account/me
 * Данные текущего игрока для личного кабинета: статус, привилегия, баланс DC,
 * история заказов, признак админа. 401 если не авторизован.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Не авторизован" }, { status: 401 })

  const [balance, privilege, orders, admin, products] = await Promise.all([
    getDcBalance(user.minecraft_nick),
    getActivePrivilege(user.minecraft_nick),
    listOrders(user.minecraft_nick, 30),
    isAdminUser(user),
    listProducts(true),
  ])

  // Сопоставляем group_name активной привилегии с названием товара.
  let privilegeName: string | null = null
  if (privilege) {
    const match = products.find((p) => p.kind === "privilege" && p.group_name === privilege.group_name)
    privilegeName = match?.name ?? privilege.group_name
  }

  return Response.json({
    nick: user.minecraft_nick,
    isAdmin: admin,
    isBanned: user.is_banned === 1,
    banReason: user.ban_reason,
    telegramLinked: user.telegram_id != null,
    createdAt: user.created_at,
    lastLogin: user.last_login,
    balance,
    privilege: privilege
      ? { group: privilege.group_name, name: privilegeName, expiresAt: privilege.expires_at }
      : null,
    orders: orders.map((o) => ({
      id: o.id,
      title: o.title,
      kind: o.kind,
      amountRub: o.amount_rub,
      dcAmount: o.dc_amount,
      method: o.method,
      status: o.status,
      payUrl: o.pay_url,
      createdAt: o.created_at,
    })),
  })
}
