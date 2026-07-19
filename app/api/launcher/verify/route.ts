import { z } from "zod"
import { getDb } from "@/lib/db"
import { authenticatePlayer } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { getSetting } from "@/lib/donate"

/**
 * POST /api/launcher/verify
 *
 * Проверка целостности самого лаунчера (self-integrity).
 * Лаунчер на старте считает SHA-256 своего исполняемого файла и присылает его
 * сюда вместе со своей версией. Сервер сверяет хеш с белым списком официальных
 * сборок (таблица launcher_hashes).
 *
 * Тело: { version: string, sha256: string(64 hex) }
 * Требуется Authorization: Bearer <token> — привязываем результат к игроку и
 * можем занести подмену в журнал античита.
 *
 * Ответ:
 *   { ok: true,  enforced }               — хеш валиден ИЛИ проверка выключена
 *   { ok: false, enforced: true, reason } — активный белый список есть, но хеша
 *                                           в нём нет → лаунчер модифицирован
 *
 * Fail-open по замыслу:
 *  • пустой белый список (ещё не зарегистрирован ни один эталон) → ok:true,
 *    enforced:false — иначе релиз забанил бы всех до регистрации хеша;
 *  • ошибки БД → ok:true (не блокируем игроков из-за сбоя инфраструктуры).
 */

const bodySchema = z.object({
  version: z.string().max(32).optional(),
  sha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64}$/, "sha256 должен быть 64 hex-символа"),
})

export async function POST(request: Request) {
  const limited = checkRateLimit(request, "launcher-verify", 30, 60_000)
  if (limited) return limited

  // Токен нужен, чтобы привязать проверку к нику (для журнала античита).
  // Отсутствие токена не блокируем жёстко — но и не палим детали, просто 401.
  const user = await authenticatePlayer(request)
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 })
  }

  const { version, sha256 } = parsed.data

  try {
    const db = getDb()

    // Главный «рубильник»: enforcement включается ТОЛЬКО когда админ явно выставил
    // launcher_integrity_enforce = "1" в панели. По умолчанию ВЫКЛЮЧЕНО — иначе
    // устаревший/незарегистрированный хеш заблокировал бы легальные лаунчеры
    // (в т.ч. свежесобранный самим админом). Включать нужно лишь после того, как
    // хеш текущей официальной сборки заведомо попал в белый список.
    const enforce = (await getSetting("launcher_integrity_enforce", "0")) === "1"
    if (!enforce) {
      return Response.json({ ok: true, enforced: false })
    }

    // Есть ли вообще активные эталоны? Нет → проверка выключена (fail-open).
    const [activeRows] = await db.query(
      "SELECT COUNT(*) AS c FROM launcher_hashes WHERE is_active = 1",
    )
    const activeCount = (activeRows as Array<{ c: number }>)[0]?.c ?? 0
    if (activeCount === 0) {
      return Response.json({ ok: true, enforced: false })
    }

    // Совпадение по хешу среди активных эталонов.
    const [matchRows] = await db.query(
      "SELECT id FROM launcher_hashes WHERE is_active = 1 AND sha256 = ? LIMIT 1",
      [sha256],
    )
    const matched = (matchRows as unknown[]).length > 0

    if (matched) {
      return Response.json({ ok: true, enforced: true })
    }

    // Хеш неизвестен при активном белом списке — лаунчер изменён.
    // Пишем в журнал античита (idempotent-безопасно, ошибку глушим).
    try {
      await db.query(
        `INSERT INTO anticheat_events (minecraft_nick, hwid, kind, detail, source)
         VALUES (?, ?, 'launcher_integrity', ?, 'site')`,
        [
          user.minecraft_nick,
          (user as { last_hwid?: string | null }).last_hwid ?? null,
          `Неизвестный хеш лаунчера${version ? ` (v${version})` : ""}: ${sha256}`,
        ],
      )
    } catch (err) {
      console.error("[security] failed to log launcher_integrity event:", err)
    }

    console.warn(
      `[security] launcher integrity mismatch for ${user.minecraft_nick}: ${sha256} (v${version ?? "?"})`,
    )
    return Response.json({
      ok: false,
      enforced: true,
      reason:
        "Файл лаунчера изменён и не совпадает с официальной сборкой. Переустановите лаунчер с сайта.",
    })
  } catch (err) {
    // Сбой БД не должен блокировать игроков — fail-open.
    console.error("[security] launcher verify error:", err)
    return Response.json({ ok: true, enforced: false })
  }
}
