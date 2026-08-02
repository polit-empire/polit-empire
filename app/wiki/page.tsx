import type { Metadata } from "next"
import Link from "next/link"
import { getDb } from "@/lib/db"
import { SiteHeader } from "@/components/site-header"

export const metadata: Metadata = {
  title: "Вики — Polit Empire",
  description: "Гайды и статьи по серверу Polit Empire",
}

export const dynamic = "force-dynamic"

type Article = { id: number; slug: string; title: string; category: string }

export default async function WikiPage() {
  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, slug, title, category FROM wiki_articles WHERE is_published=1 ORDER BY category, title",
  )
  const articles = rows as Article[]

  const byCategory = articles.reduce<Record<string, Article[]>>((acc, a) => {
    ;(acc[a.category] ??= []).push(a)
    return acc
  }, {})

  return (
    <>
      <SiteHeader />
      <main className="min-h-screen">
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center">
          <h1 className="font-mono text-3xl font-bold md:text-4xl">📖 Вики Polit Empire</h1>
          <p className="mx-auto mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Гайды, инструкции и полезная информация по серверу.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 py-12">
        {Object.keys(byCategory).length === 0 ? (
          <p className="text-center text-muted-foreground">Статьи пока не добавлены.</p>
        ) : (
          Object.entries(byCategory).map(([category, items]) => (
            <section key={category} className="mb-12 last:mb-0">
              <h2 className="mb-4 font-mono text-xl font-bold">{category}</h2>
              <div className="flex flex-col gap-3">
                {items.map((a) => (
                  <Link
                    key={a.id}
                    href={`/wiki/${a.slug}`}
                    className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
                  >
                    <span className="font-medium text-foreground">{a.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  </>
  )
}
