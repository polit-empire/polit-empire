import { getDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"
import { isAdminUser } from "@/lib/admin"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const threadId = parseInt(id, 10)
  if (isNaN(threadId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "30", 10))
  const offset = (page - 1) * limit

  const db = getDb()
  const user = await getSessionUser()
  const admin = user ? await isAdminUser(user) : false

  const [threadRows] = await db.query(
    `SELECT ft.*, fc.slug AS category_slug, fc.name AS category_name
     FROM forum_threads ft
     JOIN forum_categories fc ON fc.id = ft.category_id
     WHERE ft.id = ? AND ft.status != 'deleted'
     LIMIT 1`,
    [threadId]
  )
  const thread = (threadRows as unknown[])[0]
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 })
  }

  const [countRows] = await db.query(
    "SELECT COUNT(*) AS total FROM forum_replies WHERE thread_id = ?",
    [threadId]
  )
  const total = (countRows as Array<{ total: number }>)[0]?.total ?? 0

  const [repliesRows] = await db.query(
    "SELECT * FROM forum_replies WHERE thread_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
    [threadId, limit, offset]
  )

  return NextResponse.json({
    thread,
    replies: repliesRows,
    total,
    page,
    limit,
    isAdmin: admin,
    currentUser: user?.minecraft_nick ?? null,
  })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const threadId = parseInt(id, 10)
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let data: { body?: string }
  try { data = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const { body } = data
  if (!body?.trim()) return NextResponse.json({ error: "Missing body" }, { status: 400 })

  const db = getDb()
  const [threadRows] = await db.query("SELECT author_nick FROM forum_threads WHERE id = ? LIMIT 1", [threadId])
  const thread = (threadRows as Array<{ author_nick: string }>)[0]
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  const admin = await isAdminUser(user)
  if (thread.author_nick !== user.minecraft_nick && !admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await db.query("UPDATE forum_threads SET body = ? WHERE id = ?", [body.trim(), threadId])
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const threadId = parseInt(id, 10)
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const admin = await isAdminUser(user)
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const db = getDb()
  await db.query("UPDATE forum_threads SET status = 'deleted' WHERE id = ?", [threadId])
  return NextResponse.json({ success: true })
}
