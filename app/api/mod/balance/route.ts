import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { getDcBalance } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/mod/balance
 * Возвращает баланс DC игрока. Авторизация — Bearer accessToken (GML) или
 * legacy api_token. Используется модом для HUD и плейсхолдера %donatecoin%.
 */
export async function GET(request: Request) {
  const user = await authenticatePlayer(request)
  if (!user) return unauthorized("Требуется вход в игру через лаунчер")
  if (user.is_banned === 1) return Response.json({ error: "Аккаунт заблокирован" }, { status: 403 })

  const balance = await getDcBalance(user.minecraft_nick)
  return Response.json({ nick: user.minecraft_nick, balance })
}
