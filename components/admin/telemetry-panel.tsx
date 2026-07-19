"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Bug, LoaderCircle, RefreshCw, ShieldAlert, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"
import { jsonFetcher } from "@/lib/fetcher"
import { Card, Select } from "@/components/admin/ui"

type Section = "anticheat" | "errors" | "logs"

const SUBTABS: Array<{ id: Section; label: string; icon: typeof Bug }> = [
  { id: "anticheat", label: "Логи античита", icon: ShieldAlert },
  { id: "errors", label: "Ошибки лаунчера и игры", icon: Bug },
  { id: "logs", label: "Лайв-логи", icon: Terminal },
]

interface PlayerOpt {
  nick: string
  last_ts: string | null
}

/** Выпадающий список игроков (кто присылал телеметрию). */
function PlayerSelect({
  value,
  onChange,
  allowAll,
}: {
  value: string
  onChange: (v: string) => void
  allowAll?: boolean
}) {
  const { data } = useSWR<{ players: PlayerOpt[] }>("/api/admin/telemetry?section=players", jsonFetcher)
  const players = data?.players ?? []
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-xs">
      {allowAll && <option value="">Все игроки</option>}
      {!allowAll && <option value="">— выберите игрока —</option>}
      {players.map((p) => (
        <option key={p.nick} value={p.nick}>
          {p.nick}
        </option>
      ))}
    </Select>
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
  const [nick, setNick] = useState("")
  const key = `/api/admin/telemetry?section=anticheat${nick ? `&nick=${encodeURIComponent(nick)}` : ""}`
  const { data, isLoading, mutate, isValidating } = useSWR<{ events: AcEvent[] }>(key, jsonFetcher, {
    refreshInterval: 15_000,
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
          <PlayerSelect value={nick} onChange={setNick} allowAll />
          <RefreshButton onClick={() => mutate()} busy={isValidating} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : events.length === 0 ? (
        <Empty text="Событий античита нет." />
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
  const [nick, setNick] = useState("")
  const key = `/api/admin/telemetry?section=errors${nick ? `&nick=${encodeURIComponent(nick)}` : ""}`
  const { data, isLoading, mutate, isValidating } = useSWR<{ events: ErrEvent[] }>(key, jsonFetcher, {
    refreshInterval: 15_000,
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
          <PlayerSelect value={nick} onChange={setNick} allowAll />
          <RefreshButton onClick={() => mutate()} busy={isValidating} />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : events.length === 0 ? (
        <Empty text="Ошибок нет." />
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
  session: string | null
  level: string
  source: string
  line: string
  created_at: string
}

function LogsView() {
  const [nick, setNick] = useState("")
  const [live, setLive] = useState(true)
  const key = nick ? `/api/admin/telemetry?section=logs&nick=${encodeURIComponent(nick)}` : null
  const { data, isLoading, mutate, isValidating } = useSWR<{ lines: LogLine[] }>(key, jsonFetcher, {
    refreshInterval: live ? 3_000 : 0,
  })
  const lines = useMemo(() => data?.lines ?? [], [data])

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Terminal className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Лайв-логи игрока</h3>
        </div>
        <div className="flex items-center gap-2">
          <PlayerSelect value={nick} onChange={setNick} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="accent-primary" />
            Live
          </label>
          <RefreshButton onClick={() => mutate()} busy={isValidating} />
        </div>
      </div>

      {!nick ? (
        <Empty text="Выберите игрока, чтобы смотреть логи." />
      ) : isLoading ? (
        <Loading />
      ) : lines.length === 0 ? (
        <Empty text="Логов пока нет (лаунчер их ещё не присылал)." />
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-border bg-[#0b0f14] p-3 font-mono text-xs leading-relaxed">
          {lines.map((l) => (
            <div key={l.id} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground/60">{fmtClock(l.created_at)}</span>
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
