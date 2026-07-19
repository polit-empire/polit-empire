import fs from "fs"
import path from "path"
import { authenticatePlayer, unauthorized } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

const MAX_SKIN_BYTES = 128 * 1024 // 128 КБ с запасом (обычный скин ~2-8 КБ)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function skinsDir(): string {
  const base = process.env.STORAGE_DIR || "/opt/polit-empire/sborka"
  return path.join(base, "skins")
}

/** Validates PNG signature and reads width/height from the IHDR chunk. */
function parsePngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 33) return null
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return null
  // IHDR всегда первый чанк: длина (4) + "IHDR" (4) начинаются с офсета 8
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  return { width, height }
}

/**
 * POST /api/skin
 * Upload the player's skin (raw PNG in the request body).
 * Auth: player api_token (Bearer). 64x64 or 64x32 PNG only.
 */
export async function POST(request: Request) {
  const limited = checkRateLimit(request, "skin-upload", 10, 60_000)
  if (limited) return limited

  const user = await authenticatePlayer(request)
  if (!user) return unauthorized()
  if (user.is_banned === 1) {
    return Response.json({ error: "Аккаунт заблокирован" }, { status: 403 })
  }

  const raw = Buffer.from(await request.arrayBuffer())
  if (raw.length === 0) {
    return Response.json({ error: "Пустой файл" }, { status: 400 })
  }
  if (raw.length > MAX_SKIN_BYTES) {
    return Response.json({ error: "Файл слишком большой (максимум 128 КБ)" }, { status: 400 })
  }

  const size = parsePngSize(raw)
  if (!size) {
    return Response.json({ error: "Файл должен быть корректным PNG" }, { status: 400 })
  }
  const validSize =
    (size.width === 64 && size.height === 64) || (size.width === 64 && size.height === 32)
  if (!validSize) {
    return Response.json(
      { error: `Неверный размер скина: ${size.width}x${size.height}. Нужен 64x64 или 64x32.` },
      { status: 400 },
    )
  }

  // Ник уже валидирован при регистрации ([A-Za-z0-9_]{3,16}), но перестрахуемся
  if (!/^[A-Za-z0-9_]{3,32}$/.test(user.minecraft_nick)) {
    return Response.json({ error: "Некорректный ник" }, { status: 400 })
  }

  const dir = skinsDir()
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${user.minecraft_nick}.png`), raw)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    console.log("[v0] skin write failed:", e.code, e.message, "dir:", dir)
    if (e.code === "EACCES" || e.code === "EPERM") {
      return Response.json(
        { error: "Хранилище скинов недоступно для записи. Обратитесь к администратору сервера." },
        { status: 500 },
      )
    }
    return Response.json({ error: "Не удалось сохранить скин на сервере" }, { status: 500 })
  }

  return Response.json({ ok: true })
}

/**
 * DELETE /api/skin — remove the player's skin (reverts to default).
 */
export async function DELETE(request: Request) {
  const limited = checkRateLimit(request, "skin-upload", 10, 60_000)
  if (limited) return limited

  const user = await authenticatePlayer(request)
  if (!user) return unauthorized()

  try {
    const file = path.join(skinsDir(), `${user.minecraft_nick}.png`)
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch (err) {
    console.log("[v0] skin delete failed:", (err as Error).message)
    return Response.json({ error: "Не удалось удалить скин" }, { status: 500 })
  }
  return Response.json({ ok: true })
}
