"use client"

import Link from "next/link"
import useSWR from "swr"
import { Shield, User } from "lucide-react"
import type { MeResponse } from "@/components/site-header"
import { jsonFetcher } from "@/lib/fetcher"

/**
 * Кнопка входа/аккаунта для шапки главной страницы.
 * - гость: кнопка «Войти» → /account
 * - вошёл: ник → /account (+ «Админ», если админ)
 */
export function AccountNavButton() {
  const { data: me } = useSWR<MeResponse>("/api/account/me", jsonFetcher, {
    shouldRetryOnError: false,
  })

  if (me) {
    return (
      <div className="flex items-center gap-1">
        {me.isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
          >
            <Shield className="size-4" />
            <span className="hidden sm:inline">Админ</span>
          </Link>
        )}
        <Link
          href="/account"
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-mono text-sm text-foreground transition-colors hover:border-primary"
        >
          <User className="size-4" />
          {me.nick}
        </Link>
      </div>
    )
  }

  return (
    <Link
      href="/account"
      className="ml-1 rounded-md border border-border px-3 py-1.5 font-mono text-sm text-foreground transition-colors hover:border-primary"
    >
      Войти
    </Link>
  )
}
