import { execFile } from "child_process"
import { promises as fsp } from "fs"

export const REPO_DIR = "/opt/polit-empire"
export const COMPOSE_FILE = `${REPO_DIR}/docker-compose.yml`

/** Сервисы, которыми можно управлять из админки. */
export const BACKEND_SERVICES = [
  "app",
  "bots",
  "gml-web-api",
  "gml-web-proxy",
  "gml-web-frontend",
  "gml-web-skins",
] as const

export type BackendService = (typeof BACKEND_SERVICES)[number]

export const SITE_ENV_PATH = `${REPO_DIR}/.env`
export const BOT_ENV_PATH = `${REPO_DIR}/politempire_bots/.env`

export type ManagerResult = {
  ok: boolean
  stdout: string
  stderr: string
  code: string | number | null
}

const run = (cmd: string, args: string[]): Promise<ManagerResult> =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 128 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: err ? ((err as NodeJS.ErrnoException).code ?? 1) : 0,
      })
    })
  })

/** Выполняет команду backend-manage.sh (см. scripts/). */
export async function runManager(args: string[]): Promise<ManagerResult> {
  return run("bash", ["/opt/polit-empire/scripts/backend-manage.sh", ...args])
}

/**
 * Читает и пишет .env-файл. Возвращает содержимое/ошибку; при отсутствии
 * файла — понятную причину, чтобы админка могла показать её в интерфейсе.
 */
export async function readEnvFile(file: "site" | "bot"): Promise<{ content: string; file: string }> {
  const p = file === "site" ? SITE_ENV_PATH : BOT_ENV_PATH
  const content = await fsp.readFile(p, "utf8")
  return { content, file: p }
}

export async function writeEnvFile(file: "site" | "bot", content: string): Promise<void> {
  const p = file === "site" ? SITE_ENV_PATH : BOT_ENV_PATH
  if (content.length > 512 * 1024) throw new Error("Файл слишком большой")
  await fsp.writeFile(p, content + (content.endsWith("\n") ? "" : "\n"), "utf8")
}