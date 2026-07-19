import fs from "fs"
import path from "path"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * GET /api/skins/<nick>  (also accepts <nick>.png)
 * Public skin endpoint — used by SkinsRestorer on the game server
 * and by the launcher for preview.
 */
export async function GET(request: Request, { params }: { params: Promise<{ nick: string }> }) {
  const limited = checkRateLimit(request, "skin-get", 120, 60_000)
  if (limited) return limited

  const { nick: rawNick } = await params
  const nick = decodeURIComponent(rawNick).replace(/\.png$/i, "")
  if (!/^[A-Za-z0-9_]{3,32}$/.test(nick)) {
    return Response.json({ error: "Некорректный ник" }, { status: 400 })
  }

  const base = process.env.STORAGE_DIR || "/opt/polit-empire/sborka"
  const file = path.join(base, "skins", `${nick}.png`)
  if (!fs.existsSync(file)) {
    return Response.json({ error: "Скин не найден" }, { status: 404 })
  }

  const data = fs.readFileSync(file)
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(data.length),
      "Cache-Control": "public, max-age=60",
      // Лаунчер грузит скин в WebGL-текстуру (skinview3d) из вебвью, а это
      // кросс-оригин запрос к домену сайта. Без CORS браузер помечает текстуру
      // как tainted и загрузка падает — поэтому разрешаем доступ отовсюду.
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
    },
  })
}
