"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  AlertTriangle,
  Check,
  Coins,
  Crown,
  Gift,
  LoaderCircle,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react"
import type { MeResponse } from "@/components/site-header"
import { jsonFetcher, postJson } from "@/lib/fetcher"
import { cn } from "@/lib/utils"
import { VoteSection } from "@/components/vote/vote-section"
import { SupportSection } from "@/components/account/support-section"

interface Order {
  id: number
  title: string
  kind: string
  amountRub: number
  dcAmount: number
  method: string
  status: string
  payUrl: string | null
  createdAt: string
}

interface FullMe extends MeResponse {
  telegramLinked: boolean
  createdAt: string | null
  lastLogin: string | null
  orders: Order[]
}

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Ожидает оплаты", cls: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
  paid: { label: "Оплачен", cls: "text-sky-400 border-sky-400/30 bg-sky-400/10" },
  delivered: { label: "Выдан", cls: "text-primary border-primary/30 bg-primary/10" },
  canceled: { label: "Отменён", cls: "text-muted-foreground border-border bg-muted" },
}

function formatDate(d: string | null): string {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function AccountClient() {
  const { data, error, isLoading, mutate } = useSWR<FullMe>("/api/account/me", jsonFetcher, {
    shouldRetryOnError: false,
  })

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-6xl items-center justify-center px-4 py-24">
        <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // 401 -> показываем форму входа
  if (error || !data) {
    return <LoginForm onSuccess={() => mutate()} />
  }

  return <Dashboard me={data} onChanged={() => mutate()} />
}

/* ------------------------------------------------------------------ */
/* Форма входа                                                         */
/* ------------------------------------------------------------------ */

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await postJson("/api/account/login", { login: login.trim(), password })
      onSuccess()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка входа")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="text-center">
        <h1 className="font-mono text-2xl font-bold">Личный кабинет</h1>
        <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">
          Войди тем же ником и паролем, что и в лаунчере. Аккаунт создаётся в{" "}
          <a
            href="https://t.me/polit_empire_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-4"
          >
            Telegram-боте
          </a>
          .
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">Ник</span>
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            required
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
        {err && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {err}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          Войти
        </button>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Дашборд                                                             */
/* ------------------------------------------------------------------ */

function Dashboard({ me, onChanged }: { me: FullMe; onChanged: () => void }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-bold md:text-3xl">Привет, {me.nick}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Личный кабинет Polit Empire</p>
        </div>
        <Link
          href="/donate"
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <ShoppingBag className="size-4" />
          В магазин
        </Link>
      </div>

      {/* Карточки статуса */}
      <div className="grid gap-4 sm:grid-cols-3">
        {/* Статус аккаунта */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShieldCheck className="size-4" />
            <span className="font-mono text-xs uppercase tracking-wide">Статус аккаунта</span>
          </div>
          {me.isBanned ? (
            <p className="mt-3 font-mono text-lg font-bold text-destructive">Заблокирован</p>
          ) : (
            <p className="mt-3 font-mono text-lg font-bold text-primary">Активен</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {me.isBanned ? me.banReason || "Причина не указана" : `В игре с ${formatDate(me.createdAt)}`}
          </p>
        </div>

        {/* Привилегия */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Crown className="size-4" />
            <span className="font-mono text-xs uppercase tracking-wide">Привилегия</span>
          </div>
          {me.privilege ? (
            <>
              <p className="mt-3 font-mono text-lg font-bold text-foreground">
                {me.privilege.name || me.privilege.group}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {me.privilege.expiresAt ? `До ${formatDate(me.privilege.expiresAt)}` : "Бессрочно"}
              </p>
            </>
          ) : (
            <>
              <p className="mt-3 font-mono text-lg font-bold text-muted-foreground">Нет</p>
              <Link href="/donate" className="mt-1 inline-block text-xs text-primary underline underline-offset-4">
                Купить привилегию
              </Link>
            </>
          )}
        </div>

        {/* Баланс DC */}
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Coins className="size-4" />
            <span className="font-mono text-xs uppercase tracking-wide">Баланс</span>
          </div>
          <p className="mt-3 font-mono text-lg font-bold text-primary">{me.balance} DC</p>
          <Link href="/donate#dc" className="mt-1 inline-block text-xs text-primary underline underline-offset-4">
            Пополнить
          </Link>
        </div>
      </div>

      {/* Корзина: оплаченные, но не выданные заказы (синхронизирована с модом) */}
      <CartSection onChanged={onChanged} />

      {/* Бонусы за голос на мониторингах */}
      <VoteSection variant="account" />

      {/* Тикеты поддержки */}
      <SupportSection />

      {/* История заказов */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-mono text-base font-semibold">История покупок</h2>
        </div>
        {me.orders.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Пока нет покупок. Загляни в{" "}
            <Link href="/donate" className="text-primary underline underline-offset-4">
              магазин
            </Link>
            .
          </p>
        ) : (
          <div className="divide-y divide-border">
            {me.orders.map((o) => (
              <OrderRow key={o.id} order={o} onChanged={onChanged} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Корзина: оплаченные заказы, ожидающие выдачи (синхр. с модом)       */
/* ------------------------------------------------------------------ */

interface CartItem {
  orderId: number
  kind: string
  title: string
  icon: string | null
  amountRub: number
  dcAmount: number
  createdAt: string
}

function CartSection({ onChanged }: { onChanged: () => void }) {
  const { data, mutate: mutateCart } = useSWR<{ items: CartItem[] }>("/api/account/cart", jsonFetcher, {
    // Корзина синхронизирована с модом — освежаем её периодически, чтобы
    // покупки из игры появлялись на сайте без перезагрузки.
    refreshInterval: 15_000,
    shouldRetryOnError: false,
  })
  const items = data?.items ?? []

  if (items.length === 0) return null

  return (
    <section className="rounded-lg border border-primary/30 bg-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <ShoppingCart className="size-4 text-primary" />
        <h2 className="font-mono text-base font-semibold">Корзина</h2>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">
          {items.length}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">Нажми «Забрать», находясь в игре</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((it) => (
          <CartRow
            key={it.orderId}
            item={it}
            onClaimed={() => {
              void mutateCart()
              onChanged()
            }}
          />
        ))}
      </div>
    </section>
  )
}

function CartRow({ item, onClaimed }: { item: CartItem; onClaimed: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function claim() {
    if (busy) return
    setErr(null)
    setBusy(true)
    try {
      await postJson("/api/account/cart/claim", { orderId: item.orderId })
      onClaimed()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось забрать")
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          <Gift className="size-4 text-primary" />
        </div>
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground">
            #{item.orderId} · {formatDate(item.createdAt)}
            {err && <span className="ml-1 text-destructive">· {err}</span>}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={claim}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 font-mono text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Забрать
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Строка заказа с возможностью отмены                                 */
/* ------------------------------------------------------------------ */

function OrderRow({ order: o, onChanged }: { order: Order; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const st = STATUS_LABEL[o.status] ?? STATUS_LABEL.pending

  async function cancel() {
    if (busy) return
    setBusy(true)
    try {
      await postJson("/api/account/orders/cancel", { orderId: o.id })
      onChanged()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate font-mono text-sm font-medium">{o.title}</p>
        <p className="text-xs text-muted-foreground">
          #{o.id} · {formatDate(o.createdAt)} · {o.method.toUpperCase()}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm">{o.amountRub > 0 ? `${o.amountRub} ₽` : `${o.dcAmount} DC`}</span>
        {o.status === "pending" && o.payUrl && (
          <a
            href={o.payUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-mono text-xs underline underline-offset-2",
              st.cls,
            )}
          >
            Оплатить
          </a>
        )}
        {(o.status !== "pending" || !o.payUrl) && (
          <span className={cn("rounded-full border px-2.5 py-0.5 font-mono text-xs", st.cls)}>{st.label}</span>
        )}
        {o.status === "pending" && (
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 font-mono text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
          >
            {busy && <LoaderCircle className="size-3 animate-spin" />}
            Отменить
          </button>
        )}
      </div>
    </div>
  )
}
