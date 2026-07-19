// Диагностика Donatello API: читает токен из site_settings и пробует разные
// варианты авторизации/эндпоинтов, печатая сырой ответ. Запуск:
//   node --env-file-if-exists=/vercel/share/.env.project scripts/probe-donatello.mjs
import mysql from "mysql2/promise"

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  charset: "utf8mb4",
})
const [rows] = await conn.query(
  "SELECT `key`, `value` FROM site_settings WHERE `key` LIKE 'donatello_%'",
)
const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))
await conn.end()

const token = settings.donatello_api_token
const base = (settings.donatello_api_base || "https://donatello.to/api/v1").replace(/\/$/, "")
console.log("Настройки:", { ...settings, donatello_api_token: token ? `${token.slice(0, 6)}…(${token.length})` : null })

if (!token) {
  console.error("Токен пуст — заполни в админке")
  process.exit(1)
}

const attempts = [
  { name: "X-Token header /donates", url: `${base}/donates`, headers: { "X-Token": token } },
  { name: "Bearer header /donates", url: `${base}/donates`, headers: { Authorization: `Bearer ${token}` } },
  { name: "X-Token /widget/donates", url: `${base}/widget/donates`, headers: { "X-Token": token } },
  { name: "token query /donates", url: `${base}/donates?token=${encodeURIComponent(token)}`, headers: {} },
]

for (const a of attempts) {
  try {
    const res = await fetch(a.url, { headers: a.headers, signal: AbortSignal.timeout(15000) })
    const text = await res.text()
    console.log(`\n=== ${a.name} → HTTP ${res.status} ===`)
    console.log(text.slice(0, 1200))
  } catch (e) {
    console.log(`\n=== ${a.name} → ERROR ${String(e)} ===`)
  }
}
