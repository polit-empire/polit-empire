import { getDb } from "@/lib/db"
import { getAdminUser } from "@/lib/admin"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const admin = await getAdminUser()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { threadId, closed } = await request.json()
  if (threadId === undefined || closed === undefined) {
    return NextResponse.json({ error: "Missing threadId or closed" }, { status: 400 })
  }

  const db = getDb()
  await db.query("UPDATE forum_threads SET status = ? WHERE id = ?", [closed ? "closed" : "open", threadId])
  
  return NextResponse.json({ success: true })
}
