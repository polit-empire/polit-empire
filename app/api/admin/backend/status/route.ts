import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { runManager } from "@/lib/backend"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export type ContainerStatus = {
  name: string
  service: string
  state: string
  status: string
  health: string
  exitCode: number
  image: string
  ports: string
  runningFor: string
}

function parseStatusJson(stdout: string): ContainerStatus[] {
  const out: ContainerStatus[] = []
  for (const line of stdout.split("\n")) {
    if (!line.trim() || !line.trimStart().startsWith("{")) continue
    try {
      const d = JSON.parse(line)
      out.push({
        name: String(d.Name ?? d.service ?? ""),
        service: String(d.Service ?? d.service ?? ""),
        state: String(d.State ?? ""),
        status: String(d.Status ?? ""),
        health: String(d.Health ?? ""),
        exitCode: Number(d.ExitCode ?? 0),
        image: String(d.Image ?? "").split("/").pop() ?? "",
        ports: String(d.Ports ?? ""),
        runningFor: String(d.RunningFor ?? ""),
      })
    } catch {
      // пропускаем битые строки
    }
  }
  return out
}

/** Статус контейнеров. format=json — распарсенный список (для UI), иначе — текст. */
export async function GET(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const format = new URL(req.url).searchParams.get("format")
  const r = await runManager(["status", "json"])

  if (format === "json") {
    return NextResponse.json({
      ok: r.ok,
      containers: r.ok ? parseStatusJson(r.stdout) : [],
      stderr: r.stderr,
    })
  }
  return NextResponse.json({ ok: r.ok, stdout: r.stdout, stderr: r.stderr })
}