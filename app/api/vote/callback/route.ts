import { createHash, timingSafeEqual } from "node:crypto"
import { getDb } from "@/lib/db"
import { getVoteSites, getSetting, logDc } from "@/lib/donate"
import { rconExec } from "@/lib/rcon"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Колбэк голосования на мониторинге.
 *
 * Мониторинг дёргает этот URL, когда игрок проголосовал. Так как форматы у
 * мониторингов разные, ник и параметры принимаются под несколькими именами:
 *   ник:  nick | name | username | player | user
 *   сайт: site | id      (слаг мониторинга из настроек)
 *   ключ: key  | secret  (секрет vote_callback_key, если он задан)
 *
 * Пример URL, который надо указать в настройках мониторинга:
 *   https://politempire.ru/api/vote/callback?site=mcrate&nick={name}&key=СЕКРЕТ
 *
 * Логика: проверяем ключ → находим мониторинг → проверяем кулдаун → начисляем
 * бонус DC в общий журнал (bot_balance_log) → пишем строку в vote_log.
 * Всегда отвечаем 200 (кроме явной ошибки авторизации), чтобы мониторинг не
 * ретраил бесконечно.
 */

function pick(params: URLSearchParams, keys: string[]): string {
  for (const k of keys) {
    const v = params.get(k)
    if (v && v.trim()) return v.trim()
  }
  return ""
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  let params = url.searchParams

  // Если POST с телом form-urlencoded или JSON — доклеиваем параметры оттуда.
  if (request.method === "POST") {
    const ct = request.headers.get("content-type") || ""
    try {
      if (ct.includes("application/json")) {
        const body = (await request.json()) as Record<string, unknown>
        const merged = new URLSearchParams(params)
        for (const [k, v] of Object.entries(body)) merged.set(k, String(v))
        params = merged
      } else if (ct.includes("form")) {
        const form = await request.formData()
        const merged = new URLSearchParams(params)
        for (const [k, v] of form.entries()) merged.set(k, String(v))
        params = merged
      }
    } catch {
      // тело не распарсилось — работаем с query-параметрами
    }
  }

  const siteId = pick(params, ["site", "id"])
  const nick = pick(params, ["nick", "name", "username", "player", "user"])
  const key = pick(params, ["key", "secret"])

  if (!siteId || !nick) {
    return Response.json({ ok: false, error: "site и nick обязательны" }, { status: 400 })
  }

  const sites = await getVoteSites()
  const site = sites.find((s) => s.id === siteId)
  if (!site) {
    return Response.json({ ok: false, error: "мониторинг не найден" }, { status: 404 })
  }

  if (site.mode === "script") {
    // Подписанный webhook (HotMC и совместимые): мониторинг присылает
    // username, time и sign = MD5(username|time|secret).
    const time = pick(params, ["time"])
    const sign = pick(params, ["sign"]).toLowerCase()
    if (!site.secret || !time || !sign) {
      return Response.json({ ok: false, error: "не настроен или не передан секрет мониторинга" }, { status: 403 })
    }
    const expected = createHash("md5").update(`${nick}|${time}|${site.secret}`, "utf8").digest("hex")
    const actualBuffer = Buffer.from(sign, "utf8")
    const expectedBuffer = Buffer.from(expected, "utf8")
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
      return Response.json({ ok: false, error: "неверная подпись" }, { status: 403 })
    }
  } else {
    // Обычный режим: мониторинг дёргает URL с общим секретным ключом.
    const expectedKey = (await getSetting("vote_callback_key", "")).trim()
    if (expectedKey && key !== expectedKey) {
      return Response.json({ ok: false, error: "неверный ключ" }, { status: 403 })
    }
  }

  const cooldownHours = Math.max(1, Number(await getSetting("vote_cooldown_hours", "24")) || 24)
  const db = getDb()

  // Кулдаун: нельзя получать бонус за один мониторинг чаще, чем раз в N часов.
  const [recent] = await db.query(
    `SELECT id FROM vote_log
      WHERE minecraft_nick = ? AND site_id = ? AND created_at > (NOW() - INTERVAL ? HOUR)
      LIMIT 1`,
    [nick, siteId, cooldownHours],
  )
  if ((recent as unknown[]).length > 0) {
    return Response.json({ ok: true, credited: false, reason: "cooldown" })
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null

  // Начисляем бонус (если > 0) и фиксируем голос.
  // Порядок как в админской выдаче: сперва журнал (источник правды для сайта,
  // мода и плейсхолдера %donatecoin%), затем best-effort RCON, чтобы монеты
  // появились и во внутриигровом плагине доната. Ошибка RCON не отменяет бонус.
  if (site.bonus > 0) {
    await logDc(nick, site.bonus, `Голос на мониторинге «${site.name}»`, "vote")
    try {
      const tmpl = await getSetting("dc_rcon_template", "dc give {nick} {amount}")
      const cmd = tmpl.replace(/\{nick\}/g, nick).replace(/\{amount\}/g, String(site.bonus))
      await rconExec([cmd])
    } catch (err) {
      console.log("[v0] vote RCON give failed:", (err as Error).message)
    }
  }
  await db.query(
    `INSERT INTO vote_log (minecraft_nick, site_id, site_name, bonus, ip) VALUES (?, ?, ?, ?, ?)`,
    [nick, siteId, site.name, site.bonus, ip],
  )

  return Response.json({ ok: true, credited: true, bonus: site.bonus })
}

export async function GET(request: Request) {
  return handle(request)
}

export async function POST(request: Request) {
  return handle(request)
}
