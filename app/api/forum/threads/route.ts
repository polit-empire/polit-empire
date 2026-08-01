import { getDb } from "@/lib/db"
import { getSessionUser } from "@/lib/session"
import { isAdminUser } from "@/lib/admin"
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const categorySlug = searchParams.get("category")
  const page = parseInt(searchParams.get("page") || "1", 10)
  const limit = Math.min(50, parseInt(searchParams.get("limit") || "20", 10))
  const offset = (page - 1) * limit

  if (!categorySlug) {
    return NextResponse.json({ error: "Missing category slug" }, { status: 400 })
  }

  const db = getDb()

  const [catRows] = await db.query(
    "SELECT id, slug, name, description, icon FROM forum_categories WHERE slug = ? AND is_active = 1 LIMIT 1",
    [categorySlug]
  )
  const catList = catRows as Array<{ id: number; slug: string; name: string; description: string; icon: string }>
  if (!catList[0]) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 })
  }
  const cat = catList[0]

  const [countRows] = await db.query(
    "SELECT COUNT(*) AS total FROM forum_threads WHERE category_id = ? AND status != 'deleted'",
    [cat.id]
  )
  const total = (countRows as Array<{ total: number }>)[0]?.total ?? 0

  const [threads] = await db.query(
    `SELECT t.id, t.category_id, t.author_nick, t.title, t.status, t.is_pinned,
            t.reply_count, t.last_reply_at, t.last_reply_nick, t.created_at
     FROM forum_threads t
     WHERE t.category_id = ? AND t.status != 'deleted'
     ORDER BY t.is_pinned DESC, t.last_reply_at DESC
     LIMIT ? OFFSET ?`,
    [cat.id, limit, offset]
  )

  return NextResponse.json({ category: cat, threads, total, page, limit })
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.json({ error: "Необходимо войти в аккаунт" }, { status: 401 })
  }

  let data: { categorySlug?: string; title?: string; body?: string }
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { categorySlug, title, body } = data

  if (!categorySlug || !title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: "Заполните все поля" }, { status: 400 })
  }

  if (title.trim().length > 255) {
    return NextResponse.json({ error: "Заголовок слишком длинный" }, { status: 400 })
  }

  const db = getDb()

  // Check mute
  const [muteRows] = await db.query(
    "SELECT expires_at FROM forum_mutes WHERE minecraft_nick = ? AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1",
    [user.minecraft_nick]
  )
  if ((muteRows as unknown[]).length > 0) {
    return NextResponse.json({ error: "Вы замучены на форуме" }, { status: 403 })
  }

  // Find category
  const [catRows] = await db.query(
    "SELECT id, admin_only FROM forum_categories WHERE slug = ? AND is_active = 1 LIMIT 1",
    [categorySlug]
  )
  const catList = catRows as Array<{ id: number; admin_only: number }>
  if (!catList[0]) {
    return NextResponse.json({ error: "Категория не найдена" }, { status: 404 })
  }
  const cat = catList[0]

  if (cat.admin_only) {
    const admin = await isAdminUser(user)
    if (!admin) {
      return NextResponse.json({ error: "Эта категория только для администраторов" }, { status: 403 })
    }
  }

  const [result] = await db.query(
    "INSERT INTO forum_threads (category_id, author_nick, title, body) VALUES (?, ?, ?, ?)",
    [cat.id, user.minecraft_nick, title.trim(), body.trim()]
  )

  const threadId = (result as { insertId: number }).insertId
  return NextResponse.json({ threadId })
}
