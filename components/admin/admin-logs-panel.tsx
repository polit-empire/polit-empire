"use client"

import { useMemo, useState } from "react"
import useSWRInfinite from "swr/infinite"
import { ChevronDown, LoaderCircle, RefreshCw, ScrollText, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { jsonFetcher } from "@/lib/fetcher"
import { Card, TextInput } from "@/components/admin/ui"

interface AdminLogRow {
  id: number
  admin_nick: string
  action: string
  target_nick: string | null
  detail: string | null
  ip: string | null
  created_at: string
}

type LogsPage = {
  rows: AdminLogRow[]
  page: number
  pageSize: number
  total: number
  hasMore: boolean
}

// Человекочитаемые метки действий + цвет бейджа (деструктивные — красным).
const ACTION_META: Record<string, { label: string; danger?: boolean }> = {
  ban: { label: "Бан", danger: true },
  unban: { label: "Разбан" },
  kick: { label: "Кик", danger: true },
  ban_value: { label: "Бан по значению", danger: true },
  unban_value: { label: "Снятие бана по значению" },
  give_dc: { label: "Выдача DC" },
  take_dc: { label: "Списание DC", danger: true },
  give_privilege: { label: "Выдача привилегии" },
  take_privilege: { label: "Снятие привилегии", danger: true },
  set_password: { label: "Смена пароля" },
  set_nick: { label: "Смена ника" },
  delete_account: { label: "Удаление аккаунта", danger: true },
}

function fmtTime(v: string | null): string {
  if (!v) return "—"
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("ru-RU")
}

export function AdminLogsPanel() {
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")

  const { data, mutate, size, setSize, isLoading, isValidating } = useSWRInfinite<LogsPage>(
    (pageIndex, prev) => {
      if (prev && !prev.hasMore) return null
      return `/api/admin/audit?section=admin&q=${encodeURIComponent(search)}&page=${pageIndex + 1}&pageSize=50`
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
          <ScrollText className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Действия администраторов</h3>
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
                placeholder="Админ / игрок / действие..."
                className="w-60 pl-9"
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
        <p className="p-4 text-sm text-muted-foreground">
          {search ? "Ничего не найдено." : "Действий пока нет."}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <Th>Время</Th>
                  <Th>Админ</Th>
                  <Th>Действие</Th>
                  <Th>Игрок</Th>
                  <Th>Детали</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = ACTION_META[r.action] ?? { label: r.action }
                  return (
                    <tr key={r.id} className="border-b border-border/60 align-top">
                      <Td className="whitespace-nowrap text-muted-foreground">{fmtTime(r.created_at)}</Td>
                      <Td className="font-mono text-foreground">{r.admin_nick}</Td>
                      <Td>
                        <span
                          className={cn(
                            "inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium",
                            meta.danger ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {meta.label}
                        </span>
                      </Td>
                      <Td className="font-mono">{r.target_nick ?? "—"}</Td>
                      <Td className="max-w-md break-words text-muted-foreground">{r.detail || "—"}</Td>
                      <Td className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">{r.ip || "—"}</Td>
                    </tr>
                  )
                })}
              </tbody>
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

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-2 py-2 font-medium">{children}</th>
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-2 py-2", className)}>{children}</td>
}
