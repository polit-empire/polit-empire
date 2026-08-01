import type { Metadata } from "next"
import Link from "next/link"
import { MessageSquare, ChevronRight } from "lucide-react"
import ForumCategories from "./ForumCategories"

export const metadata: Metadata = {
  title: "Форум — Polit Empire",
  description:
    "Форум военно-политического Minecraft-сервера Polit Empire. Общение, вопросы, жалобы, предложения и объявления.",
}

export default async function ForumPage() {
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

        {/* Categories — client-side fetch */}
        <ForumCategories />
      </div>
    </main>
  )
}
