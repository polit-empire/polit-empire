import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { BACKEND_SERVICES, runManager, type BackendService } from "@/lib/backend"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** restart|rebuild контейнера через scripts/backend-manage.sh. */
export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = (await req.json().catch(() => null)) as {
    action?: string
    service?: string
  } | null
  if (!b || !["restart", "rebuild"].includes(b.action ?? "")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 })
  }
  if (!BACKEND_SERVICES.includes((b.service ?? "") as BackendService)) {
    return NextResponse.json({ error: "unknown service" }, { status: 400 })
  }

  const r = await runManager([b.action!, b.service!])
  return NextResponse.json({
    ok: r.ok,
    action: b.action,
    service: b.service,
    stdout: r.stdout,
    stderr: r.stderr,
  })
}