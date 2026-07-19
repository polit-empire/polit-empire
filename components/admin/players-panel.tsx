"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import useSWRInfinite from "swr/infinite"
import { Ban, ChevronDown, Coins, Crown, Gamepad2, KeyRound, LoaderCircle, LogOut, MonitorSmartphone, Search, ShieldAlert, ShieldCheck, Trash2, UserCog, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { jsonFetcher, postJson } from "@/lib/fetcher"
import type { DonateProduct } from "@/lib/donate"
import { Card, Field, Select, TextInput } from "@/components/admin/ui"

interface PlayerRow {
  minecraft_nick: string
  is_banned: number
  ban_reason: string | null
  telegram_id: number | null
  last_login: string | null
  last_hwid: string | null
  last_ip: string | null
  launcher_status: string | null
  launcher_online: boolean
  in_game: boolean
  privilege: string | null
  privilege_expires: string | null
  dc: number
}

/** Индикатор статуса лаунчера/игры. */
function StatusDots({ online, inGame }: { online: boolean; inGame: boolean }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      {inGame ? (
        <span className="flex items-center gap-1 text-emerald-500">
          <Gamepad2 className="size-3" /> в игре
        </span>
      ) : online ? (
        <span className="flex items-center gap-1 text-sky-500">
          <MonitorSmartphone className="size-3" /> лаунчер
        </span>
      ) : (
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground/40" /> офлайн
        </span>
      )}
    </span>
  )
}

export function PlayersPanel() {
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<PlayerRow | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  type PlayersPage = {
    players: PlayerRow[]
    page: number
    pageSize: number
    total: number
    hasMore: boolean
  }

  const {
    data: playerPages,
    mutate,
    size,
    setSize,
    isLoading,
    isValidating,
  } = useSWRInfinite<PlayersPage>(
    (pageIndex, previousPage) => {
      if (previousPage && !previousPage.hasMore) return null
      return `/api/admin/players?q=${encodeURIComponent(search)}&page=${pageIndex + 1}&pageSize=50`
    },
    jsonFetcher,
    { revalidateFirstPage: false },
  )
  const players = useMemo(() => {
    const seen = new Set<string>()
    return (playerPages ?? [])
      .flatMap((page) => page.players)
      .filter((player) => {
        const key = player.minecraft_nick.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
  }, [playerPages])
  const total = playerPages?.[0]?.total ?? 0
  const hasMore = playerPages?.[playerPages.length - 1]?.hasMore ?? false
  const loadedStatusCounts = useMemo(
    () => ({
      inGame: players.filter((player) => player.in_game).length,
      launcher: players.filter((player) => !player.in_game && player.launcher_online).length,
      offline: players.filter((player) => !player.in_game && !player.launcher_online).length,
    }),
    [players],
  )

  const { data: prodData } = useSWR<{ products: DonateProduct[] }>("/api/admin/products", jsonFetcher)
  const privileges = (prodData?.products ?? []).filter((p) => p.kind === "privilege")

  // Форма действий
  const [productId, setProductId] = useState<string>("")
  const [dcAmount, setDcAmount] = useState<string>("")
  const [takeGroup, setTakeGroup] = useState<string>("")
  const [reason, setReason] = useState<string>("")
  const [banDevice, setBanDevice] = useState(false)
  const [newNick, setNewNick] = useState<string>("")
  const [newPassword, setNewPassword] = useState<string>("")

  async function changeNick() {
    if (!selected || !newNick.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await postJson<{ message?: string; new_nick?: string }>("/api/admin/action", {
        action: "set_nick",
        nick: selected.minecraft_nick,
        new_nick: newNick.trim(),
      })
      setMsg({ ok: true, text: res.message || "Готово" })
      // Ник — это PK: обновляем выбранного игрока на новый ник.
      if (res.new_nick) setSelected({ ...selected, minecraft_nick: res.new_nick })
      setNewNick("")
      await mutate()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" })
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    if (!selected || !newPassword) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await postJson<{ message?: string }>("/api/admin/action", {
        action: "set_password",
        nick: selected.minecraft_nick,
        password: newPassword,
      })
      setMsg({ ok: true, text: res.message || "Готово" })
      setNewPassword("")
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" })
    } finally {
      setBusy(false)
    }
  }

  async function deleteAccount() {
    if (!selected) return
    if (!window.confirm(`Удалить аккаунт ${selected.minecraft_nick}? Это действие необратимо.`)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await postJson<{ message?: string }>("/api/admin/action", {
        action: "delete_account",
        nick: selected.minecraft_nick,
      })
      setMsg({ ok: true, text: res.message || "Готово" })
      setSelected(null)
      await mutate()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" })
    } finally {
      setBusy(false)
    }
  }

  async function actValue(action: string, kind: "hwid" | "uuid" | "ip", value: string) {
    if (!value) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await postJson<{ message?: string }>("/api/admin/action", { action, kind, value, reason })
      setMsg({ ok: true, text: res.message || "Готово" })
      await mutate()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" })
    } finally {
      setBusy(false)
    }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    if (!selected) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await postJson<{ message?: string }>("/api/admin/action", {
        action,
        nick: selected.minecraft_nick,
        ...extra,
      })
      setMsg({ ok: true, text: res.message || "Готово" })
      await mutate()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Ошибка" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      {/* Список игроков */}
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
              placeholder="Поиск по нику..."
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

        <div className="flex items-center justify-between rounded-md border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" />
            Показано {players.length} из {total}
          </span>
          <span className="flex items-center gap-3">
            <span className="text-emerald-500">В игре: {loadedStatusCounts.inGame}</span>
            <span className="text-sky-500">Лаунчер: {loadedStatusCounts.launcher}</span>
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          {isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" /> Загрузка...
            </div>
          )}
          {players.map((p, index) => {
            const group = playerGroup(p)
            const previousGroup = index > 0 ? playerGroup(players[index - 1]) : null
            return (
              <div key={p.minecraft_nick} className="contents">
                {group !== previousGroup && (
                  <div className="flex items-center gap-2 px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1">
                    <span className={cn("size-2 rounded-full", groupDotClass(group))} />
                    {groupLabel(group)}
                    <span className="font-normal normal-case tracking-normal">
                      ({group === "game" ? loadedStatusCounts.inGame : group === "launcher" ? loadedStatusCounts.launcher : loadedStatusCounts.offline})
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelected(p)
                    setMsg(null)
                    setTakeGroup(p.privilege ?? "")
                    setNewNick("")
                    setNewPassword("")
                  }}
                  className={cnRow(selected?.minecraft_nick === p.minecraft_nick)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-sm text-foreground">{p.minecraft_nick}</span>
                    {p.is_banned === 1 && (
                      <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        БАН
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <StatusDots online={p.launcher_online} inGame={p.in_game} />
                    {p.privilege && (
                      <span className="hidden items-center gap-1 sm:flex">
                        <Crown className="size-3" />
                        {p.privilege}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Coins className="size-3" />
                      {p.dc}
                    </span>
                  </div>
                </button>
              </div>
            )
          })}
          {!isLoading && players.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">Игроки не найдены.</p>
          )}
          {hasMore && (
            <button
              type="button"
              disabled={isValidating}
              onClick={() => void setSize(size + 1)}
              className="mt-2 flex items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {isValidating ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
              Показать ещё
            </button>
          )}
        </div>
      </div>

      {/* Действия */}
      <div>
        {!selected ? (
          <Card className="text-sm text-muted-foreground">Выберите игрока слева для управления.</Card>
        ) : (
          <div className="flex flex-col gap-4">
            <Card>
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="font-mono text-lg font-bold">{selected.minecraft_nick}</h3>
                  <StatusDots online={selected.launcher_online} inGame={selected.in_game} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {selected.privilege ? `Привилегия: ${selected.privilege}` : "Без привилегии"} · {selected.dc} DC
                </span>
              </div>
              <div className="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground">
                <span>HWID: {selected.last_hwid || "—"}</span>
                <span>IP: {selected.last_ip || "—"}</span>
              </div>
              {msg && (
                <p className={cn("mt-2 text-sm", msg.ok ? "text-emerald-500" : "text-destructive")}>{msg.text}</p>
              )}
            </Card>

            {/* Привилегии */}
            <Card className="flex flex-col gap-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-primary" /> Привилегия
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Выдать привилегию">
                  <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                    <option value="">— выберите —</option>
                    {privileges.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.duration_days}д)
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busy || !productId}
                    onClick={() => act("give_privilege", { product_id: Number(productId) })}
                    className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Выдать
                  </button>
                </div>
                <Field label="Снять группу">
                  <TextInput value={takeGroup} onChange={(e) => setTakeGroup(e.target.value)} placeholder="general" />
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busy || !takeGroup}
                    onClick={() => act("take_privilege", { group: takeGroup })}
                    className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                  >
                    Снять
                  </button>
                </div>
              </div>
            </Card>

            {/* DC */}
            <Card className="flex flex-col gap-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Coins className="size-4 text-primary" /> Донат-коины
              </h4>
              <div className="flex gap-2">
                <TextInput
                  type="number"
                  value={dcAmount}
                  onChange={(e) => setDcAmount(e.target.value)}
                  placeholder="Количество DC"
                />
                <button
                  type="button"
                  disabled={busy || !dcAmount}
                  onClick={() => act("give_dc", { amount: Number(dcAmount) })}
                  className="whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Выдать
                </button>
                <button
                  type="button"
                  disabled={busy || !dcAmount}
                  onClick={() => act("take_dc", { amount: Number(dcAmount) })}
                  className="whitespace-nowrap rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50"
                >
                  Забрать
                </button>
              </div>
            </Card>

            {/* Модерация */}
            <Card className="flex flex-col gap-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Ban className="size-4 text-destructive" /> Модерация
              </h4>
              <Field label="Причина (для бана/кика)">
                <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Нарушение правил" />
              </Field>
              {selected.is_banned !== 1 && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={banDevice}
                    onChange={(e) => setBanDevice(e.target.checked)}
                    className="size-4 accent-destructive"
                  />
                  Забанить вместе с устройством (HWID)
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                {selected.is_banned === 1 ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act("unban")}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Разбанить
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act("ban", { reason, hwid: banDevice })}
                    className="flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Ban className="size-4" /> Забанить
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act("kick", { reason })}
                  className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground disabled:opacity-50"
                >
                  <LogOut className="size-4" /> Кикнуть
                </button>
              </div>

              {/* Точечный бан по значению: HWID / IP */}
              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
                <h5 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <ShieldAlert className="size-3.5" /> Быстрый бан устройства/сети
                </h5>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !selected.last_hwid}
                    onClick={() => actValue("ban_value", "hwid", selected.last_hwid || "")}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-destructive hover:text-destructive disabled:opacity-40"
                  >
                    Бан по HWID
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selected.last_hwid}
                    onClick={() => actValue("unban_value", "hwid", selected.last_hwid || "")}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground disabled:opacity-40"
                  >
                    Снять HWID
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selected.last_ip}
                    onClick={() => actValue("ban_value", "ip", selected.last_ip || "")}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-destructive hover:text-destructive disabled:opacity-40"
                  >
                    Бан по IP
                  </button>
                  <button
                    type="button"
                    disabled={busy || !selected.last_ip}
                    onClick={() => actValue("unban_value", "ip", selected.last_ip || "")}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground disabled:opacity-40"
                  >
                    Снять IP
                  </button>
                </div>
              </div>
            </Card>

            {/* Управление аккаунтом */}
            <Card className="flex flex-col gap-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <UserCog className="size-4 text-primary" /> Аккаунт
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Новый ник">
                  <TextInput value={newNick} onChange={(e) => setNewNick(e.target.value)} placeholder="NewNick_123" />
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busy || !newNick.trim()}
                    onClick={changeNick}
                    className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    Сменить ник
                  </button>
                </div>
                <Field label="Новый пароль">
                  <TextInput
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                  />
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={busy || !newPassword}
                    onClick={changePassword}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground disabled:opacity-50"
                  >
                    <KeyRound className="size-4" /> Сменить пароль
                  </button>
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted-foreground">Удаление аккаунта необратимо.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={deleteAccount}
                  className="flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <Trash2 className="size-4" /> Удалить аккаунт
                </button>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

type PlayerGroup = "game" | "launcher" | "offline"

function playerGroup(player: PlayerRow): PlayerGroup {
  if (player.in_game) return "game"
  if (player.launcher_online) return "launcher"
  return "offline"
}

function groupLabel(group: PlayerGroup): string {
  if (group === "game") return "Сейчас в игре"
  if (group === "launcher") return "В лаунчере"
  return "Офлайн"
}

function groupDotClass(group: PlayerGroup): string {
  if (group === "game") return "bg-emerald-500"
  if (group === "launcher") return "bg-sky-500"
  return "bg-muted-foreground/40"
}

function cnRow(active: boolean): string {
  return [
    "flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
    active ? "border-primary bg-card" : "border-border bg-card/50 hover:border-muted-foreground/40",
  ].join(" ")
}
