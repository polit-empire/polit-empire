import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Страховочный слой авторизации для админ-зоны.
 *
 * Полноценная проверка прав администратора выполняется в каждом роуте через
 * getAdminUser() (сверка сессии с ADMIN_NICKS/telegram/bot_admins). Этот
 * middleware — дополнительный барьер: он отсекает полностью неаутентифицированные
 * запросы к /admin и /api/admin ещё до попадания в обработчик и служит защитой
 * на случай, если в новый админ-роут забудут добавить getAdminUser(). Здесь
 * проверяется только НАЛИЧИЕ сессионной cookie (без обращения к БД — middleware
 * работает в edge-рантайме); окончательное решение всё равно принимает роут.
 */

const SESSION_COOKIE = "pe_session"

export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)
  if (hasSession) return NextResponse.next()

  const { pathname } = request.nextUrl

  // API админки без сессии — сразу 401 JSON (не редиректим API-запросы).
  if (pathname.startsWith("/api/admin")) {
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 })
  }

  // Страница /admin без сессии — на страницу входа в личный кабинет.
  const url = request.nextUrl.clone()
  url.pathname = "/account"
  url.search = ""
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
}
