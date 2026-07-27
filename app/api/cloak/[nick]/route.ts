import fs from "fs"
import path from "path"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/cloak/<nick>  (also accepts <nick>.png)
 * Публичный эндпоинт плащей — аналог /api/skins/<nick>.
 *
 * Плащи лежат в {STORAGE_DIR}/cloaks/<nick>.png. Плащ есть далеко не у
 * каждого игрока, поэтому «нет плаща» — штатный ответ, а не ошибка: отдаём
 * пустой 204 с Cache-Control, чтобы клиент закешировал отрицательный ответ
 * и не перезапрашивал по кругу. Раньше сюда отдавался HTML-404 (~17 КБ),
 * который клиенты не кешируют — это давало десятки тысяч запросов в сутки
 * и сотни мегабайт в access.log.
 */
export async function GET(request: Request, { params }: { params: Promise<{ nick: string }> }) {
  const limited = checkRateLimit(request, "cloak-get", 120, 60_000)
  if (limited) return limited

  const { nick: rawNick } = await params
  const nick = decodeURIComponent(rawNick).replace(/\.png$/i, "")

  const notFound = new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  })

  if (!/^[A-Za-z0-9_]{3,32}$/.test(nick)) return notFound

  const base = process.env.STORAGE_DIR || "/opt/polit-empire/sborka"
  const file = path.join(base, "cloaks", `${nick}.png`)
  if (!fs.existsSync(file)) return notFound

  const data = fs.readFileSync(file)
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  })
}
