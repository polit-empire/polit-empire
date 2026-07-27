"use client"

import { useState } from "react"
import useSWR from "swr"
import { Copy, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react"
import { jsonFetcher, postJson, sendJson } from "@/lib/fetcher"
import type { PromoCode } from "@/lib/promo"
import { Card, Field, Select, TextInput } from "@/components/admin/ui"

type Draft = Partial<PromoCode> & { code_length?: number; batch?: number }

const EMPTY: Draft = {
  code: "",
  discount_type: "percent",
  discount_value: 10,
  max_uses: 0,
  min_amount_rub: 0,
  product_ids: null,
  expires_at: null,
  is_active: 1,
  code_length: 8,
}

export function PromoPanel() {
  const { data, mutate, isLoading } = useSWR<{ promos: PromoCode[] }>("/api/admin/promo", jsonFetcher)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [batchResult, setBatchResult] = useState<string[] | null>(null)

  function edit(p: PromoCode) {
    setDraft({ ...p })
    setError(null)
    setBatchMode(false)
    setBatchResult(null)
  }
  function create() {
    setDraft({ ...EMPTY })
    setError(null)
    setBatchMode(false)
    setBatchResult(null)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      if (batchMode && !draft.id) {
        // Пакетная генерация
        if (!draft.discount_type || !draft.discount_value) {
          setError("Тип и значение скидки обязательны")
          return
        }
        const res = await postJson<{ ok?: boolean; codes?: string[]; error?: string }>("/api/admin/promo", {
          batch: draft.batch || 10,
          discount_type: draft.discount_type,
          discount_value: draft.discount_value,
          max_uses: draft.max_uses || 0,
          min_amount_rub: draft.min_amount_rub || 0,
          product_ids: draft.product_ids || null,
          expires_at: draft.expires_at || null,
          code_length: draft.code_length || 8,
        })
        if (res.ok === false || res.error) {
          setError(res.error || "Ошибка")
          return
        }
        setBatchResult(res.codes || [])
        await mutate()
        setDraft(null)
        return
      }

      if (draft.id) {
        await sendJson(`/api/admin/promo/${draft.id}`, "PATCH", {
          code: draft.code,
          discount_type: draft.discount_type,
          discount_value: draft.discount_value,
          max_uses: draft.max_uses,
          min_amount_rub: draft.min_amount_rub,
          product_ids: draft.product_ids,
          expires_at: draft.expires_at,
          is_active: draft.is_active,
        })
      } else {
        if (!draft.discount_type || draft.discount_value === undefined) {
          setError("Тип и значение скидки обязательны")
          return
        }
        await postJson("/api/admin/promo", {
          code: draft.code || undefined,
          discount_type: draft.discount_type,
          discount_value: draft.discount_value,
          max_uses: draft.max_uses || 0,
          min_amount_rub: draft.min_amount_rub || 0,
          product_ids: draft.product_ids || null,
          expires_at: draft.expires_at || null,
          code_length: draft.code_length || 8,
        })
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
    if (!confirm("Удалить промокод?")) return
    await sendJson(`/api/admin/promo/${id}`, "DELETE")
    await mutate()
    if (draft?.id === id) setDraft(null)
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Промокоды ({data?.promos.length ?? 0})</h3>
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
          {data?.promos.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-foreground">{p.code}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {p.discount_type === "percent" ? `${p.discount_value}%` : `${p.discount_value} ₽`}
                  </span>
                  {p.is_active === 0 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">выкл</span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {p.used_count}/{p.max_uses || "∞"} использований
                  {p.min_amount_rub > 0 && ` · мин. ${p.min_amount_rub}₽`}
                  {p.expires_at && ` · до ${new Date(p.expires_at).toLocaleDateString("ru-RU")}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => copyCode(p.code)}
                  aria-label="Копировать"
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {copied === p.code ? (
                    <span className="text-xs text-primary">OK</span>
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
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
            Выберите промокод для редактирования или добавьте новый. Промокоды дают скидку на покупку товаров в
            магазине.
          </Card>
        ) : (
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{draft.id ? "Редактирование" : "Новый промокод"}</h3>
              {!draft.id && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={batchMode}
                    onChange={(e) => setBatchMode(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  Пакетная генерация
                </label>
              )}
            </div>

            {batchMode && !draft.id ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Количество промокодов">
                    <TextInput
                      type="number"
                      min={2}
                      max={1000}
                      value={draft.batch ?? 10}
                      onChange={(e) => set("batch", Number(e.target.value))}
                    />
                  </Field>
                  <Field label="Длина кода">
                    <TextInput
                      type="number"
                      min={4}
                      max={32}
                      value={draft.code_length ?? 8}
                      onChange={(e) => set("code_length", Number(e.target.value))}
                    />
                  </Field>
                </div>
              </>
            ) : (
              <Field label="Код промокода" hint="Оставьте пустым для автоматической генерации">
                <TextInput
                  value={draft.code ?? ""}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="Авто-генерация"
                />
              </Field>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Тип скидки">
                <Select
                  value={draft.discount_type}
                  onChange={(e) => set("discount_type", e.target.value as "percent" | "fixed")}
                >
                  <option value="percent">Процент (%)</option>
                  <option value="fixed">Фиксированная сумма (₽)</option>
                </Select>
              </Field>
              <Field
                label={draft.discount_type === "percent" ? "Процент скидки" : "Сумма скидки, ₽"}
              >
                <TextInput
                  type="number"
                  min={1}
                  value={draft.discount_value ?? 10}
                  onChange={(e) => set("discount_value", Number(e.target.value))}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Макс. использований (всего)" hint="0 = без ограничений">
                <TextInput
                  type="number"
                  min={0}
                  value={draft.max_uses ?? 0}
                  onChange={(e) => set("max_uses", Number(e.target.value))}
                />
              </Field>
              <Field label="Мин. сумма заказа, ₽" hint="0 = без ограничений">
                <TextInput
                  type="number"
                  min={0}
                  value={draft.min_amount_rub ?? 0}
                  onChange={(e) => set("min_amount_rub", Number(e.target.value))}
                />
              </Field>
            </div>

            <Field label="Привязка к товарам" hint="ID товаров через запятую. Пусто = на все товары.">
              <TextInput
                value={draft.product_ids ?? ""}
                onChange={(e) => set("product_ids", e.target.value || null)}
                placeholder="Все товары"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Дата окончания" hint="Пусто = без ограничений по времени">
                <TextInput
                  type="datetime-local"
                  value={draft.expires_at ? new Date(draft.expires_at).toISOString().slice(0, 16) : ""}
                  onChange={(e) => set("expires_at", e.target.value ? new Date(e.target.value) : null)}
                />
              </Field>
              <label className="flex items-end gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={draft.is_active === 1}
                  onChange={(e) => set("is_active", e.target.checked ? 1 : 0)}
                  className="size-4 accent-primary"
                />
                <span className="text-sm text-foreground">Активен</span>
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
                {batchMode && !draft.id ? "Сгенерировать" : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={() => { setDraft(null); setBatchMode(false); setBatchResult(null); }}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-foreground"
              >
                Отмена
              </button>
            </div>
          </Card>
        )}

        {/* Результат пакетной генерации */}
        {batchResult && batchResult.length > 0 && (
          <Card className="mt-4 flex flex-col gap-3">
            <h3 className="text-sm font-semibold">Сгенерировано {batchResult.length} промокодов</h3>
            <div className="max-h-60 overflow-y-auto rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap gap-2">
                {batchResult.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => copyCode(code)}
                    className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 font-mono text-xs transition-colors hover:border-primary"
                  >
                    {code}
                    {copied === code ? (
                      <span className="text-primary">✓</span>
                    ) : (
                      <Copy className="size-3 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Нажмите на код чтобы скопировать. Скопируйте все коды перед закрытием.
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
