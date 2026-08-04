/**
 * Публикация новой версии лаунчера на сайт (авто-обновление).
 *
 * Использование:
 *   node scripts/upload-launcher.mjs <путь-к-инсталлеру.exe> <версия> [changelog]
 *
 * Пример:
 *   node scripts/upload-launcher.mjs "launcher/src-tauri/target/release/bundle/nsis/Polit Empire Launcher_1.0.1_x64-setup.exe" 1.0.1 "Исправлена скорость загрузки"
 *
 * Переменные окружения (из .env в корне проекта):
 *   APP_URL                — адрес сайта (например https://politempire.org)
 *   LAUNCHER_UPLOAD_TOKEN  — секретный токен загрузки
 *
 * Не забудьте перед сборкой поднять version в:
 *   launcher/src-tauri/Cargo.toml и launcher/src-tauri/tauri.conf.json
 */
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// Загрузчик .env без зависимостей, устойчивый к особенностям Windows:
// CRLF (\r), BOM, кавычки, пробелы, префикс `export`, регистр ключей.
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")

// Ищем .env в нескольких типичных местах (первый найденный — используется).
const candidates = [
  path.join(process.cwd(), ".env"),
  path.join(process.cwd(), ".env.local"),
  path.join(projectRoot, ".env"),
  path.join(projectRoot, ".env.local"),
  path.join(scriptDir, ".env"),
]

let loadedFrom = null
for (const envPath of candidates) {
  if (!fs.existsSync(envPath)) continue
  loadedFrom = envPath
  let raw = fs.readFileSync(envPath, "utf8")
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1) // срезаем BOM
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim().replace(/^["']|["']$/g, "").trim()
    if (!process.env[key]) process.env[key] = val
  }
  break
}

if (loadedFrom) {
  console.log(`.env загружен из: ${loadedFrom}`)
} else {
  console.warn(
    "Файл .env не найден. Проверял:\n  " +
      candidates.join("\n  ") +
      "\nУбедитесь, что файл называется именно .env (а не .env.txt) и лежит в корне проекта."
  )
}

const [, , filePath, version, ...changelogParts] = process.argv
const changelog = changelogParts.join(" ")

if (!filePath || !version) {
  console.error("Использование: node scripts/upload-launcher.mjs <файл.exe> <версия> [changelog]")
  process.exit(1)
}
if (!fs.existsSync(filePath)) {
  console.error(`Файл не найден: ${filePath}`)
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Версия должна быть в формате X.Y.Z, например 1.0.1")
  process.exit(1)
}

const baseUrl = process.env.APP_URL
const token = process.env.LAUNCHER_UPLOAD_TOKEN
if (!baseUrl || !token) {
  const missing = []
  if (!baseUrl) missing.push("APP_URL")
  if (!token) missing.push("LAUNCHER_UPLOAD_TOKEN")
  console.error(`Не заданы переменные: ${missing.join(", ")}`)
  console.error("Задайте их в .env в корне проекта, например:")
  console.error("  APP_URL=https://politempire.ru")
  console.error("  LAUNCHER_UPLOAD_TOKEN=ваш_секретный_токен")
  console.error("Либо передайте прямо в команде (PowerShell):")
  console.error('  $env:APP_URL="https://politempire.ru"; $env:LAUNCHER_UPLOAD_TOKEN="токен"; node scripts/upload-launcher.mjs ...')
  process.exit(1)
}

const buffer = fs.readFileSync(filePath)
const form = new FormData()
form.append("file", new Blob([buffer]), path.basename(filePath))
form.append("version", version)
if (changelog) form.append("changelog", changelog)

console.log(`Загрузка ${path.basename(filePath)} (${(buffer.length / 1024 / 1024).toFixed(1)} МБ) как версия ${version}…`)

const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/launcher/upload`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "User-Agent": "PolitEmpireLauncher/1.0",
  },
  body: form,
})

const text = await res.text().catch(() => "")
let body = {}
try { body = JSON.parse(text) } catch { /* ignore */ }

if (!res.ok) {
  console.error(`Ошибка ${res.status}:`, body.error || body)
  console.error("Сырой ответ:", text)
  process.exit(1)
}

console.log(`Готово! Версия ${body.version} опубликована и активна.`)
console.log("Все лаунчеры обновятся автоматически при следующем запуске.")
