"use client"

import { useState } from "react"
import useSWR from "swr"
import { Pencil, Plus, Trash2, LoaderCircle } from "lucide-react"
import { jsonFetcher, postJson, sendJson } from "@/lib/fetcher"
import { Card, Field, TextInput, TextArea, Select } from "@/components/admin/ui"

type Article = {
  id: number
  slug: string
  title: string
  category: string
  content?: string
  is_published: number
  created_at: string
}

type Draft = Partial<Article>

const EMPTY: Draft = { slug: "", title: "", category: "Общее", content: "", is_published: 1 }

export function WikiPanel() {
  const { data, mutate, isLoading } = useSWR<{ articles: Article[] }>("/api/admin/wiki", jsonFetcher)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function edit(a: Article) { setDraft({ ...a }); setError(null) }
  function create() { setDraft({ ...EMPTY }); setError(null) }

  async function save() {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      if (draft.id) {
        await sendJson(`/api/admin/wiki/${draft.id}`, "PATCH", draft)
      } else {
        await postJson("/api/admin/wiki", draft)
      }
      await mutate(); setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm("Удалить статью?")) return
    await sendJson(`/api/admin/wiki/${id}`, "DELETE")
    await mutate()
  }

  const articles = data?.articles ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-lg font-semibold">Статьи вики</h2>
        <button
          type="button"
          onClick={create}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" /> Добавить
        </button>
      </div>

      {draft && (
        <Card className="space-y-3">
          <p className="font-mono text-sm font-semibold">{draft.id ? "Редактировать" : "Новая статья"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Заголовок">
              <TextInput value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field label="Slug (URL)" hint="Только латиница, цифры, дефис">
              <TextInput value={draft.slug ?? ""} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
            </Field>
            <Field label="Категория">
              <TextInput value={draft.category ?? ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </Field>
            <Field label="Опубликовано">
              <Select value={String(draft.is_published ?? 1)} onChange={(e) => setDraft({ ...draft, is_published: Number(e.target.value) })}>
                <option value="1">Да</option>
                <option value="0">Нет</option>
              </Select>
            </Field>
          </div>
          <Field label="Содержимое">
            <TextArea
              className="min-h-48"
              value={draft.content ?? ""}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy && <LoaderCircle className="size-4 animate-spin" />}
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><LoaderCircle className="size-6 animate-spin text-muted-foreground" /></div>
      ) : articles.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Статей пока нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left font-mono font-semibold">Заголовок</th>
                <th className="px-4 py-2.5 text-left font-mono font-semibold">Категория</th>
                <th className="px-4 py-2.5 text-left font-mono font-semibold">Slug</th>
                <th className="px-4 py-2.5 text-left font-mono font-semibold">Статус</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 font-medium">{a.title}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{a.category}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{a.slug}</td>
                  <td className="px-4 py-2.5">
                    <span className={a.is_published ? "text-emerald-500" : "text-muted-foreground"}>
                      {a.is_published ? "опубликовано" : "скрыто"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => edit(a)} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="size-4" />
                      </button>
                      <button type="button" onClick={() => remove(a.id)} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
