import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRight, MessageSquare, Pin, Lock, Clock } from "lucide-react"

import { getDb } from "@/lib/db"

interface ThreadRow {
  id: number
  title: string
  author_nick: string
  status: string
  is_pinned: number
  reply_count: number
  last_reply_at: string
  last_reply_nick: string | null
  created_at: string
}

interface CategoryInfo {
  id: number
  slug: string
  name: string
  description: string
  icon: string
}

interface ThreadsData {
  category: CategoryInfo
  threads: ThreadRow[]
  total: number
  page: number
  limit: number
}

async function getThreads(slug: string, page: number): Promise<ThreadsData | null> {
  try {
    const limit = 20
    const offset = (page - 1) * limit
    const db = getDb()

    const [catRows] = await db.query(
      "SELECT id, slug, name, description, icon FROM forum_categories WHERE slug = ? AND is_active = 1 LIMIT 1",
      [slug]
    )
    const catList = catRows as CategoryInfo[]
    if (!catList[0]) return null
    const category = catList[0]

    const [countRows] = await db.query(
      "SELECT COUNT(*) AS total FROM forum_threads WHERE category_id = ? AND status != 'deleted'",
      [category.id]
    )
    const total = (countRows as Array<{ total: number }>)[0]?.total ?? 0

    const [threads] = await db.query(
      `SELECT t.id, t.category_id, t.author_nick, t.title, t.status, t.is_pinned,
              t.reply_count, t.last_reply_at, t.last_reply_nick, t.created_at
       FROM forum_threads t
       WHERE t.category_id = ? AND t.status != 'deleted'
       ORDER BY t.is_pinned DESC, t.last_reply_at DESC
       LIMIT ? OFFSET ?`,
      [category.id, limit, offset]
    )

    return {
      category,
      threads: threads as ThreadRow[],
      total,
      page,
      limit,
    }
  } catch (err) {
    console.error("Category page error:", err)
    return null
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "только что"
  if (mins < 60) return `${mins} мин. назад`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} ч. назад`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} дн. назад`
  return new Date(dateStr).toLocaleDateString("ru-RU")
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const data = await getThreads(category, 1)
  if (!data) return { title: "Форум — Polit Empire" }
  return {
    title: `${data.category.name} — Форум — Polit Empire`,
    description: data.category.description,
  }
}

export default async function ForumCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { category } = await params
  const { page: pageStr } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? "1", 10))

  const data = await getThreads(category, page)
  if (!data) notFound()

  const totalPages = Math.ceil(data.total / data.limit)

  return (
    <main className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <img src="/images/emblem.png" alt="Polit Empire" width={36} height={36} className="rounded" />
            <span className="font-mono text-lg font-bold tracking-tight">Polit Empire</span>
          </Link>
          <nav className="flex items-center gap-1 md:gap-2">
            <Link href="/donate" className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">Донат</Link>
            <Link href="/rules" className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">Правила</Link>
            <Link href="/forum" className="px-3 py-1.5 text-sm text-primary font-medium transition-colors hover:text-foreground">Форум</Link>
            <Link href="/account" className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/20">Кабинет</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-10">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">Главная</Link>
          <ChevronRight className="size-4" />
          <Link href="/forum" className="hover:text-foreground transition-colors">Форум</Link>
          <ChevronRight className="size-4" />
          <span className="text-foreground">{data.category.name}</span>
        </div>

        {/* Category header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-mono text-3xl font-bold">{data.category.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{data.category.description}</p>
          </div>
          <Link
            href={`/forum/new?category=${category}`}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <MessageSquare className="size-4" />
            Создать тему
          </Link>
        </div>

        {/* Threads list */}
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto] gap-4 bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground">
            <span>Тема</span>
            <span className="text-right">Ответы</span>
          </div>

          {data.threads.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              В этой категории пока нет тем.{" "}
              <Link href={`/forum/new?category=${category}`} className="text-primary hover:underline">
                Будьте первым!
              </Link>
            </div>
          ) : (
            data.threads.map((thread) => (
              <Link
                key={thread.id}
                href={`/forum/${category}/${thread.id}`}
                className="group grid grid-cols-[1fr_auto] gap-4 px-5 py-4 transition-colors hover:bg-primary/5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {thread.is_pinned === 1 && (
                      <span className="flex items-center gap-1 text-xs font-medium text-amber-400 shrink-0">
                        <Pin className="size-3" /> Закреплено
                      </span>
                    )}
                    {thread.status === "closed" && (
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground shrink-0">
                        <Lock className="size-3" /> Закрыто
                      </span>
                    )}
                    <h2 className="font-medium text-foreground group-hover:text-primary transition-colors line-clamp-1">
                      {thread.title}
                    </h2>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="text-primary/80 font-mono">{thread.author_nick}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {timeAgo(thread.created_at)}
                    </span>
                    {thread.last_reply_nick && thread.reply_count > 0 && (
                      <span className="hidden sm:inline">
                        Последний ответ:{" "}
                        <span className="text-primary/80 font-mono">{thread.last_reply_nick}</span>{" "}
                        {timeAgo(thread.last_reply_at)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-foreground">{thread.reply_count}</div>
                    <div className="text-xs text-muted-foreground">ответов</div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={`/forum/${category}?page=${page - 1}`}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
              >
                ← Назад
              </Link>
            )}
            <span className="px-3 text-sm text-muted-foreground">
              Страница {page} из {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/forum/${category}?page=${page + 1}`}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
              >
                Вперёд →
              </Link>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
