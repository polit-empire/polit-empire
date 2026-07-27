"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Bug, LoaderCircle, RefreshCw, Search, ShieldAlert, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"
import { jsonFetcher } from "@/lib/fetcher"
import { Card, TextInput } from "@/components/admin/ui"

type Section = "anticheat" | "errors" | "logs"

const SUBTABS: Array<{ id: Section; label: string; icon: typeof Bug }> = [
  { id: "anticheat", label: "Логи античита", icon: ShieldAlert },
  { id: "errors", label: "Ошибки лаунчера и игры", icon: Bug },
  { id: "logs", label: "Лайв-логи", icon: Terminal },
]

/**
 * Поиск по нику (как в разделе «Игроки»): текстовое поле + кнопка «Найти».
 * Отправляет введённое значение наверх только по submit, чтобы не дёргать
 * сервер на каждый символ. Пустой запрос трактуется как «показать всё».
 */
function SearchBox({
  onSearch,
  placeholder,
}: {
  onSearch: (value: string) => void
  placeholder: string
}) {
  const [query, setQuery] = useState("")
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(query.trim())
      }}
      className="flex gap-2"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-56 pl-9"
        />
      </div>
      <button
        type="submit"
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        Найти
      </button>
    </form>
  )
}

function fmtTime(v: string | null): string {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("ru-RU")
}

export function TelemetryPanel() {
  const [section, setSection] = useState<Section>("anticheat")

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {SUBTABS.map((t) => {
          const Icon = t.icon
          const active = section === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSection(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {section === "anticheat" && <AnticheatView />}
      {section === "errors" && <ErrorsView />}
      {section === "logs" && <LogsView />}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* 1. Логи античита                                                  */
/* ---------------------------------------------------------------- */

interface AcEvent {
  id: number
  minecraft_nick: string | null
  hwid: string | null
  kind: string
  detail: string | null
  source: string
  created_at: string
}

// Серьёзные события (подсвечиваются красным) — синхронизировано с сервером
// (SEVERE_KINDS в app/api/launcher/anticheat/route.ts). Остальные виды
// (overlay_suspicious, suspicious_executable_memory, suspicious_thread,
// unsigned_module, signed_unknown_module, temp_module) — для ручного разбора.
const SEVERE = new Set([
  "injected_module",
  "cheat_module",
  "module_tampered",
  "debugger",
  "overlay_confirmed",
  "overlay_blocked",
  "heartbeat_lost",
  "hwid_banned",
])

function AnticheatView() {
  const [q, setQ] = useState("")
  const key = `/api/admin/telemetry?section=anticheat${q ? `&q=${encodeURIComponent(q)}` : ""}`
  const { data, isLoading, mutate, isValidating } = useSWR<{ events: AcEvent[] }>(key, jsonFetcher, {
    refreshInterval: 30_000,
  })
  const events = data?.events ?? []

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">События античита</h3>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox onSearch={setQ} placeholder="Поиск по нику / детали / типу..." />
          <RefreshButton onClick={() => mutate()} busy={isValidating} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : events.length === 0 ? (
        <Empty text={q ? "Ничего не найдено." : "Событий античита нет."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <Th>Время</Th>
                <Th>Игрок</Th>
                <Th>Тип</Th>
                <Th>Детали</Th>
                <Th>Источник</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border/60 align-top">
                  <Td className="whitespace-nowrap text-muted-foreground">{fmtTime(e.created_at)}</Td>
                  <Td className="font-mono">{e.minecraft_nick ?? "—"}</Td>
                  <Td>
                    <span
                      className={cn(
                        "inline-block rounded px-1.5 py-0.5 text-xs font-medium",
                        SEVERE.has(e.kind)
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {e.kind}
                    </span>
                  </Td>
                  <Td className="max-w-md break-words text-muted-foreground">{e.detail || "—"}</Td>
                  <Td className="text-muted-foreground">{e.source}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ---------------------------------------------------------------- */
/* 2. Ошибки лаунчера и игры                                         */
/* ---------------------------------------------------------------- */

interface ErrEvent {
  id: number
  event_type: string
  minecraft_nick: string | null
  launcher_version: string | null
  os: string | null
  java_version: string | null
  message: string | null
  created_at: string
}

const EVENT_LABELS: Record<string, string> = {
  game_crash: "Краш игры",
  download_error: "Ошибка загрузки",
  auth_error: "Ошибка входа",
  error: "Ошибка",
}

function ErrorsView() {
  const [q, setQ] = useState("")
  const key = `/api/admin/telemetry?section=errors${q ? `&q=${encodeURIComponent(q)}` : ""}`
  const { data, isLoading, mutate, isValidating } = useSWR<{ events: ErrEvent[] }>(key, jsonFetcher, {
    refreshInterval: 30_000,
  })
  const events = data?.events ?? []

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bug className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Ошибки лаунчера и игры</h3>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox onSearch={setQ} placeholder="Поиск по нику / тексту..." />
          <RefreshButton onClick={() => mutate()} busy={isValidating} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : events.length === 0 ? (
        <Empty text={q ? "Ничего не найдено." : "Ошибок нет."} />
      ) : (
        <div className="flex flex-col gap-2">
          {events.map((e) => (
            <div key={e.id} className="rounded-md border border-border bg-card/50 p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">
                  {EVENT_LABELS[e.event_type] ?? e.event_type}
                </span>
                <span className="font-mono text-foreground">{e.minecraft_nick ?? "аноним"}</span>
                <span className="text-muted-foreground">{fmtTime(e.created_at)}</span>
                {e.launcher_version && <span className="text-muted-foreground">v{e.launcher_version}</span>}
                {e.os && <span className="text-muted-foreground">{e.os}</span>}
                {e.java_version && <span className="text-muted-foreground">Java {e.java_version}</span>}
              </div>
              {e.message && (
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs text-foreground">
                  {e.message}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/* ---------------------------------------------------------------- */
/* 3. Лайв-логи                                                      */
/* ---------------------------------------------------------------- */

interface LogLine {
  id: number
  minecraft_nick: string | null
  session: string | null
  level: string
  source: string
  line: string
  created_at: string
}

function LogsView() {
  const [q, setQ] = useState("")
  const [live, setLive] = useState(true)
  const key = `/api/admin/telemetry?section=logs${q ? `&q=${encodeURIComponent(q)}` : ""}`
  const { data, isLoading, mutate, isValidating } = useSWR<{ lines: LogLine[] }>(key, jsonFetcher, {
    refreshInterval: live ? 3_000 : 0,
  })
  const lines = useMemo(() => data?.lines ?? [], [data])

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Лайв-логи{q ? ` · ${q}` : " · все игроки"}</h3>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox onSearch={setQ} placeholder="Поиск по нику..." />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-primary" />
            Live
          </label>
          <RefreshButton onClick={() => mutate()} busy={isValidating} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : lines.length === 0 ? (
        <Empty text={q ? "Логов по этому нику нет." : "Логов пока нет (лаунчер их ещё не присылал)."} />
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-border bg-[#0b0f14] p-3 font-mono text-xs leading-relaxed">
          {lines.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/60">{fmtClock(l.created_at)}</span>
              {!q && l.minecraft_nick && (
                <span className="shrink-0 text-sky-400/80">{l.minecraft_nick}</span>
              )}
              <span className={cn("shrink-0 uppercase", levelColor(l.level))}>{l.level}</span>
              <span className="whitespace-pre-wrap break-all text-foreground/90">{l.line}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function fmtClock(v: string): string {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ru-RU")
}

function levelColor(level: string): string {
  switch (level) {
    case "error":
      return "text-destructive"
    case "warn":
      return "text-amber-400"
    case "debug":
      return "text-sky-400"
    default:
      return "text-emerald-400"
  }
}

/* ---------------------------------------------------------------- */
/* Мелкие вспомогательные компоненты                                 */
/* ---------------------------------------------------------------- */

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 font-medium">{children}</th>
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-2 py-2", className)}>{children}</td>
}
function Loading() {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" /> Загрузка...
    </div>
  )
}
function Empty({ text }: { text: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{text}</p>
}
function RefreshButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
      Обновить
    </button>
  )
}
