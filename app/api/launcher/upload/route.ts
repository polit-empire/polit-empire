import fs from "fs"
import path from "path"
import { getDb } from "@/lib/db"
import { getLauncherDir } from "@/lib/manifest"
import { announceLauncherRelease } from "@/lib/discord"

/**
 * POST /api/launcher/upload
 *
 * Публикация новой версии лаунчера (авто-обновление).
 * Защищено токеном LAUNCHER_UPLOAD_TOKEN (заголовок Authorization: Bearer <token>).
 *
 * multipart/form-data:
 *   file      — собранный NSIS-инсталлер (.exe)
 *   version   — семвер новой версии, например "1.0.1"
 *   changelog — (необязательно) список изменений
 *
 * Удобнее всего пользоваться скриптом: node scripts/upload-launcher.mjs <file> <version>
 * После публикации все лаунчеры при следующем запуске сами скачают и
 * тихо установят обновление.
 */

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const token = process.env.LAUNCHER_UPLOAD_TOKEN
  if (!token) {
    return Response.json({ error: "LAUNCHER_UPLOAD_TOKEN не задан на сервере" }, { status: 500 })
  }
  const auth = request.headers.get("authorization") || ""
  if (auth !== `Bearer ${token}`) {
    return Response.json({ error: "Неверный токен" }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: "Ожидается multipart/form-data" }, { status: 400 })
  }

  const file = form.get("file")
  const version = String(form.get("version") || "").trim()
  const changelog = String(form.get("changelog") || "").trim()

  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Файл не передан" }, { status: 400 })
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return Response.json({ error: "Версия должна быть в формате X.Y.Z, например 1.0.1" }, { status: 400 })
  }

  const db = getDb()
  const [rows] = await db.query("SELECT id FROM launcher_versions WHERE version = ?", [version])
  if ((rows as unknown[]).length > 0) {
    return Response.json({ error: `Версия ${version} уже опубликована` }, { status: 409 })
  }

  // Сохраняем бинарник в STORAGE_DIR/launcher/
  const fileName = `PolitEmpireLauncher-Setup-${version}.exe`
  const dir = getLauncherDir()
  fs.mkdirSync(dir, { recursive: true })
  const buffer = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync(path.join(dir, fileName), buffer)

  // Активируем новую версию, деактивируем старые
  await db.query("UPDATE launcher_versions SET is_active = 0")
  await db.query(
    "INSERT INTO launcher_versions (version, changelog, file_name, file_size, is_active) VALUES (?, ?, ?, ?, 1)",
    [version, changelog || null, fileName, buffer.length],
  )

  // Анонс в дев-блог Discord с пингом @here. Сбой уведомления не должен
  // ронять публикацию — просто логируем и возвращаем статус клиенту.
  const announce = await announceLauncherRelease(version, changelog)
  if (!announce.ok) {
    console.error("[v0] launcher release announce failed:", announce.error)
  }

  return Response.json({ ok: true, version, fileName, fileSize: buffer.length, announced: announce.ok })
}
