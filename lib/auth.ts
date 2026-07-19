import jwt from "jsonwebtoken"
import { findUserByApiTokenHash, findUserByNick, type UserRow } from "@/lib/db"
import { sha256 } from "@/lib/tokens"

/* ------------------------------------------------------------------ */
/* Player authentication (api_token / GML accessToken)                 */
/* ------------------------------------------------------------------ */

const GML_ISSUER = "gml-api"
const GML_AUDIENCE = "gml-clients"
// Microsoft IdentityModel кодирует стандартные claim-имена полными URI.
const NAME_CLAIM = "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"

/**
 * Base URL of Gml.Web.Api reachable from this app.
 * Inside docker-compose the API container is `gml-web-api:8082`.
 */
function gmlApiBase(): string {
  return process.env.GML_INTERNAL_API_URL || "http://gml-web-api:8082"
}

/**
 * Локальная проверка GML accessToken (JWT, HS256) без сетевого запроса.
 *
 * Gml.Web.Api подписывает player-JWT тем же SECURITY_KEY, что лежит в .env
 * как GML_SECURITY_KEY, поэтому подпись и ник игрока можно проверить прямо
 * здесь — не дёргая /api/v1/integrations/auth/checkToken. Локальная проверка
 * полностью совпадает с вердиктом GML checkToken: валидные (свежие) токены
 * проходят, отозванные/устаревшие — отбиваются. Это быстрее и стабильнее,
 * чем сетевой запрос.
 *
 * Возвращает ник игрока из payload либо null, если токен не валиден
 * (плохая подпись, истёк, неверный iss/aud, нет claim name).
 */
function verifyGmlJwt(token: string): string | null {
  const key = process.env.GML_SECURITY_KEY
  if (!key || key.length === 0) return null
  try {
    const payload = jwt.verify(token, key, {
      issuer: GML_ISSUER,
      audience: GML_AUDIENCE,
      algorithms: ["HS256"],
    }) as jwt.JwtPayload
    const name = payload[NAME_CLAIM]
    return typeof name === "string" && name.length > 0 ? name : null
  } catch {
    return null
  }
}

/**
 * Fallback-проверка GML accessToken через Gml.Web.Api checkToken.
 *
 * Используется только если локальная verifyGmlJwt() не сработала
 * (например, при смене GML_SECURITY_KEY). На практике при корректном
 * ключе этот путь почти не нужен.
 */
async function authenticateViaGml(token: string): Promise<UserRow | null> {
  const url = `${gmlApiBase()}/api/v1/integrations/auth/checkToken`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "PolitEmpireSite/1.0" },
      body: JSON.stringify({ AccessToken: token }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { name?: string; isBanned?: boolean } }
    const name = body?.data?.name
    if (!name || body?.data?.isBanned) return null
    return findUserByNick(name)
  } catch {
    return null
  }
}

/**
 * Извлекает и проверяет токен игрока из заголовка Authorization
 * (`Authorization: Bearer <token>`). Принимает два вида токенов:
 *   1. Локальный api_token (веб-кабинет) — ищется по sha256-хэшу в БД.
 *   2. GML accessToken (лаунчер, JWT HS256) — подпись проверяется локально
 *      ключом GML_SECURITY_KEY, ник берётся из payload.
 *      Если локальная проверка не удалась — fallback на GML checkToken.
 * Возвращает строку пользователя или null (тогда /api/mod/* отдаёт 401
 * «Требуется вход в игру через лаунчер»).
 */
export async function authenticatePlayer(request: Request): Promise<UserRow | null> {
  const header = request.headers.get("authorization")
  if (!header || !header.startsWith("Bearer ")) return null
  const rawToken = header.slice(7).trim()
  if (rawToken.length < 32) return null

  // 1. Локальный api_token (веб-кабинет).
  const user = await findUserByApiTokenHash(sha256(rawToken))
  if (user) return user

  // 2. GML JWT — проверяем подпись локально (быстро и детерминированно).
  if (rawToken.split(".").length === 3) {
    const name = verifyGmlJwt(rawToken)
    if (name) {
      const u = await findUserByNick(name)
      if (u) return u
    }
  }

  // 3. Fallback — GML checkToken (редко нужен при корректном GML_SECURITY_KEY).
  return authenticateViaGml(rawToken)
}

export function unauthorized(message = "Unauthorized"): Response {
  return Response.json({ error: message }, { status: 401 })
}
