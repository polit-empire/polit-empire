"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import useSWR from "swr"
import { Coins, LayoutDashboard, LogOut, Shield, ShoppingCart } from "lucide-react"
import { jsonFetcher, postJson } from "@/lib/fetcher"
import { cn } from "@/lib/utils"

export interface MeResponse {
  nick: string
  isAdmin: boolean
  isBanned: boolean
  banReason: string | null
  balance: number
  privilege: { group: string; name: string | null; expiresAt: string | null } | null
}

const NAV = [
  { href: "/", label: "Главная" },
  { href: "/donate", label: "Донат" },
  { href: "/account", label: "Кабинет" },
]

export function SiteHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: me, mutate } = useSWR<MeResponse>("/api/account/me", jsonFetcher, {
    shouldRetryOnError: false,
  })

  async function logout() {
    await postJson("/api/account/logout")
    await mutate(undefined, { revalidate: false })
    router.push("/")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex w-full flex-nowrap items-center justify-between gap-3 px-6 py-3 lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <Image src="/images/emblem.png" alt="Герб Polit Empire" width={32} height={32} className="rounded" />
          <span className="hidden font-mono text-base font-bold tracking-tight sm:inline">Polit Empire</span>
        </Link>

        <div className="flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap">
          <nav className="flex flex-nowrap items-center gap-1 whitespace-nowrap">
            {NAV.map((item) => {
              const active = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
            {me?.isAdmin && (
              <Link
                href="/admin"
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  pathname.startsWith("/admin") ? "text-primary" : "text-muted-foreground hover:text-primary",
                )}
              >
                <Shield className="size-4" />
                <span className="hidden sm:inline">Админ</span>
              </Link>
            )}
          </nav>
          {me ? (
            <>
              <span className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-xs md:flex">
                <Coins className="size-3.5 text-primary" />
                {me.balance} DC
              </span>
              <span className="hidden font-mono text-sm text-foreground sm:inline">{me.nick}</span>
              <button
                type="button"
                onClick={logout}
                aria-label="Выйти"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <Link
              href="/account"
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              <LayoutDashboard className="size-4" />
              Войти
            </Link>
          )}
          <Link
            href="/donate"
            aria-label="Донат"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <ShoppingCart className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  )
}
