import { z } from "zod"
import { findUserByNick } from "@/lib/db"
import { verifyPassword } from "@/lib/passwords"
import { createSession } from "@/lib/session"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/account/login
 * Вход в личный кабинет по нику+паролю (те же учётки, что в лаунчере/боте).
 * body: { login, password } -> ставит cookie сессии.
 */

const bodySchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
})

const NICK_RE = /^[a-zA-Z0-9_]{3,16}$/

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "account-login", 15, 60_000)
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

  const login = parsed.data.login.trim()
  const { password } = parsed.data

  if (!NICK_RE.test(login)) {
    return Response.json({ error: "Неверный ник или пароль" }, { status: 401 })
  }

  const user = await findUserByNick(login)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Неверный ник или пароль" }, { status: 401 })
  }
  if (user.is_banned === 1) {
    return Response.json({ error: `Аккаунт заблокирован: ${user.ban_reason || "без причины"}` }, { status: 403 })
  }

  await createSession(user.minecraft_nick)
  return Response.json({ ok: true, nick: user.minecraft_nick })
}
