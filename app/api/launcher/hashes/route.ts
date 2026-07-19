import { z } from "zod"
import { getDb } from "@/lib/db"

/**
 * Управление белым списком хешей официальных сборок лаунчера (self-integrity).
 * Защищено тем же токеном, что и публикация лаунчера — LAUNCHER_UPLOAD_TOKEN
 * (Authorization: Bearer <token>). Вызывается с билд-машины при релизе
 * (см. scripts/register-launcher-hash.mjs).
 *
 *  POST /api/launcher/hashes   — зарегистрировать эталонный хеш
 *      тело: { sha256, version?, label?, deactivateOthers? }
 *      deactivateOthers=true снимает is_active со всех прежних хешей
 *      (удобно, если действует ровно одна текущая сборка).
 *
 *  GET  /api/launcher/hashes   — список зарегистрированных хешей
 */

export const dynamic = "force-dynamic"

function authorize(request: Request): Response | null {
  const token = process.env.LAUNCHER_UPLOAD_TOKEN
  if (!token) {
    return Response.json({ error: "LAUNCHER_UPLOAD_TOKEN не задан на сервере" }, { status: 500 })
  }
  const auth = request.headers.get("authorization") || ""
  if (auth !== `Bearer ${token}`) {
    return Response.json({ error: "Неверный токен" }, { status: 401 })
  }
  return null
}

const postSchema = z.object({
  sha256: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{64}$/, "sha256 должен быть 64 hex-символа"),
  version: z.string().max(32).optional(),
  label: z.string().max(128).optional(),
  deactivateOthers: z.boolean().optional(),
})

export async function POST(request: Request) {
  const denied = authorize(request)
  if (denied) return denied

  let parsed
  try {
    parsed = postSchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Ожидается JSON" }, { status: 400 })
  }
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 })
  }

  const { sha256, version, label, deactivateOthers } = parsed.data
  const db = getDb()

  if (deactivateOthers) {
    await db.query("UPDATE launcher_hashes SET is_active = 0")
  }

  // Upsert по уникальному sha256: повторная регистрация переактивирует запись.
  await db.query(
    `INSERT INTO launcher_hashes (sha256, version, label, is_active)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE version = VALUES(version), label = VALUES(label), is_active = 1`,
    [sha256, version ?? null, label ?? null],
  )

  return Response.json({ ok: true, sha256, version: version ?? null, deactivatedOthers: !!deactivateOthers })
}

export async function GET(request: Request) {
  const denied = authorize(request)
  if (denied) return denied

  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, sha256, version, label, is_active, created_at FROM launcher_hashes ORDER BY id DESC",
  )
  return Response.json({ hashes: rows })
}
