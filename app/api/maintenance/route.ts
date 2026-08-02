import { NextResponse } from "next/server"
import { getMaintenanceState } from "@/lib/maintenance"
import { authenticatePlayer } from "@/lib/auth"
import { isAdminUser } from "@/lib/admin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Публичный статус техработ. Используется лаунчером.
 *
 * Если в заголовке Authorization передан валидный токен игрока (Bearer GML
 * accessToken из лаунчера), сервер дополнительно возвращает admin_allowed —
 * во время техработ запускать игру могут только администраторы
 * (ADMIN_NICKS / ADMIN_TELEGRAM_IDS / bot_admins).
 */
export async function GET(request: Request) {
  const { enabled, message } = await getMaintenanceState()
  let adminAllowed = false
  try {
    const user = await authenticatePlayer(request)
    if (user) adminAllowed = await isAdminUser(user)
  } catch {
    adminAllowed = false
  }
  return NextResponse.json({ enabled, message, adminAllowed })
}