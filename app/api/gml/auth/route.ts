import crypto from "crypto"
import { z } from "zod"
import { getDb, findUserByNick } from "@/lib/db"
import { verifyPassword } from "@/lib/passwords"
import { rateLimit, checkRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/gml/auth
 *
 * Мост авторизации для GML («Custom» auth-провайдер).
 * Gml.Web.Api вызывает этот endpoint при входе игрока в лаунчер:
 *   запрос:  { "Login": "<ник>", "Password": "<пароль>" }
 *   успех:   200 { Login, UserUuid, Message }
 *   отказ:   401 { Message }
 *
 * Аккаунты создаются и управляются через Telegram-бота (@PolitEmpireBot):
 * регистрация, смена пароля — всё в боте. Здесь только проверка.
 *
 * Настройка в панели GML:
 *   Интеграции -> Аутентификация -> Custom ->
 *   Endpoint: https://politempire.org/api/gml/auth
 */

const bodySchema = z.object({
  // GML отправляет PascalCase; принимаем и camelCase на всякий случай.
  Login: z.string().optional(),
  Password: z.string().optional(),
  login: z.string().optional(),
  password: z.string().optional(),
})

const NICK_RE = /^[a-zA-Z0-9_]{3,16}$/

/** Детеминированный offline-UUID по нику (стандарт Minecraft offline mode). */
function offlineUuid(nick: string): string {
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${nick}`, "utf8").digest()
  hash[6] = (hash[6] & 0x0f) | 0x30 // version 3
  hash[8] = (hash[8] & 0x3f) | 0x80 // variant
  const hex = hash.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function POST(request: Request) {
  // БЕЗОПАСНОСТЬ: эндпоинт вызывает backend GML (сервер-в-сервер), но физически
  // доступен публично, а проверяет пароль из таблицы users (тот же, что у
  // /api/account/login и админов из ADMIN_NICKS). Раньше лимит был только по
  // нику (10/мин) — с разных IP можно было параллельно перебирать пароль
  // одного ника, а с одного IP — множество ников без общего потолка. Добавляем
  // лимит по IP (реальный IP берётся из X-Real-IP, см. getClientIp), чтобы
  // закрыть перебор пароля админской учётки как вектор захвата админ-панели.
  const ipLimited = checkRateLimit(request, "gml-auth-ip", 30, 60_000)
  if (ipLimited) return ipLimited

  // GML (Gml.Backend) принимает от собственного auth-endpoint ТОЛЬКО коды 200
  // (успех) и 401/403/404 (отказ). Любой другой статус (400/500 и т.п.) панель
  // трактует как «ошибка сервера авторизации» — в т.ч. на проверочный/пустой
  // запрос при сохранении интеграции. Поэтому кривой/пустой/непарсящийся
  // запрос — это НЕ 400, а 401 (валидный «вход не удался»): endpoint при этом
  // считается рабочим, а реальный вход отдаёт 200.
  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ Message: "Неверный ник или пароль" }, { status: 401 })
  }
  if (!parsed.success) {
    return Response.json({ Message: "Неверный ник или пароль" }, { status: 401 })
  }

  const login = (parsed.data.Login ?? parsed.data.login ?? "").trim()
  const password = parsed.data.Password ?? parsed.data.password ?? ""

  if (!NICK_RE.test(login) || password.length === 0) {
    return Response.json({ Message: "Неверный ник или пароль" }, { status: 401 })
  }

  // Ограничиваем перебор пароля по конкретному аккаунту (нику): 10 попыток
  // в минуту на ник — в дополнение к общему лимиту по IP выше.
  if (!rateLimit(`gml-auth:${login.toLowerCase()}`, 10, 60_000)) {
    console.warn(`[security] gml-auth rate limit exceeded for login=${login}`)
    return Response.json({ Message: "Слишком много попыток входа. Подождите минуту." }, { status: 429 })
  }

  const user = await findUserByNick(login)

  // Одинаковый ответ для «нет пользователя» и «неверный пароль» —
  // не раскрываем, какие ники существуют.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ Message: "Неверный ник или пароль" }, { status: 401 })
  }

  if (user.is_banned === 1) {
    return Response.json(
      { Message: `Аккаунт заблокирован. Причина: ${user.ban_reason || "не указана"}` },
      { status: 403 },
    )
  }

  // Бан по UUID игрока (offline-UUID детерминирован по нику).
  const uuid = offlineUuid(user.minecraft_nick)
  try {
    const db = getDb()
    const [rows] = await db.query("SELECT reason FROM banned_uuids WHERE uuid = ?", [uuid])
    const banRow = (rows as Array<{ reason: string | null }>)[0]
    if (banRow) {
      const reason = banRow.reason || "Заблокировано администрацией"
      // Синхронизируем бан аккаунта, чтобы блок сохранялся и без пересчёта UUID.
      await db.query("UPDATE users SET is_banned = 1, ban_reason = ? WHERE minecraft_nick = ?", [
        reason,
        user.minecraft_nick,
      ])
      return Response.json({ Message: `Аккаунт заблокирован. Причина: ${reason}` }, { status: 403 })
    }
  } catch (err) {
    console.error("[gml-auth] banned_uuids check failed:", err)
  }

  // Отмечаем вход (для профиля в TG-боте).
  try {
    const db = getDb()
    await db.query("UPDATE users SET last_login = NOW() WHERE minecraft_nick = ?", [user.minecraft_nick])
  } catch (err) {
    console.error("[gml-auth] failed to update last_login:", err)
  }

  return Response.json({
    Login: user.minecraft_nick,
    UserUuid: offlineUuid(user.minecraft_nick),
    Message: "Успешная авторизация",
  })
}

/**
 * GET /api/gml/auth — health-check.
 *
 * Сама авторизация работает по POST. Раньше GET отдавал 405, и обратный прокси
 * (nginx/хостинг) подменял его на HTML-страницу «Страница недоступна». Из-за
 * этого проверка эндпоинта из браузера/панели выглядела как поломка. Отдаём
 * лёгкий JSON 200, чтобы эндпоинт был явно «жив» и его можно было проверить.
 */
export async function GET() {
  return Response.json({ status: "ok", method: "POST", message: "GML auth endpoint is alive" })
}
