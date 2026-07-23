import { z } from "zod"
import { getDb, findUserByNick } from "@/lib/db"
import { verifyPassword } from "@/lib/passwords"
import { generateApiToken, sha256 } from "@/lib/tokens"
import { checkRateLimit } from "@/lib/rate-limit"
import { logAccountEvent, clientIp, launcherVersionFromReq } from "@/lib/audit"

const bodySchema = z.object({
  nickname: z.string().regex(/^[a-zA-Z0-9_]{3,16}$/),
  password: z.string().min(1).max(128),
})

/**
 * POST /api/auth/login
 * Launcher login: { nickname, password } -> { token, nickname }
 * The api_token hash is stored in users; the raw token goes to the launcher.
 */
export async function POST(request: Request) {
  // Strict limit: passwords are being brute-forceable otherwise
  const limited = checkRateLimit(request, "auth-login", 10, 60_000)
  if (limited) return limited

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: "Введите ник и пароль" }, { status: 400 })
  }

  const { nickname, password } = parsed.data
  const user = await findUserByNick(nickname)

  // Same error for "no user" and "wrong password" - do not leak which nicks exist
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Неверный ник или пароль" }, { status: 401 })
  }

  if (user.is_banned === 1) {
    return Response.json(
      { error: `Аккаунт заблокирован. Причина: ${user.ban_reason || "не указана"}`, banned: true },
      { status: 403 },
    )
  }

  const rawToken = generateApiToken()
  const db = getDb()
  await db.query("UPDATE users SET api_token = ?, last_login = NOW() WHERE minecraft_nick = ?", [
    sha256(rawToken),
    user.minecraft_nick,
  ])

  // Журнал входов (раздел «Логи входов» в админ-панели). Не блокирует вход.
  await logAccountEvent({
    eventType: "launcher_login",
    nick: user.minecraft_nick,
    ip: clientIp(request),
    launcherVersion: launcherVersionFromReq(request),
    detail: "Вход в лаунчер",
  })

  return Response.json({ token: rawToken, nickname: user.minecraft_nick })
}
