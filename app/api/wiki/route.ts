import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

export async function GET() {
  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, slug, title, category, created_at FROM wiki_articles WHERE is_published = 1 ORDER BY category, title",
  )
  return NextResponse.json({ articles: rows })
}
