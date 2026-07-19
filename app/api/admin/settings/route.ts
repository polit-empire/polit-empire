import { NextResponse } from "next/server"
import { getAdminUser } from "@/lib/admin"
import { getSettings, setSetting } from "@/lib/donate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Ключи, которые админ может редактировать из панели.
const EDITABLE = new Set([
  "privilege_rcon_template",
  "privilege_take_template",
  "dc_rcon_template",
  "dc_take_template",
  "dc_bonus_threshold",
  "dc_bonus_percent",
  "mydonate_enabled",
  "mydonate_shop_url",
  "easydonate_enabled",
  "easydonate_shop_key",
  "easydonate_server_id",
  "easydonate_dc_product_id",
  "easydonate_email",
  "millida_enabled",
  "millida_api_key",
  "millida_webhook_secret",
  "launcher_integrity_enforce",
  "donatello_enabled",
  "donatello_page_url",
  "donatello_api_token",
  "donatello_api_base",
  "donatello_page_size",
  "donatello_callback_key",
  "mod_admin_key",
  "item_rcon_template",
  "site_url",
  "vote_sites",
  "vote_cooldown_hours",
  "vote_callback_key",
])

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })
  const settings = await getSettings()
  return NextResponse.json({ settings })
}

export async function PATCH(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 })

  const b = await req.json().catch(() => null)
  if (!b || typeof b !== "object") return NextResponse.json({ error: "bad request" }, { status: 400 })

  let updated = 0
  for (const [k, v] of Object.entries(b)) {
    if (EDITABLE.has(k)) {
      await setSetting(k, String(v))
      updated++
    }
  }
  return NextResponse.json({ ok: true, updated })
}
