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
  const osType = new URL(request.url).searchParams.get("os")
  const extParam = new URL(request.url).searchParams.get("ext")
  
  let extFilter = "LIKE '%.exe'" // По умолчанию Windows
  let label = "Windows (.exe)"
  
  if (extParam) {
    const safeExt = extParam.replace(/[^a-zA-Z0-9]/g, "")
    extFilter = `LIKE '%.${safeExt}'`
    label = safeExt
  } else if (osType === "linux") {
    extFilter = "NOT LIKE '%.exe'"
    label = "Linux (любой)"
  }
  
  const [rows] = await db.query(
    `SELECT file_name, file_size FROM launcher_versions WHERE is_active = 1 AND file_name ${extFilter} ORDER BY id DESC LIMIT 1`
  )
  const versions = rows as { file_name: string; file_size: number }[]
  if (versions.length === 0) {
    return Response.json({ error: `Бинарник для ${label} не найден` }, { status: 404 })
  }

  const fileName = path.basename(versions[0].file_name) // защита от traversal
  const absolute = path.join(getLauncherDir(), fileName)
  if (!fs.existsSync(absolute)) {
    return Response.json({ error: "Файл отсутствует на сервере" }, { status: 404 })
  }

  const stat = fs.statSync(absolute)

  // Докачка (Range): у части игроков (Cloudflare WARP, ТСПУ/DPI) соединение
  // рвётся в середине файла. Лаунчер переспрашивает файл с Range — отдаём
  // 206 Partial Content с точным смещением, иначе каждый ретрай качал бы
  // установщик с нуля.
  const rangeHeader = request.headers.get("range")
  const range = rangeHeader ? parseRange(rangeHeader, stat.size) : null
  if (rangeHeader && !range) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}`, "Accept-Ranges": "bytes" } })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? stat.size - 1
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(end - start + 1),
    "Accept-Ranges": "bytes",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
  }
  if (range) {
    headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`
  }
  const stream = Readable.toWeb(fs.createReadStream(absolute, { start, end })) as ReadableStream
  return new Response(stream, {
    status: range ? 206 : 200,
    headers,
  })
}

function parseRange(
  header: string,
  size: number
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  if (m[1] === "") {
    // Суффикс: последние N байт.
    if (m[2] === "") return null
    const suffix = Number(m[2])
    if (!Number.isInteger(suffix) || suffix <= 0) return null
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  let start = Number(m[1])
  if (!Number.isInteger(start) || start < 0) return null
  if (start >= size) return null
  let end = m[2] === "" ? size - 1 : Number(m[2])
  if (!Number.isInteger(end)) return null
  if (start > end) return null
  return { start, end: Math.min(end, size - 1) }
}
