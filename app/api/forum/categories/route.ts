import { getDb } from "@/lib/db"
export const dynamic = "force-dynamic"
export async function GET() {
  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, slug, name, description, icon, sort_order, admin_only, (SELECT COUNT(*) FROM forum_threads WHERE category_id = forum_categories.id AND status != 'deleted') AS thread_count FROM forum_categories WHERE is_active=1 ORDER BY sort_order"
  )
  return Response.json({ categories: rows })
}
