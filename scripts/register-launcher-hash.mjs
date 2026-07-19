/**
 * Регистрация эталонного SHA-256 официальной сборки лаунчера (self-integrity).
 *
 * ВАЖНО: хешировать нужно НЕ NSIS-инсталлер, а сам исполняемый файл лаунчера,
 * который ставится игроку и который лаунчер хеширует у себя через
 * std::env::current_exe(). Это бинарник из target/release:
 *
 *   launcher/src-tauri/target/release/polit-empire-launcher.exe
 *
 * (тот же файл, что NSIS кладёт в Program Files). Хеш именно этого файла должен
 * попасть в белый список, иначе проверка забракует легальные лаунчеры.
 *
 * Использование:
 *   node scripts/register-launcher-hash.mjs <путь-к-launcher.exe> [версия] [--only]
 *
 * Примеры:
 *   node scripts/register-launcher-hash.mjs launcher/src-tauri/target/release/polit-empire-launcher.exe 1.0.3
 *   node scripts/register-launcher-hash.mjs ./polit-empire-launcher.exe 1.0.3 --only
 *
 * Флаг --only снимает активность со всех прежних хешей (действует ровно одна
 * текущая сборка). Без флага прежние хеши остаются активными (несколько
 * поддерживаемых версий одновременно).
 *
 * Переменные окружения (.env в корне проекта):
 *   APP_URL                — адрес сайта (например https://politempire.org)
 *   LAUNCHER_UPLOAD_TOKEN  — секретный токен (тот же, что для upload-launcher)
 */
import fs from "fs"
import path from "path"
import crypto from "crypto"
import { fileURLToPath } from "url"

// --- Загрузчик .env без зависимостей (тот же подход, что в upload-launcher.mjs) ---
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")
const candidates = [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), ".env.local"),
  path.join(projectRoot, ".env"),
  path.join(projectRoot, ".env.local"),
  path.join(scriptDir, ".env"),
]
for (const envPath of candidates) {
  if (!fs.existsSync(envPath)) continue
  let raw = fs.readFileSync(envPath, "utf8")
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    const val = m[2].trim().replace(/^["']|["']$/g, "").trim()
    if (!process.env[key]) process.env[key] = val
  }
  break
}

const args = process.argv.slice(2)
const only = args.includes("--only")
const positional = args.filter((a) => !a.startsWith("--"))
const [filePath, version] = positional

if (!filePath) {
  console.error("Использование: node scripts/register-launcher-hash.mjs <launcher.exe> [версия] [--only]")
  process.exit(1)
}
if (!fs.existsSync(filePath)) {
  console.error(`Файл не найден: ${filePath}`)
  process.exit(1)
}

const baseUrl = process.env.APP_URL
const token = process.env.LAUNCHER_UPLOAD_TOKEN
if (!baseUrl || !token) {
  const missing = []
  if (!baseUrl) missing.push("APP_URL")
  if (!token) missing.push("LAUNCHER_UPLOAD_TOKEN")
  console.error(`Не заданы переменные: ${missing.join(", ")}`)
  process.exit(1)
}

// SHA-256 файла — ровно то, что лаунчер посчитает у себя и пришлёт на /verify.
const buffer = fs.readFileSync(filePath)
const sha256 = crypto.createHash("sha256").update(buffer).digest("hex")
const label = `${path.basename(filePath)}${version ? ` ${version}` : ""}`

console.log(`Файл:   ${filePath} (${(buffer.length / 1024 / 1024).toFixed(1)} МБ)`)
console.log(`SHA-256: ${sha256}`)
if (only) console.log("Режим:  --only (прежние хеши будут деактивированы)")

const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/launcher/hashes`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ sha256, version: version || undefined, label, deactivateOthers: only }),
})

const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error(`Ошибка ${res.status}:`, body.error || body)
  process.exit(1)
}

console.log("Готово! Эталонный хеш зарегистрирован в белом списке.")
console.log("Лаунчеры с этим хешем пройдут проверку целостности, изменённые — нет.")
