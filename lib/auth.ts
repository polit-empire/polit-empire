import { findUserByApiTokenHash, type UserRow } from "@/lib/db"
import { sha256 } from "@/lib/tokens"

/* ------------------------------------------------------------------ */
/* Player authentication (api_token)                                   */
/* ------------------------------------------------------------------ */

/**
 * Base URL of Gml.Web.Api reachable from this app.
 * Inside docker-compose the API container is `gml-web-api:8082`.
 */
function gmlApiBase(): string {
  return process.env.GML_INTERNAL_API_URL || "http://gml-web-api:8082"
}

/**
 * Verify a GML accessToken via Gml.Web.Api checkToken and return
 * the matching local user row (accounts are still stored in our DB).
 */
async function authenticateViaGml(token: string): Promise<UserRow | null> {
  const url = `${gmlApiBase()}/api/v1/integrations/auth/checkToken`
  try {
    console.log("[auth-gml] checkToken ->", url, "tokenLen=", token.length, "base=", gmlApiBase())
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "PolitEmpireSite/1.0" },
      body: JSON.stringify({ AccessToken: token }),
      signal: AbortSignal.timeout(5000),
    })
    console.log("[auth-gml] checkToken resp status=", res.status, "ok=", res.ok)
    if (!res.ok) {
      const txt = await res.text().catch(() => "<no body>")
      console.log("[auth-gml] not ok body:", txt.slice(0, 300))
      return null
    }
    const body = (await res.json()) as { data?: { name?: string; isBanned?: boolean } }
    console.log("[auth-gml] body:", JSON.stringify(body).slice(0, 300))
    const name = body?.data?.name
    if (!name || body?.data?.isBanned) {
      console.log("[auth-gml] no name or banned; name=", name, "isBanned=", body?.data?.isBanned)
      return null
    }
    const { findUserByNick } = await import("@/lib/db")
    const u = await findUserByNick(name)
    console.log("[auth-gml] findUserByNick(", name, ") ->", u ? u.minecraft_nick : "NULL")
    return u
  } catch (e) {
    console.log("[auth-gml] EXCEPTION:", e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * Extract and verify the player's token from the Authorization header
 * (`Authorization: Bearer <token>`). Accepts both the legacy api_token
 * and a GML accessToken (verified via Gml.Web.Api). Returns the user row or null.
 */
export async function authenticatePlayer(request: Request): Promise<UserRow | null> {
  const header = request.headers.get("authorization")
  if (!header || !header.startsWith("Bearer ")) {
    console.log("[auth] no Bearer header")
    return null
  }
  const rawToken = header.slice(7).trim()
  console.log("[auth] token len=", rawToken.length, "head=", rawToken.slice(0, 60))
  // JWT debug: decode payload (middle segment)
  if (rawToken.split(".").length === 3) {
    try {
      const payloadB64 = rawToken.split(".")[1]
      const padded = payloadB64 + "=".repeat((4 - payloadB64.length % 4) % 4)
      const payload = Buffer.from(padded, "base64url").toString("utf8")
      console.log("[auth] JWT payload:", payload.slice(0, 500))
    } catch (e) { console.log("[auth] JWT decode err:", e) }
  }
  if (rawToken.length < 32) {
    console.log("[auth] token too short (<32)")
    return null
  }
  const user = await findUserByApiTokenHash(sha256(rawToken))
  if (user) {
    console.log("[auth] found by api_token hash:", user.minecraft_nick)
    return user
  }
  console.log("[auth] not in DB by api_token, trying GML...")
  return authenticateViaGml(rawToken)
}

export function unauthorized(message = "Unauthorized"): Response {
  return Response.json({ error: message }, { status: 401 })
}
