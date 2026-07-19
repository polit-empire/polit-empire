/**
 * Отправка сообщений в Discord через тот же бот-токен, что и Python-бот
 * (переменная DISCORD_TOKEN). Используется рассылкой из админки в канал
 * новостей. Никогда не бросает — сбой не должен ронять запрос.
 */

// ID канала новостей по умолчанию (можно переопределить в .env).
export const DISCORD_NEWS_CHANNEL_ID = process.env.DISCORD_NEWS_CHANNEL_ID || "1516464340889501756"

// ID канала дев-блога: сюда падают уведомления о новых версиях лаунчера.
export const DISCORD_DEVBLOG_CHANNEL_ID = process.env.DISCORD_DEVBLOG_CHANNEL_ID || "1524747101471375430"

const DISCORD_API = "https://discord.com/api/v10"

export interface DiscordResult {
  ok: boolean
  error?: string
}

export interface SendOptions {
  /** Разрешить пинг @here (для дев-блога/анонсов). По умолчанию пинги выключены. */
  pingHere?: boolean
}

/** Отправляет текстовое сообщение в указанный канал ботом (Bot-токен). */
export async function sendChannelMessage(
  content: string,
  channelId?: string,
  opts: SendOptions = {},
): Promise<DiscordResult> {
  const token = process.env.DISCORD_TOKEN
  if (!token) return { ok: false, error: "DISCORD_TOKEN не задан" }

  const channel = channelId || DISCORD_NEWS_CHANNEL_ID
  // allowed_mentions: по умолчанию пинги выключены; для анонсов разрешаем @here.
  const allowed_mentions = opts.pingHere ? { parse: ["everyone"] } : { parse: [] }
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channel}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, allowed_mentions }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      return { ok: false, error: `Discord ${res.status}: ${body.message || "ошибка"}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Discord: сетевая ошибка" }
  }
}

/**
 * Анонс новой версии лаунчера в дев-блог с пингом @here.
 * Ничего не бросает — сбой уведомления не должен ронять публикацию.
 */
export async function announceLauncherRelease(version: string, changelog: string): Promise<DiscordResult> {
  const changes = changelog.trim()
  const body = changes
    ? changes
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith("-") || l.startsWith("•") ? l : `• ${l}`))
        .join("\n")
    : "• Мелкие улучшения и исправления."

  const content = [
    `@here 🚀 **Вышла новая версия лаунчера — v${version}!**`,
    "",
    "**Что нового:**",
    body,
    "",
    "_Обновление установится автоматически при следующем запуске лаунчера._",
  ].join("\n")

  return sendChannelMessage(content, DISCORD_DEVBLOG_CHANNEL_ID, { pingHere: true })
}
