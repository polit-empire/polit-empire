import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"
import { AccountClient } from "@/components/account/account-client"

export const metadata: Metadata = {
  title: "Личный кабинет — Polit Empire",
  description: "Управляй аккаунтом Polit Empire: привилегия, статус, баланс донат-коинов и история покупок.",
}

export default function AccountPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <AccountClient />
    </main>
  )
}
