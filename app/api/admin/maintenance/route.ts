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

  const b = (await req.json().catch(() => null)) as { enabled?: boolean; message?: string } | null
  if (b == null || typeof b.enabled !== "boolean") {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }
  const message = typeof b.message === "string" ? b.message.slice(0, 1000) : ""

  await setMaintenanceState(b.enabled, message)
  await logAdminAction({
    adminNick: admin.minecraft_nick,
    action: b.enabled ? "maintenance.on" : "maintenance.off",
    targetNick: null,
    detail: b.enabled ? `Техработы включены: ${message}` : "Техработы выключены",
    ip: clientIp(req),
  }).catch(() => {})

  return NextResponse.json({ ok: true, enabled: b.enabled, message })
}