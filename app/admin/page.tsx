import { redirect } from "next/navigation"
import { getAdminUser } from "@/lib/admin"
import { SiteHeader } from "@/components/site-header"
import { AdminClient } from "@/components/admin/admin-client"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata = {
  title: "Админ-панель — Polit Empire",
  robots: { index: false, follow: false },
}

export default async function AdminPage() {
  // Серверная защита: не-админов вообще не пускаем на страницу.
  const admin = await getAdminUser()
  if (!admin) redirect("/account")

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <AdminClient adminNick={admin.minecraft_nick} />
      </main>
    </div>
  )
}
