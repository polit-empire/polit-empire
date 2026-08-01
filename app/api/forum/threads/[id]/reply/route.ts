import { getDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const threadId = parseInt(id, 10)
  if (isNaN(threadId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Необходимо войти в аккаунт" }, { status: 401 })

  let data: { body?: string }
  try { data = await request.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const { body } = data
  if (!body?.trim()) return NextResponse.json({ error: "Текст ответа не может быть пустым" }, { status: 400 })

  const db = getDb()

  // Check mute
  const [muteRows] = await db.query(
    "SELECT expires_at FROM forum_mutes WHERE minecraft_nick = ? AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
    [user.minecraft_nick]
  )
  if ((muteRows as unknown[]).length > 0) {
    return NextResponse.json({ error: "Вы замучены на форуме" }, { status: 403 })
  }

  // Check thread open
  const [threadRows] = await db.query(
    "SELECT status FROM forum_threads WHERE id = ? LIMIT 1",
    [threadId]
  )
  const thread = (threadRows as Array<{ status: string }>)[0]
  if (!thread) return NextResponse.json({ error: "Тема не найдена" }, { status: 404 })
  if (thread.status === "closed" || thread.status === "deleted") {
    return NextResponse.json({ error: "Тема закрыта для ответов" }, { status: 403 })
  }

  const [result] = await db.query(
    "INSERT INTO forum_replies (thread_id, author_nick, body) VALUES (?, ?, ?)",
    [threadId, user.minecraft_nick, body.trim()]
  )
  const replyId = (result as { insertId: number }).insertId

  await db.query(
    "UPDATE forum_threads SET reply_count = reply_count + 1, last_reply_at = NOW(), last_reply_nick = ? WHERE id = ?",
    [user.minecraft_nick, threadId]
  )

  return NextResponse.json({ replyId })
}
