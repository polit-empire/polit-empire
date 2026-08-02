import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { BACKEND_SERVICES, runManager, type BackendService } from "@/lib/backend"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Хвост логов сервиса (docker compose logs). */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const service = url.searchParams.get("service") ?? "app"
  if (!BACKEND_SERVICES.includes(service as BackendService)) {
    return NextResponse.json({ error: "unknown service" }, { status: 400 })
  }
  const linesRaw = Number(url.searchParams.get("lines") ?? 200)
  const lines = Math.min(Math.max(Number.isFinite(linesRaw) ? linesRaw : 200, 20), 2000)

  const r = await runManager(["logs", service, String(lines)])
  return NextResponse.json({
    ok: r.ok,
    service,
    stdout: r.stdout,
    stderr: r.stderr,
  })
}