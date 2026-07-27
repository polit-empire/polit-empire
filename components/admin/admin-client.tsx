"use client"

import { useState } from "react"
import { Activity, Coins, LifeBuoy, LogIn, Megaphone, Package, ScrollText, Settings, Tag, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { PlayersPanel } from "@/components/admin/players-panel"
import { ProductsPanel } from "@/components/admin/products-panel"
import { OrdersPanel } from "@/components/admin/orders-panel"
import { BroadcastPanel } from "@/components/admin/broadcast-panel"
import { SettingsPanel } from "@/components/admin/settings-panel"
import { TelemetryPanel } from "@/components/admin/telemetry-panel"
import { AdminLogsPanel } from "@/components/admin/admin-logs-panel"
import { AccountEventsPanel } from "@/components/admin/account-events-panel"
import { TicketsPanel } from "@/components/admin/tickets-panel"
import { PromoPanel } from "@/components/admin/promo-panel"

type Tab =
  | "players"
  | "products"
  | "orders"
  | "promo"
  | "broadcast"
  | "tickets"
  | "telemetry"
  | "adminlogs"
  | "accounts"
  | "settings"

const TABS: Array<{ id: Tab; label: string; icon: typeof Users }> = [
  { id: "players", label: "Игроки", icon: Users },
  { id: "products", label: "Донат", icon: Package },
  { id: "orders", label: "Заказы", icon: Coins },
  { id: "promo", label: "Промокоды", icon: Tag },
  { id: "tickets", label: "Поддержка", icon: LifeBuoy },
  { id: "broadcast", label: "Рассылка", icon: Megaphone },
  { id: "telemetry", label: "Телеметрия", icon: Activity },
  { id: "adminlogs", label: "Логи админов", icon: ScrollText },
  { id: "accounts", label: "Логи входов", icon: LogIn },
  { id: "settings", label: "Настройки", icon: Settings },
]

export function AdminClient({ adminNick }: { adminNick: string }) {
  const [tab, setTab] = useState<Tab>("players")

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Админ-панель</h1>
        <p className="text-sm text-muted-foreground">
          Управление сервером Polit Empire — вошли как <span className="font-mono text-foreground">{adminNick}</span>
        </p>
      </div>

      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === "players" && <PlayersPanel />}
      {tab === "products" && <ProductsPanel />}
      {tab === "orders" && <OrdersPanel />}
      {tab === "promo" && <PromoPanel />}
      {tab === "tickets" && <TicketsPanel />}
      {tab === "broadcast" && <BroadcastPanel />}
      {tab === "telemetry" && <TelemetryPanel />}
      {tab === "adminlogs" && <AdminLogsPanel />}
      {tab === "accounts" && <AccountEventsPanel />}
      {tab === "settings" && <SettingsPanel />}
    </div>
  )
}
