import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { runManager } from "@/lib/backend"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Статус контейнеров: docker compose ps. */
export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const r = await runManager(["status"])
  return NextResponse.json({
    ok: r.ok,
    stdout: r.stdout,
    stderr: r.stderr,
  })
}