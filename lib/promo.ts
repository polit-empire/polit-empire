import crypto from "crypto"
import { getDb } from "@/lib/db"

/* ------------------------------------------------------------------ */
/* Типы                                                                */
/* ------------------------------------------------------------------ */

export interface PromoCode {
  id: number
  code: string
  discount_type: "percent" | "fixed"
  discount_value: number
  max_uses: number
  used_count: number
  min_amount_rub: number
  product_ids: string | null
  expires_at: Date | null
  is_active: number
  created_at: Date
}

export interface PromoValidation {
  ok: boolean
  error?: string
  discount_type?: "percent" | "fixed"
  discount_value?: number
  discountAmount?: number
}

/* ------------------------------------------------------------------ */
/* Генерация кода                                                      */
/* ------------------------------------------------------------------ */

function generateCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = crypto.randomBytes(length)
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function listPromoCodes(): Promise<PromoCode[]> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM promo_codes ORDER BY created_at DESC")
  return rows as PromoCode[]
}

export async function getPromoCode(id: number): Promise<PromoCode | null> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM promo_codes WHERE id = ? LIMIT 1", [id])
  const list = rows as PromoCode[]
  return list.length > 0 ? list[0] : null
}

export async function getPromoByCode(code: string): Promise<PromoCode | null> {
  const db = getDb()
  const [rows] = await db.query("SELECT * FROM promo_codes WHERE code = ? LIMIT 1", [code.toUpperCase()])
  const list = rows as PromoCode[]
  return list.length > 0 ? list[0] : null
}

export async function createPromoCode(opts: {
  code?: string
  discount_type: "percent" | "fixed"
  discount_value: number
  max_uses?: number
  min_amount_rub?: number
  product_ids?: string | null
  expires_at?: Date | null
  is_active?: number
  length?: number
}): Promise<PromoCode> {
  const db = getDb()
  const code = opts.code
    ? opts.code.toUpperCase().trim()
    : generateCode(opts.length || 8)

  const [res] = await db.query(
    `INSERT INTO promo_codes (code, discount_type, discount_value, max_uses, min_amount_rub, product_ids, expires_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code,
      opts.discount_type,
      opts.discount_value,
      opts.max_uses ?? 0,
      opts.min_amount_rub ?? 0,
      opts.product_ids ?? null,
      opts.expires_at ?? null,
      opts.is_active ?? 1,
    ],
  )

  return (await getPromoCode((res as { insertId: number }).insertId))!
}

export async function updatePromoCode(
  id: number,
  data: Partial<{
    code: string
    discount_type: "percent" | "fixed"
    discount_value: number
    max_uses: number
    min_amount_rub: number
    product_ids: string | null
    expires_at: Date | null
    is_active: number
  }>,
): Promise<void> {
  const db = getDb()
  const sets: string[] = []
  const values: unknown[] = []

  if (data.code !== undefined) {
    sets.push("code = ?")
    values.push(data.code.toUpperCase().trim())
  }
  if (data.discount_type !== undefined) {
    sets.push("discount_type = ?")
    values.push(data.discount_type)
  }
  if (data.discount_value !== undefined) {
    sets.push("discount_value = ?")
    values.push(data.discount_value)
  }
  if (data.max_uses !== undefined) {
    sets.push("max_uses = ?")
    values.push(data.max_uses)
  }
  if (data.min_amount_rub !== undefined) {
    sets.push("min_amount_rub = ?")
    values.push(data.min_amount_rub)
  }
  if (data.product_ids !== undefined) {
    sets.push("product_ids = ?")
    values.push(data.product_ids)
  }
  if (data.expires_at !== undefined) {
    sets.push("expires_at = ?")
    values.push(data.expires_at)
  }
  if (data.is_active !== undefined) {
    sets.push("is_active = ?")
    values.push(data.is_active ? 1 : 0)
  }

  if (sets.length === 0) return
  values.push(id)
  await db.query(`UPDATE promo_codes SET ${sets.join(", ")} WHERE id = ?`, values)
}

export async function deletePromoCode(id: number): Promise<void> {
  const db = getDb()
  await db.query("DELETE FROM promo_codes WHERE id = ?", [id])
  await db.query("DELETE FROM promo_code_usage WHERE promo_id = ?", [id])
}

/* ------------------------------------------------------------------ */
/* Валидация и применение                                              */
/* ------------------------------------------------------------------ */

export async function validatePromoCode(
  code: string,
  nick: string,
  amountRub: number,
  productId?: number,
): Promise<PromoValidation> {
  const promo = await getPromoByCode(code)
  if (!promo) return { ok: false, error: "Промокод не найден" }
  if (promo.is_active !== 1) return { ok: false, error: "Промокод деактивирован" }
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return { ok: false, error: "Срок действия промокода истёк" }
  }
  if (promo.max_uses > 0 && promo.used_count >= promo.max_uses) {
    return { ok: false, error: "Промокод исчерпан" }
  }
  if (promo.min_amount_rub > 0 && amountRub < promo.min_amount_rub) {
    return {
      ok: false,
      error: `Минимальная сумма заказа для этого промокода: ${promo.min_amount_rub} ₽`,
    }
  }

  // Проверка привязки к конкретным товарам
  if (promo.product_ids && productId) {
    const allowed = promo.product_ids.split(",").map((s) => Number(s.trim()))
    if (!allowed.includes(productId)) {
      return { ok: false, error: "Промокод не действует на этот товар" }
    }
  } else if (promo.product_ids && !productId) {
    return { ok: false, error: "Промокод действует только на конкретные товары" }
  }

  // Проверка: сколько раз этот игрок уже использовал промокод
  const db = getDb()
  const [usageRows] = await db.query(
    "SELECT COUNT(*) AS c FROM promo_code_usage WHERE promo_id = ? AND minecraft_nick = ?",
    [promo.id, nick],
  )
  const playerUses = (usageRows as Array<{ c: number }>)[0]?.c ?? 0

  // max_uses = общее ограничение; для проверки по игроку используем отдельное
  // ограничение через поле max_uses. Пока считаем: если max_uses > 0 и игрок
  // использовал >= max_uses — запрещаем.
  if (promo.max_uses > 0 && playerUses >= promo.max_uses) {
    return { ok: false, error: "Вы уже использовали этот промокод максимальное количество раз" }
  }

  // Вычисляем скидку
  let discountAmount = 0
  if (promo.discount_type === "percent") {
    discountAmount = Math.floor((amountRub * promo.discount_value) / 100)
  } else {
    discountAmount = Math.min(promo.discount_value, amountRub)
  }

  return {
    ok: true,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    discountAmount,
  }
}

/** Записать использование промокода и увеличить счётчик. */
export async function recordPromoUse(
  promoId: number,
  nick: string,
  orderId: number,
): Promise<void> {
  const db = getDb()
  await db.query(
    "INSERT INTO promo_code_usage (promo_id, minecraft_nick, order_id) VALUES (?, ?, ?)",
    [promoId, nick, orderId],
  )
  await db.query(
    "UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ?",
    [promoId],
  )
}

/** Сгенерировать промокоды пачкой. */
export async function batchCreatePromoCodes(
  count: number,
  opts: {
    discount_type: "percent" | "fixed"
    discount_value: number
    max_uses?: number
    min_amount_rub?: number
    product_ids?: string | null
    expires_at?: Date | null
    length?: number
  },
): Promise<string[]> {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const promo = await createPromoCode(opts)
    codes.push(promo.code)
  }
  return codes
}
