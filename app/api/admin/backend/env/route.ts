import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { readEnvFile, writeEnvFile } from "@/lib/backend"
import { clientIp, logAdminAction } from "@/lib/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function fileOf(v: string | null): "site" | "bot" | null {
  return v === "site" || v === "bot" ? v : null
}

/** Текущее содержимое .env (сайта или бота). */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const file = fileOf(new URL(req.url).searchParams.get("file"))
  if (!file) return NextResponse.json({ error: "bad request" }, { status: 400 })

  try {
    const { content, file: path } = await readEnvFile(file)
    return NextResponse.json({ ok: true, file: path, content })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

/** Запись .env. Изменения вступают в силу после рестарта сервиса. */
export async function PUT(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = (await req.json().catch(() => null)) as { file?: string; content?: string } | null
  const file = fileOf(b?.file ?? null)
  if (!file || typeof b?.content !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }

  try {
    await writeEnvFile(file, b.content)
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