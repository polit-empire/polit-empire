import { z } from "zod"
import { findUserByApiTokenHash } from "@/lib/db"
import { sha256 } from "@/lib/tokens"
import { checkRateLimit } from "@/lib/rate-limit"

const bodySchema = z.object({
  api_token: z.string().min(32).max(128),
})

/**
 * POST /api/auth/verify
 * Verify an api_token and return the current player state.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "auth-verify", 30, 60_000)
  if (limited) return limited

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: "Invalid token" }, { status: 400 })
  }

  const user = await findUserByApiTokenHash(sha256(parsed.data.api_token))
  if (!user) {
    console.warn("[security] Invalid api_token verification attempt")
    return Response.json({ valid: false, error: "Токен недействителен" }, { status: 401 })
  }

  return Response.json({
    valid: true,
    minecraft_nick: user.minecraft_nick,
    is_banned: user.is_banned === 1,
    ban_reason: user.ban_reason,
  })
}
