import { notFound } from "next/navigation"
import { getSessionUser } from "@/lib/session"
import { isAdminUser } from "@/lib/admin"
import { getDb } from "@/lib/db"
import ThreadPageClient from "./ThreadPageClient"
import type { Metadata } from "next"

interface Thread {
  id: number
  category_id: number
  category_slug: string
  category_name: string
  author_nick: string
  title: string
  body: string
  status: string
  is_pinned: number
  reply_count: number
  created_at: string
}

interface Reply {
  id: number
  author_nick: string
  body: string
  is_deleted: number
  edited_at: string | null
  created_at: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const db = getDb()
  const [rows] = await db.query(
    `SELECT ft.title FROM forum_threads ft WHERE ft.id = ? AND ft.status != 'deleted' LIMIT 1`,
    [id]
  )
  const list = rows as Array<{ title: string }>
  if (!list[0]) return { title: "Форум — Polit Empire" }
  return {
    title: `${list[0].title} — Форум — Polit Empire`,
  }
}

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string; id: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { id } = await params
  const { page: pageStr } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? "1", 10))
  const limit = 30

  const db = getDb()

  // Load thread with category info
  const [threadRows] = await db.query(
    `SELECT ft.*, fc.slug AS category_slug, fc.name AS category_name
     FROM forum_threads ft
     JOIN forum_categories fc ON fc.id = ft.category_id
     WHERE ft.id = ? AND ft.status != 'deleted'
     LIMIT 1`,
    [id]
  )
  const threads = threadRows as Thread[]
  if (!threads[0]) notFound()
  const thread = threads[0]

  // Load replies (paginated)
  const offset = (page - 1) * limit
  const [replyRows] = await db.query(
    `SELECT * FROM forum_replies WHERE thread_id = ? ORDER BY id LIMIT ? OFFSET ?`,
    [id, limit, offset]
  )
  const replies = replyRows as Reply[]

  // Total reply count
  const [cntRows] = await db.query(
    "SELECT COUNT(*) AS c FROM forum_replies WHERE thread_id = ?",
    [id]
  )
  const total = (cntRows as Array<{ c: number }>)[0]?.c ?? 0

  // Session
  const user = await getSessionUser()
  const admin = user ? await isAdminUser(user) : false

  return (
    <ThreadPageClient
      initialData={{
        thread,
        replies,
        total,
        page,
        limit,
        isAdmin: admin,
        currentUser: user?.minecraft_nick ?? null,
      }}
      threadId={parseInt(id, 10)}
      categorySlug={thread.category_slug}
    />
  )
}
