import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { DiscordMarkdown } from "../lib/discord-markdown"
import type { NewsItem } from "../types"

interface Props {
  nickname: string
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
}

export default function HomeTab({ nickname }: Props) {
  const [news, setNews] = useState<NewsItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    invoke<NewsItem[]>("get_news")
      .then((items) => {
        if (!cancelled) setNews(items)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-8 p-8">
      {/* Welcome */}
      <h2 className="text-3xl font-bold tracking-tight text-balance">
        С возвращением, <span className="text-primary">{nickname}</span>
      </h2>

      {/* News */}
      <section className="flex flex-col gap-4" aria-label="Новости сервера">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Новости</h3>

        {news === null && !failed && (
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-card/40" />
            ))}
          </div>
        )}

        {(failed || (news !== null && news.length === 0)) && (
          <div className="rounded-lg border border-border bg-card/40 p-6 text-center text-sm text-muted">
            Пока новостей нет. Следите за анонсами в нашем Discord.
          </div>
        )}

        {news !== null &&
          news.map((item) => {
            const openInDiscord = item.link
              ? () => {
                  openUrl(item.link as string).catch(() => {})
                }
              : undefined
            return (
              <article
                key={item.id}
                onClick={openInDiscord}
                onKeyDown={
                  openInDiscord
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          openInDiscord()
                        }
                      }
                    : undefined
                }
                role={openInDiscord ? "link" : undefined}
                tabIndex={openInDiscord ? 0 : undefined}
                title={openInDiscord ? "Открыть новость в Discord" : undefined}
                className={`overflow-hidden rounded-lg border border-border bg-card/60 ${
                  openInDiscord
                    ? "cursor-pointer transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary"
                    : ""
                }`}
              >
                <div className="flex items-start gap-4 p-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <DiscordMarkdown content={item.content} />
                    <p className="text-xs text-muted">
                      {item.author} · {formatDate(item.postedAt)}
                    </p>
                  </div>
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl || "/placeholder.svg"}
                      alt=""
                      className="size-24 shrink-0 rounded-md border border-border object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
              </article>
            )
          })}
      </section>
    </div>
  )
}
