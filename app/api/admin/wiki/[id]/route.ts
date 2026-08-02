import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"
import { getAdminUser } from "@/lib/admin"

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  const { id } = await params
  const body = (await req.json()) as { slug?: string; title?: string; category?: string; content?: string; is_published?: number }
  const { slug, title, category, content, is_published } = body
  if (!slug || !title || !content) return NextResponse.json({ error: "Заполните все поля" }, { status: 400 })
  const db = getDb()
  await db.query(
    "UPDATE wiki_articles SET slug=?, title=?, category=?, content=?, is_published=? WHERE id=?",
    [slug, title, category || "Общее", content, is_published ?? 1, id],
  )
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Нет доступа" }, { status: 403 })
  const { id } = await params
  const db = getDb()
  await db.query("DELETE FROM wiki_articles WHERE id=?", [id])
  return NextResponse.json({ ok: true })
}
