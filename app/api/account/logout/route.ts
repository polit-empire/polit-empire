import { destroySession } from "@/lib/session"

/** POST /api/account/logout — завершает сессию личного кабинета. */
export async function POST() {
  await destroySession()
  return Response.json({ ok: true })
}
