"use client"

import useSWR from "swr"
import Link from "next/link"
import { Coins, ExternalLink, ThumbsUp, Clock } from "lucide-react"
import { jsonFetcher } from "@/lib/fetcher"
import { cn } from "@/lib/utils"

interface VoteSite {
  id: string
  name: string
  url: string
  bonus: number
  available?: boolean
  availableAt?: string | null
}

interface VoteResponse {
  sites: VoteSite[]
  cooldownHours: number
  totalEarned?: number
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ""
  const diffMs = new Date(iso).getTime() - Date.now()
  if (diffMs <= 0) return "сейчас"
  const hours = Math.floor(diffMs / 3_600_000)
  const mins = Math.ceil((diffMs % 3_600_000) / 60_000)
  if (hours > 0) return `через ${hours} ч ${mins} мин`
  return `через ${mins} мин`
}

/**
 * Секция «Бонусы за голос на мониторингах».
 * variant="account" — для ЛК (показывает доступность и кулдаун по игроку),
 * variant="public"  — для страницы доната (просто список со ссылками).
 */
export function VoteSection({ variant = "public" }: { variant?: "account" | "public" }) {
  const endpoint = variant === "account" ? "/api/account/votes" : "/api/vote/sites"
  const { data } = useSWR<VoteResponse>(endpoint, jsonFetcher, { shouldRetryOnError: false })

  const sites = data?.sites ?? []
  const cooldownHours = data?.cooldownHours ?? 24

  // Если мониторинги не настроены — секцию не показываем.
  if (sites.length === 0) return null

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <ThumbsUp className="size-4 text-primary" />
        <h2 className="font-mono text-base font-semibold">Голосуй и получай DC</h2>
        {variant === "account" && data?.totalEarned ? (
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
            заработано {data.totalEarned} DC
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          Голосуй раз в {cooldownHours} ч на каждом сайте
        </span>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {sites.map((s) => {
          const available = variant === "public" ? true : s.available !== false
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold">{s.name}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-primary">
                  <Coins className="size-3.5" />+{s.bonus} DC за голос
                </p>
                {variant === "account" && !available && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5" />
                    {`Доступно ${formatWhen(s.availableAt)}`}
                  </p>
                )}
              </div>
              <Link
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md px-4 py-2 font-mono text-xs font-semibold transition-opacity hover:opacity-90",
                  available
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-muted text-muted-foreground",
                )}
              >
                {available ? "Голосовать" : "Проголосовать ещё"}
                <ExternalLink className="size-3.5" />
              </Link>
            </div>
          )
        })}
      </div>

      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        Бонус начисляется автоматически после голосования (мониторинг подтверждает голос). Иногда это занимает пару
        минут. DC зачисляются на тот же баланс, что и в игре.
      </p>
    </section>
  )
}
