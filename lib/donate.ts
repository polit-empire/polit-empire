import { getDb } from "@/lib/db"
import { rconExec } from "@/lib/rcon"

/* ------------------------------------------------------------------ */
/* Типы                                                                */
/* ------------------------------------------------------------------ */

export interface DonateProduct {
  id: number
  kind: "privilege" | "dc" | "item" | "other"
  name: string
  description: string | null
  price_rub: number
  group_name: string | null
  duration_days: number
  dc_amount: number
  rcon_command: string | null
  accent: string
  sort_order: number
  is_active: number
  /** Id предмета Minecraft для иконки в моде (например "minecraft:diamond"). */
  icon_item: string | null
}

export interface DonateOrder {
  id: number
  minecraft_nick: string
  product_id: number | null
  kind: string
  title: string
  amount_rub: number
  dc_amount: number
  method: string
  status: string
  payment_ref: string | null
  pay_url: string | null
  note: string | null
  created_at: Date
  paid_at: Date | null
  delivered_at: Date | null
}

export interface ActivePrivilege {
  group_name: string
  expires_at: Date | null
  granted_at: Date
}

/* ------------------------------------------------------------------ */
/* Настройки                                                           */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<Record<string, string>> {
  const db = getDb()
  const [rows] = await db.query("SELECT skey, svalue FROM site_settings")
  const out: Record<string, string> = {}
  for (const r of rows as Array<{ skey: string; svalue: string | null }>) {
    out[r.skey] = r.svalue ?? ""
  }
  return out
}

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const db = getDb()
  const [rows] = await db.query("SELECT svalue FROM site_settings WHERE skey = ? LIMIT 1", [key])
  const row = (rows as Array<{ svalue: string | null }>)[0]
  return row?.svalue ?? fallback
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = getDb()
  await db.query(
    "INSERT INTO site_settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)",
    [key, value],
  )
}

/* ------------------------------------------------------------------ */
/* DC-баланс (журнал bot_balance_log, общий с ботом)                    */
/* ------------------------------------------------------------------ */

export async function getDcBalance(nick: string): Promise<number> {
  const db = getDb()
  const [rows] = await db.query(
    "SELECT COALESCE(SUM(amount), 0) AS bal FROM bot_balance_log WHERE mc_username = ?",
    [nick],
  )
  return Number((rows as Array<{ bal: number }>)[0]?.bal ?? 0)
}

/** Начисляет/списывает DC в журнале (не трогает игру). amount может быть < 0. */
export async function logDc(nick: string, amount: number, reason: string, actor = "site"): Promise<void> {
  const db = getDb()
  await db.query(
    "INSERT INTO bot_balance_log (mc_username, amount, reason, actor) VALUES (?, ?, ?, ?)",
    [nick, amount, reason, actor],
  )
}

/* ------------------------------------------------------------------ */
/* Мониторинги (бонус DC за голос)                                      */
/* ------------------------------------------------------------------ */

export interface VoteSite {
  /** Слаг мониторинга, используется в URL колбэка (?site=<id>). */
  id: string
  /** Отображаемое название (например «McRate»). */
  name: string
  /** Ссылка на страницу голосования. */
  url: string
  /** Сколько DC начислять за голос. */
  bonus: number
  /** Секрет мониторинга для проверки подписанного webhook (например HotMC). */
  secret: string
  /**
   * Режим приёма голосов:
   *  • "url"    — обычный колбэк: мониторинг дёргает URL с ником и общим ключом.
   *  • "script" — подписанный webhook (как HotMC): проверяем MD5(nick|time|secret).
   */
  mode: "url" | "script"
}

/** Список мониторингов из настроек (безопасно парсит JSON, отсеивает мусор). */
export async function getVoteSites(): Promise<VoteSite[]> {
  const raw = await getSetting("vote_sites", "[]")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || "[]")
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      const id = String(s.id ?? "").trim()
      // Обратная совместимость: у старых записей нет mode. HotMC (по слагу)
      // считаем скриптовым, остальные — обычными.
      const rawMode = String(s.mode ?? "").trim()
      const mode: "url" | "script" =
        rawMode === "script" || rawMode === "url"
          ? rawMode
          : id.toLowerCase() === "hotmc"
            ? "script"
            : "url"
      return {
        id,
        name: String(s.name ?? "").trim(),
        url: String(s.url ?? "").trim(),
        bonus: Math.max(0, Math.floor(Number(s.bonus ?? 0)) || 0),
        secret: String(s.secret ?? "").trim(),
        mode,
      }
    })
    .filter((s) => s.id && s.name)
}

/** Бонус DC при пополнении: если сумма >= порога, начисляется процент сверху. */
export async function computeDcBonus(amount: number): Promise<number> {
  const threshold = Number(await getSetting("dc_bonus_threshold", "250"))
  const percent = Number(await getSetting("dc_bonus_percent", "10"))
  if (amount >= threshold && percent > 0) {
    return Math.floor((amount * percent) / 100)
  }
  return 0
}

/* ------------------------------------------------------------------ */
/* Товары                                                              */
/* ------------------------------------------------------------------ */

export async function listProducts(activeOnly = true): Promise<DonateProduct[]> {
  const db = getDb()
  const where = activeOnly ? "WHERE is_active = 1" : ""
  const [rows] = await db.query(
    `SELECT * FROM donate_products ${where} ORDER BY sort_order ASC, id ASC`,
  )
  return rows as DonateProduct[]
}

export async function getProduct(id: number): Promise<DonateProduct | null> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM donate_products WHERE id = ? LIMIT 1", [id])
  const list = rows as DonateProduct[]
  return list.length > 0 ? list[0] : null
}

/* ------------------------------------------------------------------ */
/* Активная привилегия игрока                                          */
/* ------------------------------------------------------------------ */

/** Самая «высокая» действующая привилегия (последняя выданная, не истёкшая). */
export async function getActivePrivilege(nick: string): Promise<ActivePrivilege | null> {
  const db = getDb()
  const [rows] = await db.query(
    `SELECT group_name, expires_at, granted_at FROM donate_privileges
     WHERE minecraft_nick = ? AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY granted_at DESC LIMIT 1`,
    [nick],
  )
  const list = rows as ActivePrivilege[]
  return list.length > 0 ? list[0] : null
}

/* ------------------------------------------------------------------ */
/* Заказы                                                              */
/* ------------------------------------------------------------------ */

export async function createOrder(o: {
  nick: string
  productId: number | null
  kind: string
  title: string
  amountRub: number
  dcAmount: number
  method: string
  status?: string
  paymentRef?: string | null
  payUrl?: string | null
  note?: string | null
}): Promise<number> {
  const db = getDb()
  const [res] = await db.query(
    `INSERT INTO donate_orders
       (minecraft_nick, product_id, kind, title, amount_rub, dc_amount, method, status, payment_ref, pay_url, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      o.nick,
      o.productId,
      o.kind,
      o.title,
      o.amountRub,
      o.dcAmount,
      o.method,
      o.status ?? "pending",
      o.paymentRef ?? null,
      o.payUrl ?? null,
      o.note ?? null,
    ],
  )
  return (res as { insertId: number }).insertId
}

/**
 * Отменяет заказ. Игрок может отменить только свой заказ в статусе pending.
 * Возвращает false, если заказ не найден/чужой/нельзя отменить.
 * Если nick не передан (отмена админом) — ограничение по владельцу снимается.
 */
export async function cancelOrder(orderId: number, nick?: string): Promise<boolean> {
  const order = await getOrder(orderId)
  if (!order) return false
  if (nick && order.minecraft_nick !== nick) return false
  // Выданные заказы отменять нельзя; админ может отменить и оплаченный (не выданный).
  const cancelable = nick ? order.status === "pending" : order.status !== "delivered"
  if (!cancelable) return false
  const db = getDb()
  await db.query("UPDATE donate_orders SET status = 'canceled' WHERE id = ?", [orderId])
  return true
}

export async function getOrder(id: number): Promise<DonateOrder | null> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM donate_orders WHERE id = ? LIMIT 1", [id])
  const list = rows as DonateOrder[]
  return list.length > 0 ? list[0] : null
}

export async function listOrders(nick?: string, limit = 50): Promise<DonateOrder[]> {
  const db = getDb()
  if (nick) {
    const [rows] = await db.query(
      "SELECT * FROM donate_orders WHERE minecraft_nick = ? ORDER BY created_at DESC LIMIT ?",
      [nick, limit],
    )
    return rows as DonateOrder[]
  }
  const [rows] = await db.query("SELECT * FROM donate_orders ORDER BY created_at DESC LIMIT ?", [limit])
  return rows as DonateOrder[]
}

/* ------------------------------------------------------------------ */
/* Доставка заказа через RCON                                          */
/* ------------------------------------------------------------------ */

/** Подставляет плейсхолдеры в шаблон RCON-команды. */
function fillTemplate(tmpl: string, vars: Record<string, string | number>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""))
}

/**
 * Выдаёт содержимое заказа на игровом сервере по RCON и помечает его
 * доставленным. Идемпотентно: повторная доставка уже доставленного заказа
 * пропускается. Бросает ошибку, если RCON недоступен (заказ останется 'paid').
 */
export async function deliverOrder(
  orderId: number,
  actor = "site",
  opts: { skipRcon?: boolean } = {},
): Promise<void> {
  const db = getDb()
  const order = await getOrder(orderId)
  if (!order) throw new Error("Заказ не найден")
  if (order.status === "delivered") return

  const commands: string[] = []
  let group: string | null = null
  let expiresAt: Date | null = null

  if (order.kind === "privilege") {
    const product = order.product_id ? await getProduct(order.product_id) : null
    group = product?.group_name ?? null
    const days = product?.duration_days ?? 30
    const tmpl =
      product?.rcon_command ||
      (await getSetting("privilege_rcon_template", "lp user {nick} parent addtemp {group} {days}d"))
    if (!group) throw new Error("У товара не задана группа привилегии")
    commands.push(fillTemplate(tmpl, { nick: order.minecraft_nick, group, days }))
    expiresAt = new Date(Date.now() + days * 86_400_000)
  } else if (order.kind === "dc") {
    const tmpl = await getSetting("dc_rcon_template", "dc give {nick} {amount}")
    commands.push(fillTemplate(tmpl, { nick: order.minecraft_nick, amount: order.dc_amount }))
  } else if (order.kind === "item" || order.kind === "other") {
    // Предмет или Другое: выдаём командой из товара.
    const product = order.product_id ? await getProduct(order.product_id) : null
    let tmpl = product?.rcon_command || ""
    const vars: Record<string, string | number> = {
      nick: order.minecraft_nick,
      item: product?.icon_item ?? "minecraft:stone",
      count: 1,
      amount: order.dc_amount,
      group: product?.group_name ?? "",
      days: product?.duration_days ?? 0,
    }
    if (!tmpl && order.kind === "item") {
      tmpl = await getSetting("item_rcon_template", "give {nick} {item} {count}")
    }
    if (tmpl) {
      commands.push(fillTemplate(tmpl, vars))
    }
  }

  // skipRcon: выдачу в игре делает внешняя система (например плагин
  // доната по команде dc give). Сайт только фиксирует эффект в БД.
  if (commands.length > 0 && !opts.skipRcon) {
    await rconExec(commands)
  }

  // Записываем эффекты в БД: DC — в журнал, привилегию — в активные.
  if (order.kind === "dc" && order.dc_amount > 0) {
    await logDc(order.minecraft_nick, order.dc_amount, `Заказ #${order.id}: ${order.title}`, actor)
  }
  if (order.kind === "privilege" && group) {
    await db.query(
      `INSERT INTO donate_privileges (minecraft_nick, group_name, product_id, order_id, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [order.minecraft_nick, group, order.product_id, order.id, expiresAt],
    )
  }

  await db.query(
    "UPDATE donate_orders SET status = 'delivered', delivered_at = NOW(), paid_at = COALESCE(paid_at, NOW()) WHERE id = ?",
    [orderId],
  )
}
