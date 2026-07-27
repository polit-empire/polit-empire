import { NextResponse } from "next/server"
import { getRawDb } from "@/lib/db"

/**
 * GET /api/news
 *
 * Публичные новости для лаунчера. Источник — таблица bot_news,
 * которую наполняет Discord-бот из новостного канала сервера.
 * Контент отдаётся как есть (Discord-markdown); лаунчер сам его рендерит.
 */

export const dynamic = "force-dynamic"

interface NewsRow {
  message_id: string
  author: string
  content: string
  image_url: string | null
  posted_at: Date
}

export async function GET() {
  try {
    // Таблицу создаёт бот; используем raw-пул, чтобы не гонять миграции сайта.
    const [rows] = await getRawDb().query(
      "SELECT message_id, author, content, image_url, posted_at FROM bot_news ORDER BY posted_at DESC LIMIT 10",
    )
    // Ссылка на оригинальное сообщение в Discord (message_id — это id сообщения).
    // Работает, если заданы DISCORD_GUILD_ID и DISCORD_NEWS_CHANNEL_ID.
    const guildId = process.env.DISCORD_GUILD_ID
    const channelId = process.env.DISCORD_NEWS_CHANNEL_ID
    const news = (rows as NewsRow[]).map((r) => ({
      id: String(r.message_id),
      author: r.author,
      content: r.content,
      imageUrl: r.image_url,
      postedAt: r.posted_at instanceof Date ? r.posted_at.toISOString() : String(r.posted_at),
      link:
        guildId && channelId
          ? `https://discord.com/channels/${guildId}/${channelId}/${r.message_id}`
          : null,
    }))
    return NextResponse.json(
      { news },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
    )
  } catch (err) {
    // Таблицы ещё нет (бот не запускался) — это не сбой, новостей просто нет.
    if ((err as { code?: string }).code !== "ER_NO_SUCH_TABLE") {
      // Недоступная БД и прочие сбои: молча отданный пустой список выглядит
      // как «новостей нет» и прячет причину, поэтому логируем явно.
      console.error("[news] не удалось загрузить новости:", err)
    }
    // Статус остаётся 200: лаунчер по этому эндпоинту выбирает рабочий хост
    // (resolve_api_host), и ошибочный код заставил бы его забраковать домен.
    return NextResponse.json({ news: [] })
  }
}
