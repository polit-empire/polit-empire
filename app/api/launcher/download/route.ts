import fs from "fs"
import path from "path"
import { Readable } from "stream"
import { getDb } from "@/lib/db"
import { getLauncherDir } from "@/lib/manifest"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/launcher/download
 * Stream the active launcher binary.
 */
export async function GET(request: Request) {
  const limited = checkRateLimit(request, "launcher-download", 10, 60_000)
  if (limited) return limited

  const db = getDb()
  const [rows] = await db.query(
    "SELECT file_name, file_size FROM launcher_versions WHERE is_active = 1 ORDER BY id DESC LIMIT 1"
  )
  const versions = rows as { file_name: string; file_size: number }[]
  if (versions.length === 0) {
    return Response.json({ error: "Бинарник не найден" }, { status: 404 })
  }

  const fileName = path.basename(versions[0].file_name) // защита от traversal
  const absolute = path.join(getLauncherDir(), fileName)
  if (!fs.existsSync(absolute)) {
    return Response.json({ error: "Файл отсутствует на сервере" }, { status: 404 })
  }

  const stat = fs.statSync(absolute)
  const stream = Readable.toWeb(fs.createReadStream(absolute)) as ReadableStream
  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    },
  })
}
