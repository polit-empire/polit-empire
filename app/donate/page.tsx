import type { Metadata } from "next"
import { SiteHeader } from "@/components/site-header"
import { DonateClient } from "@/components/donate/donate-client"

export const metadata: Metadata = {
  title: "Донат — Polit Empire",
  description:
    "Поддержи сервер Polit Empire: привилегии Солдат, Сержант, Командир и Генерал, донат-коины с бонусами. Оплата криптой и EasyDonate.",
}

export default function DonatePage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <DonateClient />
    </main>
  )
}
