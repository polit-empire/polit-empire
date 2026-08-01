import type { Metadata } from "next"
import Link from "next/link"
import { MessageSquare, ChevronRight } from "lucide-react"

export const metadata: Metadata = {
  title: "Форум — Polit Empire",
  description:
    "Форум военно-политического Minecraft-сервера Polit Empire. Общение, вопросы, жалобы, предложения и объявления.",
}

import { getDb } from "@/lib/db"

interface ForumCategory {
  id: number
  slug: string
  name: string
  description: string
  icon: string
  sort_order: number
  admin_only: number
  thread_count: number
}

async function getCategories(): Promise<ForumCategory[]> {
  try {
    const db = getDb()
    const [rows] = await db.query(
      "SELECT id, slug, name, description, icon, sort_order, admin_only, (SELECT COUNT(*) FROM forum_threads WHERE category_id = forum_categories.id AND status != 'deleted') AS thread_count FROM forum_categories WHERE is_active = 1 ORDER BY sort_order"
    )
    return (rows as ForumCategory[]) ?? []
  } catch (err) {
    console.error("Forum page error:", err)
    return []
  }
}

export default async function ForumPage() {
  const categories = await getCategories()

  return (
    <main className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3">
              <img
                src="/images/emblem.png"
                alt="Герб Polit Empire"
                width={36}
                height={36}
                className="rounded"
              />
              <span className="font-mono text-lg font-bold tracking-tight">
                Polit Empire
              </span>
            </Link>
          </div>
          <nav className="flex items-center gap-1 md:gap-2">
            <Link
              href="/donate"
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Донат
            </Link>
            <Link
              href="/rules"
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Правила
            </Link>
            <Link
              href="/forum"
              className="px-3 py-1.5 text-sm text-primary transition-colors hover:text-foreground font-medium"
            >
              Форум
            </Link>
            <Link
              href="/account"
              className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
            >
              Кабинет
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-10">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">Главная</Link>
          <ChevronRight className="size-4" />
          <span className="text-foreground">Форум</span>
        </div>

        {/* Title */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-3xl font-bold">Форум</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Общение, вопросы, жалобы и предложения для игроков Polit Empire
            </p>
          </div>
          <Link
            href="/forum/new"
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <MessageSquare className="size-4" />
            Создать тему
          </Link>
        </div>

        {/* Categories */}
        <div className="flex flex-col gap-3">
          {categories.length === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
              Форум временно недоступен
            </div>
          ) : (
            categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/forum/${cat.slug}`}
                className="group flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-all hover:border-primary/40 hover:bg-card/80"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-2xl">
                  {cat.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-mono font-semibold text-foreground group-hover:text-primary transition-colors">
                    {cat.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">
                    {cat.description}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-semibold text-foreground">
                    {cat.thread_count}
                  </span>
                  <span className="text-xs text-muted-foreground">тем</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
              </Link>
            ))
          )}
        </div>
      </div>
    </main>
  )
}
