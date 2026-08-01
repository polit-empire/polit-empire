import { getDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"
import { isAdminUser } from "@/lib/admin"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const replyId = parseInt(id, 10)
  if (isNaN(replyId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = await isAdminUser(user)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getDb()
  await db.query("UPDATE forum_replies SET is_deleted = 1 WHERE id = ?", [replyId])
  return NextResponse.json({ success: true })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const replyId = parseInt(id, 10)
  if (isNaN(replyId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let data: { body?: string }
  try { data = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const { body } = data
  if (!body?.trim()) return NextResponse.json({ error: "Missing body" }, { status: 400 })

  const db = getDb()
  const [replyRows] = await db.query(
    "SELECT author_nick, created_at FROM forum_replies WHERE id = ? LIMIT 1",
    [replyId]
  )
  const reply = (replyRows as Array<{ author_nick: string; created_at: Date | string }>)[0]
  if (!reply) return NextResponse.json({ error: "Reply not found" }, { status: 404 })

  const admin = await isAdminUser(user)

  if (!admin) {
    if (reply.author_nick !== user.minecraft_nick) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    const createdAt = new Date(reply.created_at).getTime()
    const now = Date.now()
    if (now - createdAt > 15 * 60 * 1000) {
      return NextResponse.json({ error: "Время редактирования истекло (15 минут)" }, { status: 403 })
    }
  }

  await db.query("UPDATE forum_replies SET body = ?, edited_at = NOW() WHERE id = ?", [body.trim(), replyId])
  return NextResponse.json({ success: true })
}
