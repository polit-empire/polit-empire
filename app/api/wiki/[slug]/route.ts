import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, slug, title, category, content, created_at, updated_at FROM wiki_articles WHERE slug=? AND is_published=1 LIMIT 1",
    [slug],
  )
  const article = (rows as unknown[])[0]
  if (!article) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json({ article })
}
