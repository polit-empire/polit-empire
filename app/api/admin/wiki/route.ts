import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { getAdminUser } from "@/lib/admin"

export async function GET() {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, slug, title, category, is_published, created_at FROM wiki_articles ORDER BY category, title",
  )
  return NextResponse.json({ articles: rows })
}

export async function POST(req: Request) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  const body = (await req.json()) as { slug?: string; title?: string; category?: string; content?: string; is_published?: number }
  const { slug, title, category, content, is_published } = body
  if (!slug || !title || !content) return NextResponse.json({ error: "Заполните все поля" }, { status: 400 })
  const db = getDb()
  const [result] = await db.query(
    "INSERT INTO wiki_articles (slug, title, category, content, is_published) VALUES (?, ?, ?, ?, ?)",
    [slug, title, category || "Общее", content, is_published ?? 1],
  )
  return NextResponse.json({ id: (result as { insertId: number }).insertId })
}
