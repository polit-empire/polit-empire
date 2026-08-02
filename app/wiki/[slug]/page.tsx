import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { getDb } from "@/lib/db"
import { SiteHeader } from "@/components/site-header"

export const dynamic = "force-dynamic"

type Article = {
  id: number
  slug: string
  title: string
  category: string
  content: string
  created_at: string
  updated_at: string
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const db = getDb()
  const [rows] = await db.query(
    "SELECT title FROM wiki_articles WHERE slug=? AND is_published=1 LIMIT 1",
    [slug],
  )
  const article = (rows as Array<{ title: string }>)[0]
  if (!article) return { title: "Не найдено — Polit Empire" }
  return { title: `${article.title} — Вики Polit Empire` }
}

export default async function WikiArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const db = getDb()
  const [rows] = await db.query(
    "SELECT id, slug, title, category, content, created_at, updated_at FROM wiki_articles WHERE slug=? AND is_published=1 LIMIT 1",
    [slug],
  )
  const article = (rows as Article[])[0]
  if (!article) notFound()

  return (
    <main className="min-h-screen">
      <SiteHeader />
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <Link href="/wiki" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            ← Вики
          </Link>
          <p className="mt-2 text-sm text-primary font-mono">{article.category}</p>
          <h1 className="mt-1 font-mono text-3xl font-bold md:text-4xl">{article.title}</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Обновлено: {new Date(article.updated_at).toLocaleDateString("ru-RU")}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-4 py-10">
        <div className="rounded-lg border border-border bg-card p-6 leading-relaxed text-foreground whitespace-pre-wrap">
          {article.content}
        </div>
      </div>
    </main>
  )
}
