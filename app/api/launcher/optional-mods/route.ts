import { NextResponse } from "next/server"

/**
 * Названия и описания опциональных модов из панели GML.
 * Панельный endpoint требует JWT администратора, поэтому сайт логинится
 * под сервисным аккаунтом (GML_PANEL_LOGIN/PASSWORD) и кэширует ответ.
 */

const GML_URL = process.env.GML_INTERNAL_API_URL || "http://gml-web-api:8082"
const PROFILE = process.env.GML_PROJECT_NAME || "PolitEmpire"
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { at: number; data: unknown } | null = null

async function panelToken(): Promise<string | null> {
  const login = process.env.GML_PANEL_LOGIN
  const password = process.env.GML_PANEL_PASSWORD
  if (!login || !password) return null
  const res = await fetch(`${GML_URL}/api/v1/users/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Login: login, Password: password }),
    cache: "no-store",
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.data?.accessToken ?? null
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.data)
  }

  try {
    const token = await panelToken()
    if (!token) {
      return NextResponse.json({ mods: [] })
    }

    // Список опциональных модов + сохранённые в панели названия/описания
    const [optRes, detRes] = await Promise.all([
      fetch(`${GML_URL}/api/v1/profiles/${PROFILE}/mods/optionals`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
      fetch(`${GML_URL}/api/v1/mods/details`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }),
    ])

    const optionals = optRes.ok ? (await optRes.json())?.data ?? [] : []
    const details = detRes.ok ? (await detRes.json())?.data ?? [] : []

    const mods = (optionals as Array<{ name?: string }>).map((m) => {
      const d = (details as Array<{ key?: string; title?: string; description?: string }>).find(
        (x) => x.key === m.name,
      )
      return {
        name: m.name ?? "",
        title: d?.title ?? "",
        description: d?.description ?? "",
      }
    })

    const data = { mods }
    cache = { at: Date.now(), data }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ mods: [] })
  }
}
