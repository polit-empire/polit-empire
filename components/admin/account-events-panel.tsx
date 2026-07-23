"use client"

import { useMemo, useState } from "react"
import useSWRInfinite from "swr/infinite"
import { ChevronDown, LoaderCircle, LogIn, MonitorSmartphone, RefreshCw, Search, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { jsonFetcher } from "@/lib/fetcher"
import { Card, TextInput } from "@/components/admin/ui"

type Section = "registrations" | "logins"

const SUBTABS: Array<{ id: Section; label: string; icon: typeof LogIn }> = [
  { id: "registrations", label: "Регистрации", icon: UserPlus },
  { id: "logins", label: "Входы", icon: LogIn },
]

function fmtTime(v: string | null): string {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("ru-RU")
}

export function AccountEventsPanel() {
  const [section, setSection] = useState<Section>("registrations")

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

      {section === "registrations" ? <RegistrationsView /> : <LoginsView />}
    </div>
  )
}

/* Общая обёртка: заголовок, поиск, таблица, «показать ещё». */
function LogSection<T extends { }>({
  title,
  icon: Icon,
  placeholder,
  section,
  emptyText,
  columns,
  renderRow,
  rowKey,
}: {
  title: string
  icon: typeof LogIn
  placeholder: string
  section: Section
  emptyText: string
  columns: string[]
  renderRow: (row: T) => React.ReactNode
  rowKey: (row: T) => string | number
}) {
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")

  type Page = { rows: T[]; page: number; pageSize: number; total: number; hasMore: boolean }
  const { data, mutate, size, setSize, isLoading, isValidating } = useSWRInfinite<Page>(
    (pageIndex, prev) => {
      if (prev && !prev.hasMore) return null
      return `/api/admin/audit?section=${section}&q=${encodeURIComponent(search)}&page=${pageIndex + 1}&pageSize=50`
    },
    jsonFetcher,
    { revalidateFirstPage: false },
  )
  const rows = useMemo(() => (data ?? []).flatMap((p) => p.rows), [data])
  const total = data?.[0]?.total ?? 0
  const hasMore = data?.[data.length - 1]?.hasMore ?? false

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">{title}</h3>
          <span className="text-xs text-muted-foreground">({total})</span>
        </div>
        <div className="flex items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(query.trim())
              void setSize(1)
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
          <button
            type="button"
            onClick={() => mutate()}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCw className={cn("size-3.5", isValidating && "animate-spin")} />
            Обновить
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Загрузка...
        </div>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{search ? "Ничего не найдено." : emptyText}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c} className="px-2 py-2 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{rows.map((r) => <tr key={rowKey(r)} className="border-b border-border/60 align-top">{renderRow(r)}</tr>)}</tbody>
            </table>
          </div>
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
        </>
      )}
    </Card>
  )
}

/* ----------------------- Регистрации ----------------------- */

interface RegRow {
  minecraft_nick: string
  telegram_id: number | null
  created_at: string | null
  last_login: string | null
  last_ip: string | null
  last_hwid: string | null
  is_banned: number
}

function RegistrationsView() {
  return (
    <LogSection<RegRow>
      title="Зарегистрированные аккаунты"
      icon={UserPlus}
      placeholder="Поиск по нику..."
      section="registrations"
      emptyText="Аккаунтов пока нет."
      columns={["Ник", "Дата регистрации", "Telegram ID", "Последний вход", "IP", "Статус"]}
      rowKey={(r) => r.minecraft_nick}
      renderRow={(r) => (
        <>
          <Td className="font-mono text-foreground">{r.minecraft_nick}</Td>
          <Td className="whitespace-nowrap text-muted-foreground">{fmtTime(r.created_at)}</Td>
          <Td className="font-mono text-muted-foreground">{r.telegram_id ?? "—"}</Td>
          <Td className="whitespace-nowrap text-muted-foreground">{fmtTime(r.last_login)}</Td>
          <Td className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{r.last_ip || "—"}</Td>
          <Td>
            {r.is_banned === 1 ? (
              <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">БАН</span>
            ) : (
              <span className="text-xs text-emerald-500">активен</span>
            )}
          </Td>
        </>
      )}
    />
  )
}

/* ----------------------- Входы ----------------------- */

interface LoginRow {
  id: number
  event_type: string
  minecraft_nick: string | null
  ip: string | null
  hwid: string | null
  launcher_version: string | null
  detail: string | null
  created_at: string
}

const LOGIN_META: Record<string, { label: string; icon: typeof LogIn }> = {
  launcher_login: { label: "Лаунчер", icon: MonitorSmartphone },
  web_login: { label: "Личный кабинет", icon: LogIn },
}

function LoginsView() {
  return (
    <LogSection<LoginRow>
      title="Входы в аккаунты"
      icon={LogIn}
      placeholder="Поиск по нику / IP..."
      section="logins"
      emptyText="Входов пока не зафиксировано."
      columns={["Время", "Тип", "Игрок", "IP", "Версия", "Детали"]}
      rowKey={(r) => r.id}
      renderRow={(r) => {
        const meta = LOGIN_META[r.event_type] ?? { label: r.event_type, icon: LogIn }
        const Icon = meta.icon
        return (
          <>
            <Td className="whitespace-nowrap text-muted-foreground">{fmtTime(r.created_at)}</Td>
            <Td>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                <Icon className="size-3" />
                {meta.label}
              </span>
            </Td>
            <Td className="font-mono text-foreground">{r.minecraft_nick ?? "—"}</Td>
            <Td className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{r.ip || "—"}</Td>
            <Td className="whitespace-nowrap text-muted-foreground">{r.launcher_version ? `v${r.launcher_version}` : "—"}</Td>
            <Td className="max-w-xs break-words text-muted-foreground">{r.detail || "—"}</Td>
          </>
        )
      }}
    />
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-2 py-2", className)}>{children}</td>
}
