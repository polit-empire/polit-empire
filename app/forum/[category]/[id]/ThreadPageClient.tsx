"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronRight,
  Pin,
  Lock,
  Unlock,
  PinOff,
  Trash2,
  Edit2,
  VolumeX,
  Check,
  X,
  Clock,
  MessageSquare,
} from "lucide-react"

interface Reply {
  id: number
  author_nick: string
  body: string
  is_deleted: number
  edited_at: string | null
  created_at: string
}

interface Thread {
  id: number
  category_id: number
  category_slug: string
  category_name: string
  author_nick: string
  title: string
  body: string
  status: string
  is_pinned: number
  reply_count: number
  created_at: string
}

interface ThreadData {
  thread: Thread
  replies: Reply[]
  total: number
  page: number
  limit: number
  isAdmin: boolean
  currentUser: string | null
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "только что"
  if (mins < 60) return `${mins} мин. назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн. назад`
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code class=\"rounded bg-muted px-1 py-0.5 font-mono text-sm\">$1</code>")
    .replace(/^### (.+)$/gm, "<h3 class=\"text-base font-bold mt-3 mb-1\">$1</h3>")
    .replace(/^## (.+)$/gm, "<h2 class=\"text-lg font-bold mt-4 mb-2\">$1</h2>")
    .replace(/^# (.+)$/gm, "<h1 class=\"text-xl font-bold mt-4 mb-2\">$1</h1>")
    .replace(/^[-*] (.+)$/gm, "<li class=\"ml-4 list-disc\">$1</li>")
    .replace(/\n/g, "<br>")
}

function UserAvatar({ nick }: { nick: string }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/20 font-mono text-sm font-bold text-primary">
      {nick.slice(0, 2).toUpperCase()}
    </div>
  )
}

function MuteModal({
  nick,
  onClose,
  onMuted,
}: {
  nick: string
  onClose: () => void
  onMuted: () => void
}) {
  const [reason, setReason] = useState("")
  const [duration, setDuration] = useState("7")
  const [busy, setBusy] = useState(false)

  async function mute() {
    setBusy(true)
    await fetch("/api/admin/forum/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nick,
        reason,
        durationDays: duration === "0" ? null : parseInt(duration, 10),
      }),
    })
    setBusy(false)
    onMuted()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <h3 className="font-mono text-lg font-bold">Мут на форуме</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Игрок{" "}
          <span className="font-mono font-semibold text-primary">{nick}</span>{" "}
          не сможет писать на форуме.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Причина
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Укажите причину..."
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Срок
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="1">1 день</option>
              <option value="3">3 дня</option>
              <option value="7">7 дней</option>
              <option value="30">30 дней</option>
              <option value="0">Навсегда</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={mute}
              disabled={busy}
              className="flex-1 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "..." : "Замутить"}
            </button>
            <button
              onClick={onClose}
              className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ThreadPageClient({
  initialData,
  threadId,
  categorySlug,
}: {
  initialData: ThreadData
  threadId: number
  categorySlug: string
}) {
  const router = useRouter()
  const [data, setData] = useState(initialData)
  const [replyBody, setReplyBody] = useState("")
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyErr, setReplyErr] = useState<string | null>(null)
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null)
  const [editBody, setEditBody] = useState("")
  const [muteNick, setMuteNick] = useState<string | null>(null)
  const replyRef = useRef<HTMLDivElement>(null)

  const { thread, replies, isAdmin, currentUser } = data

  async function refresh() {
    const res = await fetch(`/api/forum/threads/${threadId}`, { cache: "no-store" })
    if (res.ok) {
      const d = await res.json()
      setData(d)
    }
  }

  async function sendReply() {
    if (!replyBody.trim()) return
    setReplyBusy(true)
    setReplyErr(null)
    const res = await fetch(`/api/forum/threads/${threadId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyBody.trim() }),
    })
    const json = await res.json()
    setReplyBusy(false)
    if (!res.ok) {
      setReplyErr(json.error || "Ошибка отправки")
    } else {
      setReplyBody("")
      await refresh()
      replyRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }

  async function deleteReply(id: number) {
    if (!confirm("Удалить ответ?")) return
    await fetch(`/api/forum/replies/${id}`, { method: "DELETE" })
    await refresh()
  }

  async function deleteThread() {
    if (!confirm("Удалить тему полностью?")) return
    await fetch(`/api/forum/threads/${threadId}`, { method: "DELETE" })
    router.push(`/forum/${categorySlug}`)
  }

  async function togglePin() {
    await fetch("/api/admin/forum/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, pinned: thread.is_pinned === 0 }),
    })
    await refresh()
  }

  async function toggleClose() {
    await fetch("/api/admin/forum/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        closed: thread.status !== "closed",
      }),
    })
    await refresh()
  }

  async function saveEditReply(id: number) {
    const res = await fetch(`/api/forum/replies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editBody }),
    })
    if (res.ok) {
      setEditingReplyId(null)
      await refresh()
    }
  }

  const isClosed = thread.status === "closed"

  return (
    <main className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <img src="/images/emblem.png" alt="Polit Empire" width={36} height={36} className="rounded" />
            <span className="font-mono text-lg font-bold tracking-tight">Polit Empire</span>
          </Link>
          <nav className="flex items-center gap-1 md:gap-2">
            <Link href="/donate" className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">Донат</Link>
            <Link href="/rules" className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">Правила</Link>
            <Link href="/forum" className="px-3 py-1.5 text-sm text-primary font-medium transition-colors hover:text-foreground">Форум</Link>
            <Link href="/account" className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20">Кабинет</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <Link href="/" className="hover:text-foreground transition-colors">Главная</Link>
          <ChevronRight className="size-4" />
          <Link href="/forum" className="hover:text-foreground transition-colors">Форум</Link>
          <ChevronRight className="size-4" />
          <Link href={`/forum/${thread.category_slug}`} className="hover:text-foreground transition-colors">{thread.category_name}</Link>
          <ChevronRight className="size-4" />
          <span className="text-foreground line-clamp-1">{thread.title}</span>
        </div>

        {/* Thread header */}
        <div className="mb-6 rounded-lg border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2 flex-wrap">
                {thread.is_pinned === 1 && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                    <Pin className="size-3" /> Закреплено
                  </span>
                )}
                {isClosed && (
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Lock className="size-3" /> Закрыто
                  </span>
                )}
              </div>
              <h1 className="font-mono text-2xl font-bold text-foreground">{thread.title}</h1>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-mono font-semibold text-primary">{thread.author_nick}</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {timeAgo(thread.created_at)}
                </span>
              </div>
            </div>

            {/* Admin controls */}
            {isAdmin && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={togglePin}
                  title={thread.is_pinned ? "Открепить" : "Закрепить"}
                  className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-amber-400/40 hover:text-amber-400"
                >
                  {thread.is_pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                </button>
                <button
                  onClick={toggleClose}
                  title={isClosed ? "Открыть тему" : "Закрыть тему"}
                  className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {isClosed ? <Unlock className="size-4" /> : <Lock className="size-4" />}
                </button>
                <button
                  onClick={deleteThread}
                  title="Удалить тему"
                  className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            )}
          </div>

          {/* Thread body */}
          <div
            className="prose prose-sm prose-invert mt-5 max-w-none leading-relaxed text-foreground/90"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(thread.body) }}
          />
        </div>

        {/* Replies */}
        {replies.length > 0 && (
          <div className="mb-6 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {thread.reply_count} {thread.reply_count === 1 ? "ответ" : thread.reply_count < 5 ? "ответа" : "ответов"}
            </h2>
            {replies.map((reply) => (
              <div
                key={reply.id}
                id={`reply-${reply.id}`}
                className={`rounded-lg border border-border bg-card p-5 ${reply.is_deleted ? "opacity-50" : ""}`}
              >
                {reply.is_deleted ? (
                  <p className="text-sm italic text-muted-foreground">[Ответ удалён]</p>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <UserAvatar nick={reply.author_nick} />
                        <div>
                          <span className="font-mono text-sm font-semibold text-primary">
                            {reply.author_nick}
                          </span>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            {timeAgo(reply.created_at)}
                            {reply.edited_at && (
                              <span className="italic">(изменено)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Reply actions */}
                      <div className="flex items-center gap-1">
                        {(isAdmin || currentUser === reply.author_nick) && (
                          <button
                            onClick={() => {
                              setEditingReplyId(reply.id)
                              setEditBody(reply.body)
                            }}
                            title="Редактировать"
                            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Edit2 className="size-3.5" />
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => setMuteNick(reply.author_nick)}
                              title="Замутить на форуме"
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-amber-400"
                            >
                              <VolumeX className="size-3.5" />
                            </button>
                            <button
                              onClick={() => deleteReply(reply.id)}
                              title="Удалить ответ"
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Edit mode */}
                    {editingReplyId === reply.id ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={4}
                          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary resize-y"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveEditReply(reply.id)}
                            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                          >
                            <Check className="size-3" /> Сохранить
                          </button>
                          <button
                            onClick={() => setEditingReplyId(null)}
                            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                          >
                            <X className="size-3" /> Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="text-sm leading-relaxed text-foreground/90"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(reply.body) }}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Reply form */}
        <div className="rounded-lg border border-border bg-card p-5" ref={replyRef}>
          <h3 className="mb-4 flex items-center gap-2 font-mono text-sm font-semibold">
            <MessageSquare className="size-4 text-primary" />
            Ответить
          </h3>

          {!currentUser ? (
            <div className="rounded-md border border-border bg-background p-4 text-center text-sm text-muted-foreground">
              Чтобы ответить, войдите в{" "}
              <Link href="/account" className="text-primary hover:underline">
                личный кабинет
              </Link>
              .
            </div>
          ) : isClosed ? (
            <div className="rounded-md border border-border bg-background p-4 text-center text-sm text-muted-foreground">
              <Lock className="mx-auto mb-2 size-4" />
              Тема закрыта. Новые ответы не принимаются.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-xs text-muted-foreground">
                Поддерживается Markdown: **жирный**, *курсив*, `код`
              </div>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={5}
                placeholder="Напишите ваш ответ..."
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary resize-y"
              />
              {replyErr && <p className="text-sm text-destructive">{replyErr}</p>}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-mono">
                  Вы: <span className="text-primary">{currentUser}</span>
                </span>
                <button
                  onClick={sendReply}
                  disabled={replyBusy || !replyBody.trim()}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {replyBusy ? "Отправка..." : "Отправить ответ"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mute modal */}
      {muteNick && (
        <MuteModal
          nick={muteNick}
          onClose={() => setMuteNick(null)}
          onMuted={() => {}}
        />
      )}
    </main>
  )
}
