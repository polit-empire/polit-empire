import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getMaintenanceState, setMaintenanceState } from "@/lib/maintenance"
import { clientIp, logAdminAction } from "@/lib/audit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Текущее состояние техработ. */
export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  return NextResponse.json(await getMaintenanceState())
}

/** Включить/выключить техработы + текст сообщения. */
export async function PUT(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = (await req.json().catch(() => null)) as
    | { enabled?: boolean; launcher?: boolean; message?: string }
    | null
  if (b == null || (typeof b.enabled !== "boolean" && typeof b.launcher !== "boolean")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }
  const prev = await getMaintenanceState()
  const next: typeof prev = {
    enabled: typeof b.enabled === "boolean" ? b.enabled : prev.enabled,
    launcher: typeof b.launcher === "boolean" ? b.launcher : prev.launcher,
    message: typeof b.message === "string" ? b.message.slice(0, 1000) : prev.message,
  }
  await setMaintenanceState(next)
  await logAdminAction({
    adminNick: admin.minecraft_nick,
    action: "maintenance.set",
    targetNick: null,
    detail: `Техработы: сайт=${next.enabled ? "вкл" : "выкл"}, лаунчер=${next.launcher ? "вкл" : "выкл"}, сообщение: ${next.message}`,
    ip: clientIp(req),
  }).catch(() => {})

  return NextResponse.json({ ok: true, ...next })
}