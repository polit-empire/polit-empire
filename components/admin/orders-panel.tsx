"use client"

import { useState } from "react"
import useSWR from "swr"
import { Check, LoaderCircle, RefreshCw, X } from "lucide-react"
import { jsonFetcher, postJson } from "@/lib/fetcher"
import { StatusBadge } from "@/components/admin/ui"

interface OrderRow {
  id: number
  minecraft_nick: string
  kind: string
  title: string
  amount_rub: number
  dc_amount: number
  method: string
  status: string
  created_at: string
}

export function OrdersPanel() {
  const { data, mutate, isLoading } = useSWR<{ orders: OrderRow[] }>("/api/admin/orders", jsonFetcher)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  async function syncDonatello() {
    setSyncing(true)
    setSyncMsg(null)
    setError(null)
    try {
      // Реальная сверка (начисляет заказы). Читаем тело вручную, чтобы увидеть
      // причину даже при статусе 502.
      const resp = await fetch("/api/cron/donatello", { credentials: "same-origin" })
      const res = (await resp.json().catch(() => ({}))) as {
        ok?: boolean
        processed?: number
        skipped?: number
        failed?: number
        total?: number
        message?: string
        error?: string
        status?: number
        body?: string
      }
      if (!resp.ok || res.error) {
        const parts = [res.error || `HTTP ${resp.status}`]
        if (res.status) parts.push(`(API вернул ${res.status})`)
        // Если основной запрос упал — подтягиваем сырой ответ Donatello.
        if (!res.body) {
          const dbg = await fetch("/api/cron/donatello?debug=1", { credentials: "same-origin" })
          const dbgJson = (await dbg.json().catch(() => ({}))) as { body?: string }
          if (dbgJson.body) parts.push(`— ${dbgJson.body.slice(0, 300)}`)
        } else {
          parts.push(`— ${res.body.slice(0, 300)}`)
        }
        setError(`Donatello: ${parts.join(" ")}`)
      } else {
        setSyncMsg(
          res.message ??
            `Проверено донатов: ${res.total ?? 0}. Начислено: ${res.processed ?? 0}, пропущено: ${res.skipped ?? 0}, ошибок: ${res.failed ?? 0}.`,
        )
      }
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка синхронизации Donatello")
    } finally {
      setSyncing(false)
    }
  }

  async function action(orderId: number, act: "confirm" | "cancel") {
    setBusyId(orderId)
    setError(null)
    try {
      await postJson("/api/admin/orders", { order_id: orderId, action: act })
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Заказы MyDonate обрабатываются на стороне MyDonate (оплата и выдача DC в игре). Ручные заказы подтверждайте после поступления оплаты — выдача пройдёт по RCON автоматически.
        </p>
        <button
          type="button"
          disabled={syncing}
          onClick={syncDonatello}
          className="flex shrink-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary disabled:opacity-50"
        >
          {syncing ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Проверить донаты Donatello
        </button>
      </div>
      {syncMsg && <p className="text-sm text-emerald-500">{syncMsg}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {isLoading && (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Загрузка...
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Игрок</th>
              <th className="px-3 py-2 font-medium">Товар</th>
              <th className="px-3 py-2 font-medium">Сумма</th>
              <th className="px-3 py-2 font-medium">Способ</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {data?.orders.map((o) => (
              <tr key={o.id} className="border-b border-border/60">
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{o.id}</td>
                <td className="px-3 py-2 font-mono">{o.minecraft_nick}</td>
                <td className="px-3 py-2">{o.title}</td>
                <td className="px-3 py-2">{o.amount_rub}₽</td>
                <td className="px-3 py-2 text-muted-foreground">{o.method}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={o.status} />
                </td>
                <td className="px-3 py-2">
                  {(o.status === "pending" || o.status === "paid") && (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => action(o.id, "confirm")}
                        aria-label="Подтвердить и выдать"
                        className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {busyId === o.id ? <LoaderCircle className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Выдать
                      </button>
                      <button
                        type="button"
                        disabled={busyId === o.id}
                        onClick={() => action(o.id, "cancel")}
                        aria-label="Отменить"
                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.orders.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">Заказов пока нет.</p>
        )}
      </div>
    </div>
  )
}
