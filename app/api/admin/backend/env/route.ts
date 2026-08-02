import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { readEnvFile, serializeEnv, writeEnvFile, type EnvLine } from "@/lib/backend"
import { clientIp, logAdminAction } from "@/lib/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function fileOf(v: string | null): "site" | "bot" | null {
  return v === "site" || v === "bot" ? v : null
}

/** Разбирает список строк, присланный из UI. */
function entriesOf(v: unknown): EnvLine[] | null {
  if (!Array.isArray(v) || v.length > 1024) return null
  const out: EnvLine[] = []
  for (const item of v) {
    if (!item || typeof item !== "object") return null
    const o = item as Record<string, unknown>
    if (o.kind === "kv") {
      const key = typeof o.key === "string" ? o.key : ""
      const value = typeof o.value === "string" ? o.value : ""
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null
      if (/[\r\n]/.test(value)) return null
      out.push({ kind: "kv", key, value })
    } else if (o.kind === "raw") {
      const text = typeof o.text === "string" ? o.text : ""
      if (/[\r\n]/.test(text)) return null
      out.push({ kind: "raw", text })
    } else {
      return null
    }
  }
  return out
}

/** Текущее .env: список строк (для удобного редактора) + сырой текст. */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const file = fileOf(new URL(req.url).searchParams.get("file"))
  if (!file) return NextResponse.json({ error: "bad request" }, { status: 400 })

  try {
    const { content, entries } = await readEnvFile(file)
    return NextResponse.json({ ok: true, file, content, entries })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

/** Запись .env. Принимает либо спикок entries, либо сырой content. */
export async function PUT(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = (await req.json().catch(() => null)) as {
    file?: string
    content?: string
    entries?: EnvLine[]
  } | null
  if (!b) return NextResponse.json({ error: "bad request" }, { status: 400 })
  const file = fileOf(b?.file ?? null)
  if (!file) return NextResponse.json({ error: "bad request" }, { status: 400 })

  let content: string
  if (typeof b.content === "string") {
    if (b.content.length > 512 * 1024) return NextResponse.json({ error: "file too big" }, { status: 400 })
    content = b.content
  } else if (Array.isArray(b.entries)) {
    const entries = entriesOf(b.entries)
    if (!entries) return NextResponse.json({ error: "bad entries" }, { status: 400 })
    content = serializeEnv(entries)
  } else {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }

  try {
    await writeEnvFile(file, content)
    await logAdminAction({
      adminNick: admin.minecraft_nick,
      action: "backend.env",
      targetNick: null,
      detail: `Изменён .env (${file}) через админ-панель`,
      ip: clientIp(req),
    }).catch(() => {})
    return NextResponse.json({ ok: true, file })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}