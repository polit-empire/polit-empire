import { getDb } from "@/lib/db"
import { getAdminUser } from "@/lib/admin"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { threadId, pinned } = await request.json()
  if (threadId === undefined || pinned === undefined) {
    return NextResponse.json({ error: "Missing threadId or pinned" }, { status: 400 })
  }

  const db = getDb()
  await db.query("UPDATE forum_threads SET is_pinned = ? WHERE id = ?", [pinned ? 1 : 0, threadId])
  
  return NextResponse.json({ success: true })
}
