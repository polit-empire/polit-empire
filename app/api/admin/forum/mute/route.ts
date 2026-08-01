import { getDb } from "@/lib/db"
import { getAdminUser } from "@/lib/admin"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const db = getDb()
  const [mutes] = await db.query(
    "SELECT * FROM forum_mutes WHERE expires_at IS NULL OR expires_at > NOW() ORDER BY created_at DESC"
  )
  return NextResponse.json({ mutes })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { nick, reason, durationDays } = await request.json()
  if (!nick) return NextResponse.json({ error: "Missing nick" }, { status: 400 })

  const db = getDb()
  let expiresAt = null
  if (durationDays !== null && durationDays !== undefined) {
    const d = new Date()
    d.setDate(d.getDate() + Number(durationDays))
    expiresAt = d
  }

  await db.query(
    `INSERT INTO forum_mutes (minecraft_nick, reason, muted_by, expires_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE reason=VALUES(reason), muted_by=VALUES(muted_by), expires_at=VALUES(expires_at)`,
    [nick, reason || null, admin.minecraft_nick, expiresAt]
  )

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { nick } = await request.json()
  if (!nick) return NextResponse.json({ error: "Missing nick" }, { status: 400 })

  const db = getDb()
  await db.query("DELETE FROM forum_mutes WHERE minecraft_nick = ?", [nick])

  return NextResponse.json({ success: true })
}
