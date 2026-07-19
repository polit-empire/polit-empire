import crypto from "crypto"

/**
 * Password hashing via scrypt (Node built-in, no external deps).
 * Stored format: scrypt$<salt hex>$<hash hex>
 */

const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto.scryptSync(password, salt, KEYLEN).toString("hex")
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const parts = stored.split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  const [, salt, expected] = parts
  try {
    const actual = crypto.scryptSync(password, salt, KEYLEN).toString("hex")
    return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
  } catch {
    return false
  }
}

/** Password policy: 6-64 chars, no spaces. */
export function isValidPassword(password: string): boolean {
  return password.length >= 6 && password.length <= 64 && !/\s/.test(password)
}
