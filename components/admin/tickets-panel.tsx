"use client"

import { useMemo, useRef, useState } from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import {
  ArrowLeft,
  ChevronDown,
  ImagePlus,
  LifeBuoy,
  LoaderCircle,
  Lock,
  LockOpen,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { jsonFetcher } from "@/lib/fetcher"
import { Card, TextInput } from "@/components/admin/ui"

type Status = "open" | "answered" | "closed"

interface TicketRow {
  id: number
  minecraft_nick: string
  subject: string
  status: Status
  created_at: string
  last_message_at: string
  message_count: number
}

interface TicketMessage {
  id: number
  author_nick: string
  is_admin: number
  body: string | null
  attachment_mime: string | null
  attachment_ext: string | null
  created_at: string
}

type TicketsPage = {
  tickets: TicketRow[]
  counts: Record<string, number>
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

const STATUS_META: Record<Status, { label: string; cls: string }> = {
  open: { label: "Ожидает ответа", cls: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
  answered: { label: "Отвечен", cls: "text-primary border-primary/30 bg-primary/10" },
  closed: { label: "Закрыт", cls: "text-muted-foreground border-border bg-muted" },
}

const FILTERS: Array<{ id: string; label: string }> = [
  { id: "", label: "Все" },
  { id: "open", label: "Открытые" },
  { id: "answered", label: "Отвеченные" },
  { id: "closed", label: "Закрытые" },
]

function fmt(d: string): string {
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? d : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
}

export function TicketsPanel() {
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [selected, setSelected] = useState<number | null>(null)

  const { data, mutate, size, setSize, isLoading, isValidating } = useSWRInfinite<TicketsPage>(
    (pageIndex, prev) => {
      if (prev && !prev.hasMore) return null
      const p = new URLSearchParams({
        q: search,
        status,
        page: String(pageIndex + 1),
        pageSize: "30",
      })
      return `/api/admin/tickets?${p.toString()}`
    },
    jsonFetcher,
    { revalidateFirstPage: false, refreshInterval: 30_000 },
  )

  const tickets = useMemo(() => (data ?? []).flatMap((p) => p.tickets), [data])
  const counts = data?.[0]?.counts ?? { open: 0, answered: 0, closed: 0 }
  const total = data?.[0]?.total ?? 0
  const hasMore = data?.[data.length - 1]?.hasMore ?? false

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
      {/* Список тикетов */}
      <div className="flex flex-col gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(query.trim())
            void setSize(1)
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по нику или теме…"
              className="pl-9"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Найти
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = status === f.id
            const badge = f.id ? counts[f.id] ?? 0 : total
            return (
              <button
                key={f.id || "all"}
                type="button"
                onClick={() => {
                  setStatus(f.id)
                  void setSize(1)
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className="rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{badge}</span>
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => mutate()}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className={cn("size-3.5", isValidating && "animate-spin")} />
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Загрузка…
            </div>
          ) : tickets.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Тикетов не найдено.</p>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                  selected === t.id ? "border-primary bg-card" : "border-border bg-card/50 hover:border-muted-foreground/40",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    <span className="font-mono text-muted-foreground">#{t.id}</span> {t.subject}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{t.minecraft_nick}</span> · {fmt(t.last_message_at)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    STATUS_META[t.status].cls,
                  )}
                >
                  {STATUS_META[t.status].label}
                </span>
              </button>
            ))
          )}
          {hasMore && (
            <button
              type="button"
              disabled={isValidating}
              onClick={() => void setSize(size + 1)}
              className="mt-1 flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {isValidating ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
              Показать ещё
            </button>
          )}
        </div>
      </div>

      {/* Детали / переписка */}
      <div>
        {selected === null ? (
          <Card className="text-sm text-muted-foreground">Выберите тикет слева, чтобы ответить.</Card>
        ) : (
          <TicketDetail
            ticketId={selected}
            onChanged={() => mutate()}
            onClose={() => setSelected(null)}
            onDeleted={() => {
              setSelected(null)
              void mutate()
            }}
          />
        )}
      </div>
    </div>
  )
}

function TicketDetail({
  ticketId,
  onChanged,
  onClose,
  onDeleted,
}: {
  ticketId: number
  onChanged: () => void
  onClose: () => void
  onDeleted: () => void
}) {
  const { data, mutate, isLoading } = useSWR<{ ticket: TicketRow; messages: TicketMessage[] }>(
    `/api/admin/tickets/${ticketId}`,
    jsonFetcher,
    { refreshInterval: 20_000 },
  )
  const [body, setBody] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ticket = data?.ticket
  const messages = data?.messages ?? []

  async function reply(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setErr(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append("body", body.trim())
      if (file) fd.append("image", file)
      const res = await fetch(`/api/admin/tickets/${ticketId}`, { method: "POST", body: fd, credentials: "same-origin" })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || `Ошибка ${res.status}`)
      setBody("")
      setFile(null)
      await mutate()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось отправить")
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(status: "open" | "closed") {
    setErr(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `Ошибка ${res.status}`)
      }
      await mutate()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось изменить статус")
    }
  }

  async function remove() {
    if (!window.confirm(`Удалить тикет #${ticketId}? Это действие необратимо.`)) return
    setErr(null)
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, { method: "DELETE", credentials: "same-origin" })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `Ошибка ${res.status}`)
      }
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось удалить")
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-3.5" /> К списку
        </button>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">
            #{ticketId} {ticket ? `· ${ticket.subject}` : ""}
          </h3>
          {ticket && (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{ticket.minecraft_nick}</span> · создан {fmt(ticket.created_at)}
            </p>
          )}
        </div>
        {ticket && (
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium",
              STATUS_META[ticket.status].cls,
            )}
          >
            {STATUS_META[ticket.status].label}
          </span>
        )}
      </div>

      {/* Действия над тикетом */}
      {ticket && (
        <div className="flex flex-wrap gap-2 border-b border-border pb-3">
          {ticket.status === "closed" ? (
            <button
              type="button"
              onClick={() => setStatus("open")}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:text-primary"
            >
              <LockOpen className="size-3.5" /> Открыть
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStatus("closed")}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground"
            >
              <Lock className="size-3.5" /> Закрыть
            </button>
          )}
          <button
            type="button"
            onClick={remove}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> Удалить
          </button>
        </div>
      )}

      {/* Переписка */}
      <div className="flex max-h-[24rem] flex-col gap-3 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          messages.map((m) => {
            const admin = m.is_admin === 1
            return (
              <div key={m.id} className={cn("flex flex-col", admin ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg border px-3 py-2",
                    admin ? "border-primary/30 bg-primary/5" : "border-border bg-background",
                  )}
                >
                  <p className="mb-1 font-mono text-[11px] text-muted-foreground">
                    {admin ? `🛡 ${m.author_nick}` : m.author_nick} · {fmt(m.created_at)}
                  </p>
                  {m.body && <p className="whitespace-pre-wrap break-words text-sm text-foreground">{m.body}</p>}
                  {m.attachment_ext && (
                    <a
                      href={`/api/support/attachment/${m.id}.${m.attachment_ext}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 block"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/support/attachment/${m.id}.${m.attachment_ext}`}
                        alt="Вложение"
                        className="max-h-48 rounded-md border border-border object-contain"
                      />
                    </a>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Форма ответа */}
      <form onSubmit={reply} className="flex flex-col gap-2 border-t border-border pt-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder="Ответ игроку…"
          className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ImagePlus className="size-3.5" />
            {file ? "Заменить скриншот" : "Прикрепить скриншот"}
          </button>
          {file && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="max-w-40 truncate">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} className="text-destructive hover:opacity-80">
                <X className="size-3.5" />
              </button>
            </span>
          )}
          <button
            type="submit"
            disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            Ответить
          </button>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
      </form>
    </Card>
  )
}
