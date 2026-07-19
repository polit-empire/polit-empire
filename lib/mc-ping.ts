import net from "net"

/**
 * Минимальный клиент Minecraft Server List Ping (протокол 1.7+).
 * Возвращает онлайн-статус, число игроков и (если сервер отдаёт) выборку ников.
 * Пишется вручную, т.к. в Node нет аналога python-библиотеки mcstatus.
 */

export interface McPlayerSample {
  name: string
  id: string
}

export interface McStatus {
  online: boolean
  players: number
  max: number
  sample: McPlayerSample[]
  version?: string
}

/** Кодирование VarInt (LEB128, 7 бит на байт). */
function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let v = value >>> 0
  do {
    let b = v & 0x7f
    v >>>= 7
    if (v !== 0) b |= 0x80
    bytes.push(b)
  } while (v !== 0)
  return Buffer.from(bytes)
}

/** Чтение VarInt из буфера. Возвращает значение и число прочитанных байт. */
function readVarInt(buf: Buffer, offset: number): { value: number; size: number } {
  let value = 0
  let size = 0
  let byte: number
  do {
    if (offset + size >= buf.length) {
      throw new Error("varint: недостаточно данных")
    }
    byte = buf[offset + size]
    value |= (byte & 0x7f) << (7 * size)
    size++
    if (size > 5) throw new Error("varint: слишком длинный")
  } while ((byte & 0x80) !== 0)
  return { value, size }
}

function writeString(str: string): Buffer {
  const data = Buffer.from(str, "utf8")
  return Buffer.concat([writeVarInt(data.length), data])
}

/** Оборачивает содержимое пакета в префикс длины (VarInt). */
function framePacket(payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(payload.length), payload])
}

export function pingMinecraft(host: string, port: number, timeoutMs = 3000): Promise<McStatus> {
  return new Promise((resolve) => {
    const offline: McStatus = { online: false, players: 0, max: 0, sample: [] }
    const socket = new net.Socket()
    let chunks: Buffer = Buffer.alloc(0)
    let settled = false

    const done = (result: McStatus) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.on("timeout", () => done(offline))
    socket.on("error", () => done(offline))

    socket.connect(port, host, () => {
      // Handshake: id 0x00, протокол 767 (1.21.x), адрес, порт, next state = 1
      const handshake = framePacket(
        Buffer.concat([
          writeVarInt(0x00),
          writeVarInt(767),
          writeString(host),
          Buffer.from([(port >> 8) & 0xff, port & 0xff]),
          writeVarInt(1),
        ]),
      )
      // Status request: id 0x00, без полей
      const request = framePacket(writeVarInt(0x00))
      socket.write(Buffer.concat([handshake, request]))
    })

    socket.on("data", (data) => {
      chunks = Buffer.concat([chunks, data])
      try {
        // Читаем длину всего пакета
        const pktLen = readVarInt(chunks, 0)
        const total = pktLen.size + pktLen.value
        if (chunks.length < total) return // ждём остаток

        let cursor = pktLen.size
        const pktId = readVarInt(chunks, cursor)
        cursor += pktId.size
        const strLen = readVarInt(chunks, cursor)
        cursor += strLen.size
        const json = chunks.subarray(cursor, cursor + strLen.value).toString("utf8")
        const parsed = JSON.parse(json)

        const sampleRaw: Array<{ name?: string; id?: string }> = parsed?.players?.sample ?? []
        const sample: McPlayerSample[] = sampleRaw
          .filter((p) => typeof p?.name === "string" && /^[A-Za-z0-9_]{1,32}$/.test(p.name))
          .map((p) => ({ name: p.name as string, id: p.id ?? "" }))

        done({
          online: true,
          players: Number(parsed?.players?.online ?? 0),
          max: Number(parsed?.players?.max ?? 0),
          sample,
          version: typeof parsed?.version?.name === "string" ? parsed.version.name : undefined,
        })
      } catch {
        // ещё не всё пришло или мусор — ждём/таймаут закроет
      }
    })
  })
}
