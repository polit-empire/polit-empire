import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"
import { rconExec } from "@/lib/rcon"
import { getSetting, logDc, getProduct } from "@/lib/donate"
import { banAccount, unbanAccount, banValue, unbanValue, type BanKind } from "@/lib/bans"
import { hashPassword, isValidPassword } from "@/lib/passwords"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Политика ников сайта (та же, что в TG-боте): 3-16 символов, буквы/цифры/_.
const NICK_RE = /^[a-zA-Z0-9_]{3,16}$/

// Таблицы бота, ключованные ником: при смене ника обновляем ссылки в них.
const NICK_LINKED_TABLES = [
  "bot_2fa",
  "bot_2fa_codes",
  "bot_discord_links",
  "bot_balance_log",
  "bot_referrals",
]

function fill(tmpl: string, vars: Record<string, string | number>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""))
}

/**
 * Единая точка для админ-действий над игроком:
 *  give_privilege | take_privilege | give_dc | take_dc | ban | unban | kick
 *  set_password | set_nick | delete_account
 */
export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = await req.json().catch(() => null)
  if (!b || typeof b.action !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }
  const action: string = b.action
  const db = getDb()

  // Баны по «сырому» значению (HWID / UUID / IP) не требуют выбора ника.
  const VALUE_KINDS: BanKind[] = ["hwid", "uuid", "ip"]
  try {
    if (action === "ban_value" || action === "unban_value") {
      const kind = b.kind as BanKind
      const value = typeof b.value === "string" ? b.value.trim() : ""
      if (!VALUE_KINDS.includes(kind) || !value) {
        return NextResponse.json({ error: "укажите тип (hwid/uuid/ip) и значение" }, { status: 400 })
      }
      if (action === "ban_value") {
        const reason = (b.reason as string) || "Нарушение правил"
        const nicks = await banValue(kind, value, reason)
        return NextResponse.json({
          ok: true,
          message:
            nicks.length > 0
              ? `Забанен ${kind.toUpperCase()} + аккаунты: ${nicks.join(", ")}`
              : `Забанен ${kind.toUpperCase()} (связанных аккаунтов не найдено)`,
        })
      }
      const removed = await unbanValue(kind, value)
      return NextResponse.json({
        ok: removed,
        message: removed ? `Снят бан ${kind.toUpperCase()}` : "Значение не найдено в чёрном списке",
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Остальные действия работают с конкретным игроком.
  if (typeof b.nick !== "string" || !b.nick.trim()) {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }
  const nick: string = b.nick.trim()

  try {
    switch (action) {
      case "give_privilege": {
        const productId = Number(b.product_id)
        const product = productId ? await getProduct(productId) : null
        const group = product?.group_name ?? b.group
        const days = product?.duration_days ?? (Number(b.days) || 30)
        if (!group) return NextResponse.json({ error: "не задана группа" }, { status: 400 })
        const tmpl =
          product?.rcon_command ||
          (await getSetting("privilege_rcon_template", "lp user {nick} parent addtemp {group} {days}d"))
        await rconExec([fill(tmpl, { nick, group, days })])
        const expires = new Date(Date.now() + days * 86_400_000)
        await db.query(
          `INSERT INTO donate_privileges (minecraft_nick, group_name, product_id, expires_at)
           VALUES (?, ?, ?, ?)`,
          [nick, group, product?.id ?? null, expires],
        )
        return NextResponse.json({ ok: true, message: `Выдана привилегия ${group} на ${days}д` })
      }
      case "take_privilege": {
        const group = b.group
        if (!group) return NextResponse.json({ error: "не задана группа" }, { status: 400 })
        const tmpl = await getSetting("privilege_take_template", "lp user {nick} parent remove {group}")
        await rconExec([fill(tmpl, { nick, group })])
        await db.query(
          "DELETE FROM donate_privileges WHERE minecraft_nick = ? AND group_name = ?",
          [nick, group],
        )
        return NextResponse.json({ ok: true, message: `Снята привилегия ${group}` })
      }
      case "give_dc": {
        const amount = Math.abs(Number(b.amount) || 0)
        if (amount <= 0) return NextResponse.json({ error: "сумма > 0" }, { status: 400 })
        const tmpl = await getSetting("dc_rcon_template", "dc give {nick} {amount}")
        await rconExec([fill(tmpl, { nick, amount })])
        await logDc(nick, amount, `Выдача админом (${admin.minecraft_nick})`, admin.minecraft_nick)
        return NextResponse.json({ ok: true, message: `Выдано ${amount} DC` })
      }
      case "take_dc": {
        const amount = Math.abs(Number(b.amount) || 0)
        if (amount <= 0) return NextResponse.json({ error: "сумма > 0" }, { status: 400 })
        const tmpl = await getSetting("dc_take_template", "dc take {nick} {amount}")
        await rconExec([fill(tmpl, { nick, amount })])
        await logDc(nick, -amount, `Списание админом (${admin.minecraft_nick})`, admin.minecraft_nick)
        return NextResponse.json({ ok: true, message: `Списано ${amount} DC` })
      }
      case "ban": {
        const reason = (b.reason as string) || "Нарушение правил"
        const withHwid = Boolean(b.hwid)
        await banAccount(nick, reason, { withHwid })
        return NextResponse.json({
          ok: true,
          message: withHwid ? `${nick} забанен вместе с устройством` : `${nick} забанен`,
        })
      }
      case "unban": {
        await unbanAccount(nick)
        return NextResponse.json({ ok: true, message: `${nick} разбанен` })
      }
      case "kick": {
        const reason = (b.reason as string) || "Кик администратором"
        await rconExec([`kick ${nick} ${reason}`])
        return NextResponse.json({ ok: true, message: `${nick} кикнут` })
      }
      case "set_password": {
        const password = typeof b.password === "string" ? b.password : ""
        if (!isValidPassword(password)) {
          return NextResponse.json({ error: "Пароль: 6-64 символа без пробелов" }, { status: 400 })
        }
        const [rows] = await db.query("SELECT minecraft_nick FROM users WHERE minecraft_nick = ?", [nick])
        if ((rows as unknown[]).length === 0) {
          return NextResponse.json({ error: "Игрок не найден" }, { status: 404 })
        }
        await db.query("UPDATE users SET password_hash = ? WHERE minecraft_nick = ?", [hashPassword(password), nick])
        return NextResponse.json({ ok: true, message: `Пароль игрока ${nick} изменён` })
      }
      case "set_nick": {
        const newNick = typeof b.new_nick === "string" ? b.new_nick.trim() : ""
        if (!NICK_RE.test(newNick)) {
          return NextResponse.json({ error: "Ник: 3-16 символов, буквы/цифры/_" }, { status: 400 })
        }
        if (newNick === nick) {
          return NextResponse.json({ error: "Новый ник совпадает с текущим" }, { status: 400 })
        }
        const [exists] = await db.query("SELECT minecraft_nick FROM users WHERE minecraft_nick = ?", [newNick])
        if ((exists as unknown[]).length > 0) {
          return NextResponse.json({ error: "Этот ник уже занят" }, { status: 409 })
        }
        const [cur] = await db.query("SELECT minecraft_nick FROM users WHERE minecraft_nick = ?", [nick])
        if ((cur as unknown[]).length === 0) {
          return NextResponse.json({ error: "Игрок не найден" }, { status: 404 })
        }
        await db.query("UPDATE users SET minecraft_nick = ? WHERE minecraft_nick = ?", [newNick, nick])
        // Обновляем ссылки в связанных таблицах бота (best-effort).
        for (const table of NICK_LINKED_TABLES) {
          try {
            await db.query(`UPDATE ${table} SET mc_username = ? WHERE mc_username = ?`, [newNick, nick])
          } catch {
            // Таблица может отсутствовать — не критично.
          }
        }
        return NextResponse.json({ ok: true, message: `Ник изменён: ${nick} → ${newNick}`, new_nick: newNick })
      }
      case "delete_account": {
        const [rows] = await db.query("SELECT minecraft_nick FROM users WHERE minecraft_nick = ?", [nick])
        if ((rows as unknown[]).length === 0) {
          return NextResponse.json({ error: "Игрок не найден" }, { status: 404 })
        }
        await db.query("DELETE FROM users WHERE minecraft_nick = ?", [nick])
        return NextResponse.json({ ok: true, message: `Аккаунт ${nick} удалён` })
      }
      default:
        return NextResponse.json({ error: "неизвестное действие" }, { status: 400 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `RCON: ${msg}` }, { status: 502 })
  }
}
