"use client"

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Check, Coins, Copy, CreditCard, Crown, ExternalLink, LoaderCircle, Package, Sparkles, Tag, Wallet, X } from "lucide-react"
import type { MeResponse } from "@/components/site-header"
import { jsonFetcher, postJson } from "@/lib/fetcher"
import { cn } from "@/lib/utils"
import { VoteSection } from "@/components/vote/vote-section"

interface Product {
  id: number
  kind: "privilege" | "dc" | "item" | "other"
  name: string
  description: string | null
  priceRub: number
  groupName: string | null
  durationDays: number
  dcAmount: number
  accent: string
}

interface ProductsResponse {
  products: Product[]
  dcBonus: { threshold: number; percent: number }
}

const ACCENT: Record<string, string> = {
  sky: "border-sky-400/40 text-sky-300",
  emerald: "border-primary/50 text-primary",
  amber: "border-amber-400/40 text-amber-300",
  rose: "border-rose-400/40 text-rose-300",
}

function accentCls(a: string): string {
  return ACCENT[a] ?? ACCENT.emerald
}

type CategoryTab = "all" | "privilege" | "item" | "dc" | "other"

export function DonateClient() {
  const { data } = useSWR<ProductsResponse>("/api/donate/products", jsonFetcher)
  const { data: me } = useSWR<MeResponse>("/api/account/me", jsonFetcher, { shouldRetryOnError: false })
  const [buying, setBuying] = useState<{ product?: Product; customDc?: number } | null>(null)
  const [tab, setTab] = useState<CategoryTab>("all")

  const privileges = data?.products.filter((p) => p.kind === "privilege") ?? []
  const items = data?.products.filter((p) => p.kind === "item") ?? []
  const dcPacks = data?.products.filter((p) => p.kind === "dc") ?? []
  const others = data?.products.filter((p) => p.kind === "other") ?? []
  const bonus = data?.dcBonus ?? { threshold: 250, percent: 10 }

  const showPrivileges = (tab === "all" || tab === "privilege") && privileges.length > 0
  const showItems = (tab === "all" || tab === "item") && items.length > 0
  const showDc = tab === "all" || tab === "dc"
  const showOthers = (tab === "all" || tab === "other") && others.length > 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12">
      {/* Заголовок */}
      <div className="text-center">
        <h1 className="text-balance font-mono text-3xl font-bold md:text-4xl">Донат Polit Empire</h1>
        <p className="mx-auto mt-3 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
          Поддержи развитие сервера и получи привилегии или донат-коины. Всё выдаётся автоматически на твой аккаунт{" "}
          {me ? (
            <span className="font-mono text-foreground">{me.nick}</span>
          ) : (
            <Link href="/account" className="text-primary underline underline-offset-4">
              после входа
            </Link>
          )}
          .
        </p>
      </div>

      {/* Переключатель категорий */}
      <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-border bg-card/50 p-1.5">
        <button
          type="button"
          onClick={() => setTab("all")}
          className={cn(
            "rounded-md px-4 py-2 font-mono text-sm font-semibold transition-all",
            tab === "all" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Все товары
        </button>
        <button
          type="button"
          onClick={() => setTab("privilege")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-2 font-mono text-sm font-semibold transition-all",
            tab === "privilege" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Crown className="size-4" /> Привилегии
        </button>
        <button
          type="button"
          onClick={() => setTab("item")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-2 font-mono text-sm font-semibold transition-all",
            tab === "item" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Package className="size-4" /> Предметы
        </button>
        <button
          type="button"
          onClick={() => setTab("dc")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-2 font-mono text-sm font-semibold transition-all",
            tab === "dc" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Coins className="size-4" /> DC
        </button>
        <button
          type="button"
          onClick={() => setTab("other")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-4 py-2 font-mono text-sm font-semibold transition-all",
            tab === "other" ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Tag className="size-4" /> Другое
        </button>
      </div>

      {/* Привилегии */}
      {showPrivileges && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <Crown className="size-5 text-primary" />
            <h2 className="font-mono text-xl font-bold">Привилегии</h2>
            <span className="text-sm text-muted-foreground">· покупка за DC · цена за 1 месяц</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {privileges.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-lg border bg-card p-5 transition-transform hover:-translate-y-1",
                  accentCls(p.accent),
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-lg font-bold text-foreground">{p.name}</h3>
                  <Crown className={cn("size-5", accentCls(p.accent))} />
                </div>
                <p className="mt-2 min-h-[3.5rem] text-sm leading-relaxed text-muted-foreground">{p.description}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-mono text-2xl font-bold text-foreground">{p.priceRub}</span>
                  <span className="text-sm text-muted-foreground">DC / мес</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBuying({ product: p })}
                  className="mt-4 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Купить за DC
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Предметы */}
      {showItems && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <Package className="size-5 text-primary" />
            <h2 className="font-mono text-xl font-bold">Предметы</h2>
            <span className="text-sm text-muted-foreground">· покупка в игру за DC</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {items.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-lg border bg-card p-5 transition-transform hover:-translate-y-1",
                  accentCls(p.accent),
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-lg font-bold text-foreground">{p.name}</h3>
                  <Package className={cn("size-5", accentCls(p.accent))} />
                </div>
                <p className="mt-2 min-h-[3.5rem] text-sm leading-relaxed text-muted-foreground">{p.description}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-mono text-2xl font-bold text-foreground">{p.priceRub}</span>
                  <span className="text-sm text-muted-foreground">DC</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBuying({ product: p })}
                  className="mt-4 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Купить за DC
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Донат-коины */}
      {showDc && (
        <section id="dc" className="flex flex-col gap-6 scroll-mt-20">
          <div className="flex flex-wrap items-center gap-2">
            <Coins className="size-5 text-primary" />
            <h2 className="font-mono text-xl font-bold">Донат-коины (DC)</h2>
            <span className="text-sm text-muted-foreground">· 1 ₽ = 1 DC</span>
            <span className="ml-auto flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs text-primary">
              <Sparkles className="size-3.5" />
              +{bonus.percent}% от {bonus.threshold} DC
            </span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {dcPacks.map((p) => {
              const packBonus = p.dcAmount >= bonus.threshold ? Math.floor((p.dcAmount * bonus.percent) / 100) : 0
              return (
                <div
                  key={p.id}
                  className={cn(
                    "flex flex-col rounded-lg border bg-card p-5 transition-transform hover:-translate-y-1",
                    accentCls(p.accent),
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-lg font-bold text-foreground">{p.dcAmount} DC</h3>
                    <Coins className={cn("size-5", accentCls(p.accent))} />
                  </div>
                  {packBonus > 0 && (
                    <p className="mt-1 font-mono text-xs text-primary">+{packBonus} DC бонус</p>
                  )}
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-bold text-foreground">{p.priceRub}</span>
                    <span className="text-sm text-muted-foreground">₽</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBuying({ product: p })}
                    className="mt-4 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Пополнить
                  </button>
                </div>
              )
            })}
          </div>
          <CustomDcCard bonus={bonus} onBuy={(amount) => setBuying({ customDc: amount })} />
        </section>
      )}

      {/* Другое */}
      {showOthers && (
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-2">
            <Tag className="size-5 text-primary" />
            <h2 className="font-mono text-xl font-bold">Другое</h2>
            <span className="text-sm text-muted-foreground">· дополнительные услуги</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {others.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-lg border bg-card p-5 transition-transform hover:-translate-y-1",
                  accentCls(p.accent),
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-mono text-lg font-bold text-foreground">{p.name}</h3>
                  <Tag className={cn("size-5", accentCls(p.accent))} />
                </div>
                <p className="mt-2 min-h-[3.5rem] text-sm leading-relaxed text-muted-foreground">{p.description}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="font-mono text-2xl font-bold text-foreground">{p.priceRub}</span>
                  <span className="text-sm text-muted-foreground">DC</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBuying({ product: p })}
                  className="mt-4 rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  Купить за DC
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Бонусы за голос на мониторингах */}
      <section id="vote" className="scroll-mt-20">
        <VoteSection variant={me ? "account" : "public"} />
      </section>

      {buying && (
        <PurchaseModal
          product={buying.product}
          customDc={buying.customDc}
          loggedIn={Boolean(me)}
          balance={me?.balance ?? 0}
          onClose={() => setBuying(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Произвольное пополнение DC                                          */
/* ------------------------------------------------------------------ */

function CustomDcCard({
  bonus,
  onBuy,
}: {
  bonus: { threshold: number; percent: number }
  onBuy: (amount: number) => void
}) {
  const MIN = 50
  const MAX = 10000
  const STEP = 50
  const [amount, setAmount] = useState(bonus.threshold)
  const packBonus = amount >= bonus.threshold ? Math.floor((amount * bonus.percent) / 100) : 0
  const percent = ((amount - MIN) / (MAX - MIN)) * 100

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="custom-dc" className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          К зачислению
        </label>
        <span className="font-mono text-2xl font-bold text-foreground">
          {amount + packBonus} <span className="text-base text-muted-foreground">DC</span>
          {packBonus > 0 && <span className="ml-1 text-base text-primary">(+{packBonus})</span>}
        </span>
      </div>

      <div>
        <input
          id="custom-dc"
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          aria-label="Сумма пополнения DC"
          className="h-2 w-full cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          style={{
            background: `linear-gradient(to right, var(--color-primary) ${percent}%, var(--color-muted) ${percent}%)`,
          }}
        />
        <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted-foreground">
          <span>{MIN}</span>
          <span>{MAX}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
        <div className="text-sm text-muted-foreground">
          <p>
            К оплате: <span className="font-mono text-foreground">{amount} ₽</span>
          </p>
          {packBonus > 0 && (
            <p className="text-xs">
              Бонус +{bonus.percent}% при пополнении от {bonus.threshold} DC
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onBuy(amount)}
          className="rounded-md bg-primary px-6 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Пополнить
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Модалка покупки                                                     */
/* ------------------------------------------------------------------ */

function PurchaseModal({
  product,
  customDc,
  loggedIn,
  balance,
  onClose,
}: {
  product?: Product
  customDc?: number
  loggedIn: boolean
  balance: number
  onClose: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{
    payUrl: string | null
    manual: boolean
    delivered?: boolean
    orderCode?: string | null
    amountUah?: number | null
    requiresConfirmation?: boolean
  } | null>(null)
  const [copied, setCopied] = useState(false)

  const isPrivilege = product?.kind === "privilege"
  const title = product ? product.name : `Пополнение ${customDc} DC`
  const priceRub = product ? product.priceRub : customDc ?? 0
  const costDc = product?.priceRub ?? 0
  const notEnough = isPrivilege && balance < costDc

  async function buy(method: "mydonate" | "easydonate" | "millida" | "donatello" | "dc") {
    setErr(null)
    setBusy(method)
    try {
      const body = product ? { productId: product.id, method } : { customDc, method }
      const res = await postJson<{
        ok?: boolean
        error?: string
        payUrl: string | null
        manual: boolean
        delivered?: boolean
        orderCode?: string | null
        amountUah?: number | null
        requiresConfirmation?: boolean
      }>("/api/donate/purchase", body)
      // Бизнес-отказ приходит с HTTP 200 (чтобы прокси не подменял тело), но с
      // ok:false и текстом причины от EasyDonate — показываем её пользователю.
      if (res.ok === false || res.error) {
        setErr(res.error || "Не удалось создать платёж")
        return
      }
      setResult(res)
      // Donatello требует подтверждения перед переходом (экран с кодом заказа).
      // Для остальных провайдеров редиректим автоматически в текущей вкладке.
      if (res.requiresConfirmation) {
        return
      }
      if (res.payUrl) {
        window.location.assign(res.payUrl)
        return
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка покупки")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-mono text-lg font-bold">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isPrivilege ? `Привилегия на ${product?.durationDays} дней` : "Пополнение донат-коинов"}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {!loggedIn ? (
          <div className="mt-6 rounded-md border border-border bg-background p-4 text-center">
            <p className="text-sm text-muted-foreground">Чтобы купить, войдите в личный кабинет.</p>
            <Link
              href="/account"
              className="mt-3 inline-block rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground"
            >
              Войти
            </Link>
          </div>
        ) : result ? (
          result.requiresConfirmation && result.orderCode ? (
            <div className="mt-6 flex flex-col gap-4">
              <div className="rounded-md border border-amber-400/40 bg-amber-500/10 p-4 text-center">
                <p className="text-sm font-semibold text-amber-200">Важная информация перед оплатой</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Оплата через Donatello. Вам нужно вставить код заказа в поле комментария к донату.
                </p>
              </div>
              <div className="rounded-md border border-border bg-background p-4">
                <p className="text-sm text-muted-foreground">Сумма к оплате:</p>
                <p className="mt-1 font-mono text-2xl font-bold">{result.amountUah} ₴</p>
                <p className="mt-1 text-xs text-muted-foreground">1 гривна = 1 DC (бонус применяется автоматически)</p>
              </div>
              <div className="rounded-md border border-primary/40 bg-primary/10 p-4">
                <p className="text-sm font-semibold text-foreground">Ваш код заказа:</p>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
                  <span className="font-mono text-lg font-bold text-primary">{result.orderCode}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (result.orderCode) {
                        void navigator.clipboard.writeText(result.orderCode)
                        setCopied(true)
                        setTimeout(() => setCopied(false), 2000)
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Скопировано" : "Копировать"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Скопируйте код и вставьте его в поле сообщения/комментария на странице Donatello без изменений.
                </p>
              </div>
              <a
                href={result.payUrl ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Wallet className="size-4" />Я скопировал код — перейти в Donatello
              </a>
              <Link href="/account" className="text-center text-sm text-primary underline underline-offset-4">
                В личный кабинет
              </Link>
            </div>
          ) : (
            <div className="mt-6 flex flex-col items-center gap-3 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/15">
                <Check className="size-6 text-primary" />
              </div>
              {result.delivered ? (
                <p className="text-sm text-foreground">Готово! Покупка выдана на аккаунт.</p>
              ) : result.payUrl ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    Заказ создан. Сейчас откроется страница оплаты — после оплаты покупка выдастся автоматически.
                  </p>
                  <a
                    href={result.payUrl}
                    className="rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    Перейти к оплате
                  </a>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Заказ создан и ожидает ручного подтверждения администратором (провайдер оплаты пока не настроен).
                </p>
              )}
              <Link href="/account" className="text-sm text-primary underline underline-offset-4">
                В личный кабинет
              </Link>
            </div>
          )
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            {isPrivilege ? (
              <>
                <div className="mb-1 flex items-baseline justify-between border-b border-border pb-3">
                  <span className="text-sm text-muted-foreground">Стоимость</span>
                  <span className="font-mono text-xl font-bold">{costDc} DC</span>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Ваш баланс</span>
                  <span className={cn("font-mono", notEnough ? "text-destructive" : "text-foreground")}>
                    {balance} DC
                  </span>
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}

                {notEnough ? (
                  <div className="rounded-md border border-border bg-background p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Не хватает {costDc - balance} DC. Пополните баланс донат-коинами.
                    </p>
                    <a
                      href="#dc"
                      onClick={onClose}
                      className="mt-3 inline-block rounded-md bg-primary px-4 py-2 font-mono text-sm font-semibold text-primary-foreground"
                    >
                      Пополнить DC
                    </a>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => buy("dc")}
                    className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {busy === "dc" ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Coins className="size-4" />
                    )}
                    Купить за {costDc} DC
                  </button>
                )}
              </>
            ) : (
              <>
                <div className="mb-1 flex items-baseline justify-between border-b border-border pb-3">
                  <span className="text-sm text-muted-foreground">К оплате</span>
                  <span className="font-mono text-xl font-bold">{priceRub} ₽</span>
                </div>
                {err && <p className="text-sm text-destructive">{err}</p>}

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => buy("mydonate")}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm transition-colors hover:border-primary disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <ExternalLink className="size-4 text-primary" />
                    MyDonate (СБП, карта — выдача в игре)
                  </span>
                  {busy === "mydonate" && <LoaderCircle className="size-4 animate-spin" />}
                </button>

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => buy("easydonate")}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm transition-colors hover:border-primary disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <CreditCard className="size-4 text-primary" />
                    EasyDonate (карта, кошельки)
                  </span>
                  {busy === "easydonate" && <LoaderCircle className="size-4 animate-spin" />}
                </button>

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => buy("millida")}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm transition-colors hover:border-primary disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Wallet className="size-4 text-primary" />
                    Millida (СБП, карта)
                  </span>
                  {busy === "millida" && <LoaderCircle className="size-4 animate-spin" />}
                </button>

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => buy("donatello")}
                  className="flex items-center justify-between rounded-md border border-border bg-background px-4 py-3 text-sm transition-colors hover:border-primary disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Coins className="size-4 text-primary" />
                    Donatello (гривна)
                  </span>
                  {busy === "donatello" && <LoaderCircle className="size-4 animate-spin" />}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
