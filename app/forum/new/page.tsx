"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronRight, AlertCircle } from "lucide-react"

interface Category {
  id: number
  slug: string
  name: string
  description: string
  icon: string
  admin_only: number
}

export default function NewThreadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultCategory = searchParams.get("category") ?? ""

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState(defaultCategory)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  useEffect(() => {
    fetch("/api/forum/categories")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
  }, [])

  function renderMarkdown(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code class=\"rounded bg-muted px-1 py-0.5 font-mono text-sm\">$1</code>")
      .replace(/^### (.+)$/gm, "<h3 class=\"text-base font-bold mt-3 mb-1\">$1</h3>")
      .replace(/^## (.+)$/gm, "<h2 class=\"text-lg font-bold mt-4 mb-2\">$1</h2>")
      .replace(/^# (.+)$/gm, "<h1 class=\"text-xl font-bold mt-4 mb-2\">$1</h1>")
      .replace(/^[-*] (.+)$/gm, "<li class=\"ml-4 list-disc\">$1</li>")
      .replace(/\n/g, "<br>")
  }

  async function submit() {
    if (!selectedCategory || !title.trim() || !body.trim()) {
      setErr("Заполните все поля")
      return
    }
    setBusy(true)
    setErr(null)
    const res = await fetch("/api/forum/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categorySlug: selectedCategory,
        title: title.trim(),
        body: body.trim(),
      }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) {
      setErr(json.error || "Ошибка при создании темы")
    } else {
      router.push(`/forum/${selectedCategory}/${json.threadId}`)
    }
  }

  const selectedCat = categories.find((c) => c.slug === selectedCategory)

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

      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">Главная</Link>
          <ChevronRight className="size-4" />
          <Link href="/forum" className="hover:text-foreground transition-colors">Форум</Link>
          <ChevronRight className="size-4" />
          <span className="text-foreground">Новая тема</span>
        </div>

        <h1 className="mb-8 font-mono text-3xl font-bold">Создать тему</h1>

        <div className="flex flex-col gap-5">
          {/* Category */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Категория
            </label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            >
              <option value="">Выберите категорию...</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.slug}>
                  {cat.name}
                </option>
              ))}
            </select>
            {selectedCat && (
              <p className="mt-1 text-xs text-muted-foreground">{selectedCat.description}</p>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              Заголовок темы
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              placeholder="Кратко опишите суть темы..."
              className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground"
            />
            <div className="mt-1 text-right text-xs text-muted-foreground">{title.length}/255</div>
          </div>

          {/* Body */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">
                Текст сообщения
              </label>
              <button
                onClick={() => setPreview((p) => !p)}
                className="text-xs text-primary hover:underline"
                type="button"
              >
                {preview ? "← Редактор" : "Предпросмотр →"}
              </button>
            </div>

            {preview ? (
              <div
                className="min-h-40 rounded-md border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground"
                dangerouslySetInnerHTML={{ __html: body ? renderMarkdown(body) : "<span class=\"text-muted-foreground italic\">Текст пуст</span>" }}
              />
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                placeholder="Опишите вашу тему подробно..."
                className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground resize-y"
              />
            )}

            <div className="mt-1.5 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Поддерживается Markdown: **жирный**, *курсив*, `код`, ## заголовок, - список
            </div>
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={busy || !selectedCategory || !title.trim() || !body.trim()}
              className="flex-1 rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Публикуем..." : "Опубликовать тему"}
            </button>
            <Link
              href="/forum"
              className="rounded-md border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground hover:border-primary/50"
            >
              Отмена
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
