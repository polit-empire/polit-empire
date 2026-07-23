'use client'

import { useRef, useState } from 'react'
import useSWR from 'swr'
import {
  AlertTriangle,
  ArrowLeft,
  ImagePlus,
  LifeBuoy,
  LoaderCircle,
  Plus,
  Send,
  X,
} from 'lucide-react'
import { jsonFetcher } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

interface TicketListItem {
  id: number
  subject: string
  status: 'open' | 'answered' | 'closed'
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

const STATUS_META: Record<TicketListItem['status'], { label: string; cls: string }> = {
  open: { label: 'Ожидает ответа', cls: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  answered: { label: 'Вам ответили', cls: 'text-primary border-primary/30 bg-primary/10' },
  closed: { label: 'Закрыт', cls: 'text-muted-foreground border-border bg-muted' },
}

function fmt(d: string): string {
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? d : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export function SupportSection() {
  const { data, mutate } = useSWR<{ tickets: TicketListItem[] }>('/api/account/tickets', jsonFetcher, {
    shouldRetryOnError: false,
  })
  const tickets = data?.tickets ?? []

  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <LifeBuoy className="size-4 text-primary" />
        <h2 className="font-mono text-base font-semibold">Поддержка</h2>
        {openId === null && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="ml-auto flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" />
            Новый тикет
          </button>
        )}
      </div>

      {openId !== null ? (
        <TicketThread
          ticketId={openId}
          onBack={() => {
            setOpenId(null)
            void mutate()
          }}
        />
      ) : creating ? (
        <NewTicketForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            void mutate()
            setOpenId(id)
          }}
        />
      ) : tickets.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          У вас пока нет обращений. Нажмите «Новый тикет», если нужна помощь администрации.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {tickets.map((t) => {
            const st = STATUS_META[t.status]
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(t.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-background/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium">
                      #{t.id} · {t.subject}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmt(t.last_message_at)} · {t.message_count} сообщ.
                    </p>
                  </div>
                  <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-xs', st.cls)}>
                    {st.label}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------- Новый тикет ------------------------------- */

function NewTicketForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('subject', subject.trim())
      fd.append('body', body.trim())
      if (file) fd.append('image', file)
      const res = await fetch('/api/account/tickets', { method: 'POST', body: fd, credentials: 'same-origin' })
      const json = (await res.json().catch(() => ({}))) as { id?: number; error?: string }
      if (!res.ok) throw new Error(json.error || `Ошибка ${res.status}`)
      onCreated(json.id as number)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать тикет')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted-foreground">Тема</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={160}
          required
          placeholder="Кратко опишите проблему"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted-foreground">Сообщение</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          required
          rows={5}
          placeholder="Подробно опишите ситуацию: что произошло, когда, ваш ник и т.д."
          className="resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <AttachmentPicker file={file} onPick={setFile} />

      {err && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {err}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          Отправить
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 font-mono text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Отмена
        </button>
      </div>
    </form>
  )
}

/* ------------------------------- Переписка -------------------------------- */

function TicketThread({ ticketId, onBack }: { ticketId: number; onBack: () => void }) {
  const { data, mutate, isLoading } = useSWR<{ ticket: TicketListItem; messages: TicketMessage[] }>(
    `/api/account/tickets/${ticketId}`,
    jsonFetcher,
    { refreshInterval: 20_000, shouldRetryOnError: false },
  )
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ticket = data?.ticket
  const messages = data?.messages ?? []

  async function reply(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setErr(null)
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('body', body.trim())
      if (file) fd.append('image', file)
      const res = await fetch(`/api/account/tickets/${ticketId}`, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || `Ошибка ${res.status}`)
      setBody('')
      setFile(null)
      await mutate()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось отправить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          К списку
        </button>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">
            #{ticketId}
            {ticket ? ` · ${ticket.subject}` : ''}
          </p>
        </div>
        {ticket && (
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-xs',
              STATUS_META[ticket.status].cls,
            )}
          >
            {STATUS_META[ticket.status].label}
          </span>
        )}
      </div>

      <div className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto px-5 py-4">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>

      <form onSubmit={reply} className="flex flex-col gap-3 border-t border-border px-5 py-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={3}
          placeholder={ticket?.status === 'closed' ? 'Тикет закрыт — новый ответ откроет его снова' : 'Ваш ответ…'}
          className="resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <AttachmentPicker file={file} onPick={setFile} />
        {err && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          Отправить
        </button>
      </form>
    </div>
  )
}

function MessageBubble({ m }: { m: TicketMessage }) {
  const admin = m.is_admin === 1
  return (
    <div className={cn('flex flex-col gap-1', admin ? 'items-start' : 'items-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          admin ? 'border-primary/30 bg-primary/5' : 'border-border bg-background',
        )}
      >
        <p className="mb-1 font-mono text-[11px] text-muted-foreground">
          {admin ? '🛡 Поддержка' : m.author_nick} · {fmt(m.created_at)}
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
}

/* --------------------------- Выбор вложения ------------------------------- */

function AttachmentPicker({ file, onPick }: { file: File | null; onPick: (f: File | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ImagePlus className="size-3.5" />
        {file ? 'Заменить скриншот' : 'Прикрепить скриншот'}
      </button>
      {file && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="max-w-40 truncate">{file.name}</span>
          <button type="button" onClick={() => onPick(null)} className="text-destructive hover:opacity-80">
            <X className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  )
}
