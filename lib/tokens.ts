import crypto from "crypto"

/** Generate a random raw API token (returned to the client once). */
export function generateApiToken(): string {
  return crypto.randomBytes(32).toString("hex") // 64 hex chars
}

/** SHA256 hash used for storing tokens in the database. */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex")
}

/** Generate a one-time 6-digit login code. */
export function generateLoginCode(): string {
  return String(crypto.randomInt(100000, 1000000))
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}
