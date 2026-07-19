"use client"

import { useState } from "react"
import { LoaderCircle, Megaphone, MessageCircle, Newspaper, Send, Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { postJson } from "@/lib/fetcher"
import { Card, Field, TextArea } from "@/components/admin/ui"

interface ChannelResult {
  ok: boolean
  detail: string
}

const CHANNELS = [
  { id: "server", label: "На сервер", hint: "Всем игрокам в игре (RCON)", icon: Server },
  { id: "telegram", label: "Telegram-бот", hint: "Всем пользователям бота", icon: Send },
  { id: "discord", label: "Discord", hint: "В канал новостей", icon: MessageCircle },
  { id: "discord_devblog", label: "Дев-блог", hint: "В канал дев-блога", icon: Newspaper },
] as const

type ChannelId = (typeof CHANNELS)[number]["id"]

export function BroadcastPanel() {
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [targets, setTargets] = useState<Record<ChannelId, boolean>>({
    server: true,
    telegram: false,
    discord: false,
    discord_devblog: false,
  })
  const [results, setResults] = useState<Record<string, ChannelResult> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const anySelected = targets.server || targets.telegram || targets.discord || targets.discord_devblog

  function toggle(id: ChannelId) {
    setTargets((t) => ({ ...t, [id]: !t[id] }))
  }

  async function send() {
    const text = message.trim()
    if (!text || !anySelected) return
    setBusy(true)
    setResults(null)
    setError(null)
    try {
      const res = await postJson<{ results: Record<string, ChannelResult> }>("/api/admin/broadcast", {
        message: text,
        targets,
      })
      setResults(res.results)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Megaphone className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Рассылка сообщения</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Выберите, куда отправить сообщение. Для сервера поддерживаются цветовые коды (например{" "}
          <code className="rounded bg-muted px-1">&amp;a</code>).
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          {CHANNELS.map((c) => {
            const Icon = c.icon
            const active = targets[c.id]
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/50 hover:border-muted-foreground/40",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                  {c.label}
                </span>
                <span className="text-xs text-muted-foreground">{c.hint}</span>
              </button>
            )
          })}
        </div>

        <Field label="Текст сообщения">
          <TextArea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="&aВнимание! Через 5 минут ивент на спавне."
            className="min-h-28"
          />
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {results && (
          <div className="flex flex-col gap-1">
            {Object.entries(results).map(([k, r]) => (
              <p key={k} className={r.ok ? "text-sm text-emerald-500" : "text-sm text-destructive"}>
                {r.detail}
              </p>
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={busy || !message.trim() || !anySelected}
          onClick={send}
          className="flex w-fit items-center gap-1.5 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          Отправить
        </button>
      </Card>
    </div>
  )
}
