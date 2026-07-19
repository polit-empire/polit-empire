// Обновляет версию лаунчера сразу в трёх файлах:
//   launcher/src-tauri/tauri.conf.json
//   launcher/package.json
//   launcher/src-tauri/Cargo.toml
//
// Использование:
//   node scripts/bump-version.mjs            -> поднимает patch (1.0.0 -> 1.0.1)
//   node scripts/bump-version.mjs patch      -> 1.0.0 -> 1.0.1
//   node scripts/bump-version.mjs minor      -> 1.0.3 -> 1.1.0
//   node scripts/bump-version.mjs major      -> 1.4.2 -> 2.0.0
//   node scripts/bump-version.mjs 1.2.5      -> задать версию явно
//
// В stdout печатается ТОЛЬКО новая версия (последней строкой),
// чтобы её можно было захватить в .bat через FOR /F.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, "..")

const tauriConfPath = path.join(projectRoot, "launcher", "src-tauri", "tauri.conf.json")
const pkgPath = path.join(projectRoot, "launcher", "package.json")
const cargoPath = path.join(projectRoot, "launcher", "src-tauri", "Cargo.toml")

function fail(msg) {
  console.error(`[bump-version] ${msg}`)
  process.exit(1)
}

// 1. Читаем текущую версию из tauri.conf.json (источник истины).
if (!fs.existsSync(tauriConfPath)) fail(`Не найден ${tauriConfPath}`)
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"))
const current = tauriConf.version
if (!/^\d+\.\d+\.\d+$/.test(current || "")) fail(`Некорректная текущая версия: ${current}`)

// 2. Вычисляем новую версию.
const arg = (process.argv[2] || "patch").trim()
let next
if (/^\d+\.\d+\.\d+$/.test(arg)) {
  next = arg
} else {
  const [major, minor, patch] = current.split(".").map(Number)
  if (arg === "major") next = `${major + 1}.0.0`
  else if (arg === "minor") next = `${major}.${minor + 1}.0`
  else if (arg === "patch") next = `${major}.${minor}.${patch + 1}`
  else fail(`Неизвестный аргумент: "${arg}". Ожидается patch|minor|major|X.Y.Z`)
}

// 3. tauri.conf.json — меняем поле version, сохраняя форматирование JSON.
tauriConf.version = next
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf8")

// 4. package.json — точечная замена только верхнего поля "version".
if (fs.existsSync(pkgPath)) {
  let pkgRaw = fs.readFileSync(pkgPath, "utf8")
  pkgRaw = pkgRaw.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`)
  fs.writeFileSync(pkgPath, pkgRaw, "utf8")
}

// 5. Cargo.toml — заменяем строку version в секции [package] (первое вхождение).
if (fs.existsSync(cargoPath)) {
  let cargoRaw = fs.readFileSync(cargoPath, "utf8")
  cargoRaw = cargoRaw.replace(/^(version\s*=\s*")\d+\.\d+\.\d+(")/m, `$1${next}$2`)
  fs.writeFileSync(cargoPath, cargoRaw, "utf8")
}

console.error(`[bump-version] ${current} -> ${next}`)
// Последняя строка stdout — только версия (для захвата в батнике).
console.log(next)
