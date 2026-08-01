"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"

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

export default function ForumCategories() {
  const [categories, setCategories] = useState<ForumCategory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/forum/categories")
      .then((r) => r.json())
      .then((data) => setCategories(data.categories ?? []))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-4">
              <div className="size-12 rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
        Форум временно недоступен
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {categories.map((cat) => (
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
      ))}
    </div>
  )
}
