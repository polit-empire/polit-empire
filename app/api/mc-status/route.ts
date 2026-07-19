import { pingMinecraft } from "@/lib/mc-ping"

export const dynamic = "force-dynamic"

/**
 * GET /api/mc-status
 * Пингует Minecraft-сервер (по умолчанию 79.137.71.8:25578; можно переопределить
 * переменными окружения MC_HOST/MC_PORT) и отдаёт онлайн, лимит слотов и выборку
 * ников для показа голов на сайте.
 */
export async function GET() {
  const host = process.env.MC_HOST || "79.137.71.8"
  const port = Number(process.env.MC_PORT || 25578)

  try {
    const status = await pingMinecraft(host, port, 3000)
    return Response.json(status, {
      headers: { "Cache-Control": "public, max-age=10, s-maxage=10" },
    })
  } catch {
    return Response.json({ online: false, players: 0, max: 0, sample: [] })
  }
}
