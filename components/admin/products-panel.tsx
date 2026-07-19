"use client"

import { useState } from "react"
import useSWR from "swr"
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react"
import { jsonFetcher, postJson, sendJson } from "@/lib/fetcher"
import type { DonateProduct } from "@/lib/donate"
import { Card, Field, Select, TextArea, TextInput } from "@/components/admin/ui"

type Draft = Partial<DonateProduct>

const ACCENTS = ["sky", "emerald", "amber", "rose", "violet", "slate"]

const EMPTY: Draft = {
  kind: "privilege",
  name: "",
  description: "",
  price_rub: 0,
  group_name: "",
  duration_days: 30,
  dc_amount: 0,
  rcon_command: "lp user {nick} parent addtemp {group} {days}d",
  accent: "emerald",
  sort_order: 0,
  is_active: 1,
}

export function ProductsPanel() {
  const { data, mutate, isLoading } = useSWR<{ products: DonateProduct[] }>("/api/admin/products", jsonFetcher)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function edit(p: DonateProduct) {
    setDraft({ ...p })
    setError(null)
  }
  function create() {
    setDraft({ ...EMPTY })
    setError(null)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      if (draft.id) {
        await sendJson(`/api/admin/products/${draft.id}`, "PATCH", draft)
      } else {
        await postJson("/api/admin/products", draft)
      }
      await mutate()
      setDraft(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка")
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    if (!confirm("Удалить товар?")) return
    await sendJson(`/api/admin/products/${id}`, "DELETE")
    await mutate()
    if (draft?.id === id) setDraft(null)
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Товары ({data?.products.length ?? 0})</h3>
          <button
            type="button"
            onClick={create}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" /> Добавить
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Загрузка...
          </div>
        )}
        <div className="flex flex-col gap-2">
          {data?.products.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{p.name}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {p.kind === "dc" ? "DC" : p.kind === "item" ? "предмет" : "прив"}
                  </span>
                  {p.is_active === 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">скрыт</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {p.kind === "privilege"
                    ? `${p.price_rub} DC · ${p.group_name} · ${p.duration_days}д`
                    : p.kind === "item"
                      ? `${p.price_rub} DC · ${p.icon_item || "предмет"}`
                      : `${p.price_rub}₽ · ${p.dc_amount} DC`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => edit(p)}
                  aria-label="Изменить"
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  aria-label="Удалить"
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Редактор */}
      <div>
        {!draft ? (
          <Card className="text-sm text-muted-foreground">
            Выберите товар для редактирования или добавьте новый. Все параметры, включая RCON-команду выдачи,
            полностью настраиваются.
          </Card>
        ) : (
          <Card className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">{draft.id ? "Редактирование" : "Новый товар"}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Тип">
                <Select
                  value={draft.kind}
                  onChange={(e) => set("kind", e.target.value as "privilege" | "dc" | "item")}
                >
                  <option value="privilege">Привилегия</option>
                  <option value="dc">Пакет DC</option>
                  <option value="item">Предмет (за DC)</option>
                </Select>
              </Field>
              <Field label="Название">
                <TextInput value={draft.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              </Field>
            </div>
            <Field label="Описание">
              <TextArea value={draft.description ?? ""} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={draft.kind === "dc" ? "Цена, ₽" : "Цена, DC"}
                hint={
                  draft.kind === "dc"
                    ? "Пакет DC продаётся за рубли (1 ₽ = 1 DC)"
                    : "Покупается за баланс DC (в игре и на сайте)"
                }
              >
                <TextInput
                  type="number"
                  value={draft.price_rub ?? 0}
                  onChange={(e) => set("price_rub", Number(e.target.value))}
                />
              </Field>
              <Field label="Акцент (цвет)">
                <Select value={draft.accent} onChange={(e) => set("accent", e.target.value)}>
                  {ACCENTS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {draft.kind === "privilege" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Группа (LuckPerms)">
                  <TextInput value={draft.group_name ?? ""} onChange={(e) => set("group_name", e.target.value)} />
                </Field>
                <Field label="Срок, дней">
                  <TextInput
                    type="number"
                    value={draft.duration_days ?? 30}
                    onChange={(e) => set("duration_days", Number(e.target.value))}
                  />
                </Field>
              </div>
            )}
            {draft.kind === "dc" && (
              <Field label="Количество DC">
                <TextInput
                  type="number"
                  value={draft.dc_amount ?? 0}
                  onChange={(e) => set("dc_amount", Number(e.target.value))}
                />
              </Field>
            )}

            <Field
              label="Иконка предмета в моде"
              hint="ID предмета Minecraft для GUI мода. Пример: minecraft:diamond, minecraft:golden_apple. Необязательно."
            >
              <TextInput
                value={draft.icon_item ?? ""}
                onChange={(e) => set("icon_item", e.target.value)}
                placeholder="minecraft:chest"
              />
            </Field>

            <Field
              label="RCON-команда выдачи"
              hint={
                draft.kind === "item"
                  ? "Команда выдачи предмета. Плейсхолдеры {nick} {item} {count}. Пример: give {nick} minecraft:diamond 64"
                  : "Плейсхолдеры: {nick} {group} {days} {amount}. Пример: lp user {nick} parent addtemp {group} {days}d"
              }
            >
              <TextInput value={draft.rcon_command ?? ""} onChange={(e) => set("rcon_command", e.target.value)} />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Порядок сортировки">
                <TextInput
                  type="number"
                  value={draft.sort_order ?? 0}
                  onChange={(e) => set("sort_order", Number(e.target.value))}
                />
              </Field>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={draft.is_active === 1}
                  onChange={(e) => set("is_active", e.target.checked ? 1 : 0)}
                  className="size-4 accent-primary"
                />
                <span className="text-sm text-foreground">Активен (виден в магазине)</span>
              </label>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground"
              >
                Отмена
              </button>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
