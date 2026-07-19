import net from "net"

/**
 * Минимальная реализация Source RCON (Valve) поверх TCP для Node.
 * Используется сайтом для выдачи привилегий/DC, банов/кика и рассылки.
 * Совпадает по поведению с Python-ботом (aiomcrcon): те же команды сервера
 * (`dc give/take`, `ban`, `pardon`, `kick`, `bc`).
 *
 * Реквизиты берутся из переменных окружения:
 *   RCON_HOST, RCON_PORT (по умолчанию 25575), RCON_PASSWORD
 */

const SERVERDATA_AUTH = 3
const SERVERDATA_EXECCOMMAND = 2
const SERVERDATA_RESPONSE_VALUE = 0
// SERVERDATA_AUTH_RESPONSE == 2 (совпадает с EXECCOMMAND по значению)

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8")
  const size = 4 + 4 + bodyBuf.length + 2 // id + type + body + two null bytes
  const buf = Buffer.alloc(4 + size)
  buf.writeInt32LE(size, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  bodyBuf.copy(buf, 12)
  buf.writeInt8(0, 12 + bodyBuf.length)
  buf.writeInt8(0, 12 + bodyBuf.length + 1)
  return buf
}

interface RconConfig {
  host: string
  port: number
  password: string
}

function rconConfig(): RconConfig {
  return {
    host: process.env.RCON_HOST || process.env.MC_HOST || "127.0.0.1",
    port: Number(process.env.RCON_PORT || 25575),
    password: process.env.RCON_PASSWORD || "",
  }
}

/** Проверяет, что RCON сконфигурирован (есть пароль). */
export function isRconConfigured(): boolean {
  return Boolean(process.env.RCON_PASSWORD)
}

/**
 * Открывает одно RCON-соединение, аутентифицируется и последовательно
 * выполняет команды. Возвращает массив ответов сервера (по команде).
 * Бросает ошибку при неверном пароле, таймауте или сетевом сбое.
 */
export async function rconExec(commands: string[], timeoutMs = 10_000): Promise<string[]> {
  const { host, port, password } = rconConfig()
  if (!password) throw new Error("RCON не настроен: отсутствует RCON_PASSWORD")

  return new Promise<string[]>((resolve, reject) => {
    const socket = new net.Socket()
    let buffer = Buffer.alloc(0)
    let authed = false
    const responses: string[] = []
    let cmdIndex = 0
    let settled = false

    const AUTH_ID = 100
    const CMD_ID_BASE = 200

    const timer = setTimeout(() => {
      fail(new Error("RCON таймаут"))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {
        /* ignore */
      }
    }
    function fail(err: Error) {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }
    function done() {
      if (settled) return
      settled = true
      cleanup()
      resolve(responses)
    }

    function sendNextCommand() {
      if (cmdIndex >= commands.length) {
        done()
        return
      }
      const cmd = commands[cmdIndex]
      socket.write(encodePacket(CMD_ID_BASE + cmdIndex, SERVERDATA_EXECCOMMAND, cmd))
    }

    socket.setTimeout(timeoutMs)
    socket.on("timeout", () => fail(new Error("RCON таймаут соединения")))
    socket.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))))
    socket.on("close", () => {
      if (!settled && authed) done()
      else if (!settled) fail(new Error("RCON соединение закрыто до завершения"))
    })

    socket.connect(port, host, () => {
      socket.write(encodePacket(AUTH_ID, SERVERDATA_AUTH, password))
    })

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      // Разбираем все полные пакеты в буфере.
      while (buffer.length >= 4) {
        const size = buffer.readInt32LE(0)
        if (buffer.length < 4 + size) break
        const id = buffer.readInt32LE(4)
        const type = buffer.readInt32LE(8)
        const body = buffer.slice(12, 4 + size - 2).toString("utf8")
        buffer = buffer.slice(4 + size)

        if (!authed) {
          // Ответ на аутентификацию: id == -1 означает провал пароля.
          if (id === -1) {
            fail(new Error("RCON: неверный пароль"))
            return
          }
          // Успешная авторизация (type == 2, id совпадает или >= 0).
          authed = true
          sendNextCommand()
          continue
        }

        if (type === SERVERDATA_RESPONSE_VALUE || id >= CMD_ID_BASE) {
          responses.push(body)
          cmdIndex++
          sendNextCommand()
        }
      }
    })
  })
}

/** Выполняет одну команду и возвращает ответ сервера. */
export async function rconCommand(command: string, timeoutMs = 10_000): Promise<string> {
  const [res] = await rconExec([command], timeoutMs)
  return res ?? ""
}
