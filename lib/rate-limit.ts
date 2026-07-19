/**
 * Simple in-memory sliding-window rate limiter.
 * Suitable for a single Node.js instance (Docker/VDS or one Vercel region instance).
 */

interface Bucket {
  timestamps: number[]
}

const buckets = new Map<string, Bucket>()

// Periodic cleanup to avoid unbounded growth
let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < 60_000) return
  lastCleanup = now
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs)
    if (bucket.timestamps.length === 0) buckets.delete(key)
  }
}

/**
 * Returns true if the request is allowed, false if rate limited.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  cleanup(windowMs)
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { timestamps: [] }
    buckets.set(key, bucket)
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs)
  if (bucket.timestamps.length >= limit) return false
  bucket.timestamps.push(now)
  return true
}

export function getClientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return request.headers.get("x-real-ip") || "unknown"
}

/** Helper: apply rate limit and return a 429 Response when exceeded, or null when allowed. */
export function checkRateLimit(request: Request, scope: string, limit: number, windowMs: number): Response | null {
  const ip = getClientIp(request)
  if (!rateLimit(`${scope}:${ip}`, limit, windowMs)) {
    console.warn(`[security] Rate limit exceeded: scope=${scope} ip=${ip}`)
    return Response.json({ error: "Too many requests" }, { status: 429 })
  }
  return null
}
