import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Страховочный слой авторизации для админ-зоны + передача текущего пути
 * в root-layout (для шлюза «технические работы»).
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
  const { pathname } = request.nextUrl

  // Путь текущего запроса для root-layout: шлюз техработ решает, показывать
  // страницу «Техработы» или обычный сайт.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-pe-path", pathname)

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value)

  // Админ-зона без сессии — сразу 401 JSON (API) или редирект на кабинет.
  if (pathname.startsWith("/api/admin")) {
    if (hasSession) return NextResponse.next({ headers: requestHeaders })
    return NextResponse.json({ error: "Требуется вход администратора" }, { status: 401 })
  }
  if (pathname.startsWith("/admin")) {
    if (hasSession) return NextResponse.next({ headers: requestHeaders })
    const url = request.nextUrl.clone()
    url.pathname = "/account"
    url.search = ""
    return NextResponse.redirect(url)
  }

  return NextResponse.next({ headers: requestHeaders })
}

export const config = {
  matcher: ["/:path*"],
}