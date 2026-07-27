import { z } from "zod"
import { getSessionUser } from "@/lib/session"
import { validatePromoCode } from "@/lib/promo"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  code: z.string().min(1).max(32),
  amountRub: z.number().int().min(0),
  productId: z.number().int().positive().optional(),
})

export async function POST(request: Request) {
  const user = await getSessionUser()
  if (!user) return Response.json({ error: "Войдите в личный кабинет" }, { status: 401 })

  let parsed
  try {
    parsed = bodySchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 })
  }
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 })

  const { code, amountRub, productId } = parsed.data
  const result = await validatePromoCode(code, user.minecraft_nick, amountRub, productId)
  return Response.json(result)
}
