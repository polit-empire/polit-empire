// Собирает нативную античит-DLL (crate anticheat-dll) и кладёт результат
// в src-tauri/anticheat/pe_anticheat.dll. Оттуда build.rs лаунчера вшивает
// её прямо в бинарник (include_bytes!), поэтому отдельного файла в папке
// установки нет. Запускается автоматически из `npm run build`.
import { execSync } from "node:child_process"
import { copyFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const crateDir = join(here, "..", "src-tauri", "anticheat-dll")
const outDir = join(here, "..", "src-tauri", "anticheat")

// На не-Windows платформах DLL не собрать — пропускаем (CI/линт на Linux).
if (process.platform !== "win32") {
  console.log("[anticheat] пропуск сборки DLL: платформа не Windows")
  process.exit(0)
}

console.log("[anticheat] сборка pe_anticheat.dll ...")
execSync("cargo build --release", { cwd: crateDir, stdio: "inherit" })

const built = join(crateDir, "target", "release", "pe_anticheat.dll")
if (!existsSync(built)) {
  console.error("[anticheat] DLL не найдена после сборки:", built)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
copyFileSync(built, join(outDir, "pe_anticheat.dll"))
console.log("[anticheat] DLL готова:", join(outDir, "pe_anticheat.dll"))
