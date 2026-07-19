"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { LoaderCircle, Plus, Trash2 } from "lucide-react"
import { jsonFetcher, sendJson } from "@/lib/fetcher"
import { Card, Field, TextInput } from "@/components/admin/ui"

/* Мониторинг в настройках vote_sites (JSON). */
interface VoteSite {
  id: string
  name: string
  url: string
  bonus: number
  secret: string
  /** "url" — обычный колбэк, "script" — подписанный webhook (как HotMC). */
  mode: "url" | "script"
}

function parseVoteSites(raw: string | undefined): VoteSite[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((s: Record<string, unknown>) => {
      const id = String(s.id ?? "")
      const rawMode = String(s.mode ?? "")
      const mode: "url" | "script" =
        rawMode === "script" || rawMode === "url" ? rawMode : id.toLowerCase() === "hotmc" ? "script" : "url"
      return {
        id,
        name: String(s.name ?? ""),
        url: String(s.url ?? ""),
        bonus: Number(s.bonus ?? 0) || 0,
        secret: String(s.secret ?? ""),
        mode,
      }
    })
  } catch {
    return []
  }
}

function modeBtn(active: boolean): string {
  return [
    "flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
    active
      ? "border-primary bg-primary/10 text-foreground"
      : "border-border bg-background text-muted-foreground hover:bg-muted",
  ].join(" ")
}

function slugify(name: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
    ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
    ю: "yu", я: "ya",
  }
  return (
    name
      .toLowerCase()
      .split("")
      .map((ch) => map[ch] ?? ch)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || `site-${Date.now().toString(36)}`
  )
}

export function SettingsPanel() {
  const { data, mutate, isLoading } = useSWR<{ settings: Record<string, string> }>(
    "/api/admin/settings",
    jsonFetcher,
  )
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // Базовый URL сайта для подсказки с адресом колбэка Donatello.
  const [siteUrl, setSiteUrl] = useState("https://ваш-сайт")

  useEffect(() => {
    if (typeof window !== "undefined") setSiteUrl(window.location.origin)
  }, [])

  useEffect(() => {
    if (data?.settings) setForm(data.settings)
  }, [data])

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setBusy(true)
    setSaved(false)
    try {
      await sendJson("/api/admin/settings", "PATCH", form)
      await mutate()
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Загрузка...
      </div>
    )
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Бонус при пополнении DC</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Порог, DC" hint="От какой суммы начисляется бонус">
            <TextInput
              type="number"
              value={form.dc_bonus_threshold ?? ""}
              onChange={(e) => set("dc_bonus_threshold", e.target.value)}
            />
          </Field>
          <Field label="Бонус, %" hint="Сколько процентов сверху">
            <TextInput
              type="number"
              value={form.dc_bonus_percent ?? ""}
              onChange={(e) => set("dc_bonus_percent", e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <VoteSitesCard
        sitesJson={form.vote_sites ?? "[]"}
        cooldown={form.vote_cooldown_hours ?? "24"}
        callbackKey={form.vote_callback_key ?? ""}
        siteUrl={form.site_url || siteUrl}
        onSitesChange={(v) => set("vote_sites", v)}
        onCooldownChange={(v) => set("vote_cooldown_hours", v)}
        onKeyChange={(v) => set("vote_callback_key", v)}
      />

      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">RCON-шаблоны</h3>
        <Field label="Выдача привилегии" hint="{nick} {group} {days}">
          <TextInput
            value={form.privilege_rcon_template ?? ""}
            onChange={(e) => set("privilege_rcon_template", e.target.value)}
          />
        </Field>
        <Field label="Снятие привилегии" hint="{nick} {group}">
          <TextInput
            value={form.privilege_take_template ?? ""}
            onChange={(e) => set("privilege_take_template", e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Выдача DC" hint="{nick} {amount}">
            <TextInput value={form.dc_rcon_template ?? ""} onChange={(e) => set("dc_rcon_template", e.target.value)} />
          </Field>
          <Field label="Списание DC" hint="{nick} {amount}">
            <TextInput value={form.dc_take_template ?? ""} onChange={(e) => set("dc_take_template", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Игровой мод (PoliteShop)</h3>
        <p className="text-xs text-muted-foreground">
          Донат-мод для NeoForge 1.21.1. Придумайте случайный секретный ключ и впишите его сюда, а тот же ключ — в
          конфиг мода на игровом сервере (<code className="rounded bg-muted px-1 py-0.5 text-foreground">config/politeshop-common.toml</code>,
          поле <code className="rounded bg-muted px-1 py-0.5 text-foreground">modAdminKey</code>). Без него серверные
          команды <code className="rounded bg-muted px-1 py-0.5 text-foreground">/dc</code> (выдача/списание) работать
          не будут. Пустой ключ = команды отключены.
        </p>
        <Field
          label="Публичный адрес сайта"
          hint="Куда мод отправляет игрока для оплаты пакетов DC. Например https://politempire.ru — БЕЗ localhost."
        >
          <TextInput
            value={form.site_url ?? ""}
            onChange={(e) => set("site_url", e.target.value)}
            placeholder="https://ваш-сайт.ру"
          />
        </Field>
        <Field label="Секретный ключ мода (mod_admin_key)" hint="Одинаковый на сайте и в конфиге мода">
          <TextInput
            type="password"
            value={form.mod_admin_key ?? ""}
            onChange={(e) => set("mod_admin_key", e.target.value)}
            placeholder="придумайте случайный ключ"
          />
        </Field>
        <Field label="Команда выдачи предмета" hint="{nick} {item} {count} — для товаров типа «Предмет»">
          <TextInput
            value={form.item_rcon_template ?? ""}
            onChange={(e) => set("item_rcon_template", e.target.value)}
            placeholder="give {nick} {item} {count}"
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">MyDonate</h3>
        <p className="text-xs text-muted-foreground">
          Оплата через витрину магазина MyDonate (СБП, карта). У MyDonate нет создания платежа по API с сервера
          (checkout защищён anti-bot), поэтому кнопка ведёт покупателя на вашу витрину, где проходит оплата и
          автоматическая выдача DC в игре плагином MyDonate. Укажите адрес вашей витрины.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.mydonate_enabled === "1"}
            onChange={(e) => set("mydonate_enabled", e.target.checked ? "1" : "0")}
            className="size-4 accent-primary"
          />
          <span className="text-sm">Включить оплату через MyDonate</span>
        </label>
        <Field label="URL витрины" hint="Адрес вашего магазина MyDonate">
          <TextInput
            value={form.mydonate_shop_url ?? ""}
            onChange={(e) => set("mydonate_shop_url", e.target.value)}
            placeholder="https://politempireshop.mydonate.io"
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">EasyDonate</h3>
        <p className="text-xs text-muted-foreground">
          Оплата DC за реальные деньги через EasyDonate. Заполните ключ магазина, ID сервера и ID товара-валюты
          «Donate Coins». В настройках магазина EasyDonate укажите Callback URL:{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">/api/shop/webhook</code>
        </p>
        <Field label="Shop Key" hint="Уникальный ключ магазина из настроек EasyDonate">
          <TextInput
            type="password"
            value={form.easydonate_shop_key ?? ""}
            onChange={(e) => set("easydonate_shop_key", e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ID сервера" hint="Раздел «Серверы» в магазине">
            <TextInput
              value={form.easydonate_server_id ?? ""}
              onChange={(e) => set("easydonate_server_id", e.target.value)}
            />
          </Field>
          <Field label="ID товара DC" hint="Товар-валюта «Donate Coins» (1₽ = 1 DC)">
            <TextInput
              value={form.easydonate_dc_product_id ?? ""}
              onChange={(e) => set("easydonate_dc_product_id", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Email для чеков" hint="Передаётся в EasyDonate при создании платежа">
          <TextInput value={form.easydonate_email ?? ""} onChange={(e) => set("easydonate_email", e.target.value)} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Millida</h3>
        <p className="text-xs text-muted-foreground">
          Оплата DC через Millida Merchant API (СБП, карта). В личном кабинете магазина Millida → «Интеграции →
          API-ключи» создайте ключ со scope <code className="rounded bg-muted px-1 py-0.5 text-foreground">payments</code>{" "}
          (и <code className="rounded bg-muted px-1 py-0.5 text-foreground">read</code>). В поле «URL вебхука» укажите{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">{`${siteUrl}/api/payments/millida/webhook`}</code> —
          при создании ключа Millida выдаст webhook secret. Вставьте сюда сам ключ (mtk_live_…) и секрет. Сайт создаёт
          счёт на сумму в рублях и сам начисляет DC после события{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">invoice.paid</code>.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.millida_enabled === "1"}
            onChange={(e) => set("millida_enabled", e.target.checked ? "1" : "0")}
            className="size-4 accent-primary"
          />
          <span className="text-sm">Включить оплату через Millida</span>
        </label>
        <Field label="API-ключ" hint="Секретный ключ вида mtk_live_… (scope payments)">
          <TextInput
            type="password"
            value={form.millida_api_key ?? ""}
            onChange={(e) => set("millida_api_key", e.target.value)}
            placeholder="mtk_live_..."
          />
        </Field>
        <Field label="Webhook Secret" hint="Выдаётся при создании API-ключа с URL вебхука">
          <TextInput
            type="password"
            value={form.millida_webhook_secret ?? ""}
            onChange={(e) => set("millida_webhook_secret", e.target.value)}
          />
        </Field>
      </Card>

      <Card className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Целостность лаунчера (self-integrity)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Когда включено, лаунчер при запуске сверяет SHA-256 своего .exe с белым списком официальных сборок.
            Изменённый лаунчер не запустит игру. Включайте ТОЛЬКО после того, как хеш текущей официальной сборки
            зарегистрирован в белом списке (через <code>release-launcher.bat</code>), иначе легальные игроки будут
            заблокированы. Выключено — проверка не применяется.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.launcher_integrity_enforce === "1"}
            onChange={(e) => set("launcher_integrity_enforce", e.target.checked ? "1" : "0")}
            className="size-4 accent-primary"
          />
          <span className="text-sm">Включить проверку целостности лаунчера</span>
        </label>
      </Card>

      <Card className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Donatello (гривна)</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Оплата через Donatello. Курс фиксированный: <strong>1 гривна = 1 DC</strong> (бонус применяется на
            сайте). Игрок получает уникальный код заказа и вставляет его в комментарий к донату. Начисление: мгновенно
            через колбэк (см. ниже), плюс резервная сверка кнопкой «Проверить донаты Donatello» на вкладке «Заказы» и
            через cron <code>/api/cron/donatello</code>.
          </p>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.donatello_enabled === "1"}
            onChange={(e) => set("donatello_enabled", e.target.checked ? "1" : "0")}
            className="size-4 accent-primary"
          />
          <span className="text-sm">Включить Donatello</span>
        </label>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="donatello_page_url">
            URL страницы доната (куда перенаправлять игрока)
          </label>
          <input
            id="donatello_page_url"
            type="url"
            value={form.donatello_page_url ?? ""}
            onChange={(e) => set("donatello_page_url", e.target.value)}
            placeholder="https://donatello.to/username"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="donatello_api_token">
            API Token (секретный, не показывать игрокам)
          </label>
          <input
            id="donatello_api_token"
            type="password"
            value={form.donatello_api_token ?? ""}
            onChange={(e) => set("donatello_api_token", e.target.value)}
            placeholder="token"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="donatello_api_base">
            API Base URL (обычно не менять)
          </label>
          <input
            id="donatello_api_base"
            type="url"
            value={form.donatello_api_base ?? ""}
            onChange={(e) => set("donatello_api_base", e.target.value)}
            placeholder="https://donatello.to/api/v1"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground" htmlFor="donatello_page_size">
            Кол-во последних донатов для проверк�� (обычно 50)
          </label>
          <input
            id="donatello_page_size"
            type="number"
            min="10"
            max="200"
            value={form.donatello_page_size ?? ""}
            onChange={(e) => set("donatello_page_size", e.target.value)}
            placeholder="50"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-xs font-semibold text-foreground">Мгновенное начисление (Колбэк Donatello)</p>
          <p className="mt-1 text-xs text-muted-foreground">
            В настройках Donatello → вкладка «Колбеки» включите колбэк, метод <code>POST</code>, вставьте URL{" "}
            <code>{`${siteUrl}/api/donatello/callback`}</code> и произвольный секретный ключ. Тот же ключ впишите ниже
            — тогда донаты будут начисляться сразу, без ожидания.
          </p>
          <label className="mb-1 mt-3 block text-xs text-muted-foreground" htmlFor="donatello_callback_key">
            Callback Key (X-Key, секретный)
          </label>
          <input
            id="donatello_callback_key"
            type="password"
            value={form.donatello_callback_key ?? ""}
            onChange={(e) => set("donatello_callback_key", e.target.value)}
            placeholder="придумайте случайный ключ"
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="flex items-center gap-1.5 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy && <LoaderCircle className="size-4 animate-spin" />}
          Сохранить настройки
        </button>
        {saved && <span className="text-sm text-emerald-500">Сохранено</span>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Мониторинги: бонус DC за голос                                       */
/* ------------------------------------------------------------------ */

function VoteSitesCard({
  sitesJson,
  cooldown,
  callbackKey,
  siteUrl,
  onSitesChange,
  onCooldownChange,
  onKeyChange,
}: {
  sitesJson: string
  cooldown: string
  callbackKey: string
  siteUrl: string
  onSitesChange: (json: string) => void
  onCooldownChange: (v: string) => void
  onKeyChange: (v: string) => void
}) {
  const sites = parseVoteSites(sitesJson)
  const base = (siteUrl || "https://ваш-сайт").replace(/\/+$/, "")

  function commit(next: VoteSite[]) {
    onSitesChange(JSON.stringify(next))
  }

  function update(i: number, patch: Partial<VoteSite>) {
    const next = sites.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    commit(next)
  }

  function add() {
    commit([...sites, { id: `site-${Date.now().toString(36)}`, name: "", url: "", bonus: 10, secret: "", mode: "url" }])
  }

  function remove(i: number) {
    commit(sites.filter((_, idx) => idx !== i))
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Бонусы за голос на мониторингах</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Игрок голосует за сервер на мониторинге и получает DC. Мониторинг должен уметь дёргать «callback URL» после
          голоса. В настройках каждого мониторинга укажите адрес ниже, подставив нужный слаг и плейсхолдер ника этого
          мониторинга (например <code className="rounded bg-muted px-1 py-0.5 text-foreground">{"{name}"}</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">%username%</code>).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Кулдаун, часов" hint="Как часто можно получать бонус за один мониторинг">
          <TextInput type="number" value={cooldown} onChange={(e) => onCooldownChange(e.target.value)} />
        </Field>
        <Field label="Секретный ключ колбэка" hint="Передаётся в URL как &key=... — защита от накрутки">
          <TextInput
            type="password"
            value={callbackKey}
            onChange={(e) => onKeyChange(e.target.value)}
            placeholder="придумайте случайный ключ"
          />
        </Field>
      </div>

      <div className="flex flex-col gap-4">
        {sites.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            Мониторинги не добавлены. Нажмите «Добавить мониторинг».
          </p>
        )}
        {sites.map((s, i) => {
          const isScript = s.mode === "script"
          const cbUrl = isScript
            ? `${base}/api/vote/callback?site=${encodeURIComponent(s.id || "site")}`
            : `${base}/api/vote/callback?site=${encodeURIComponent(s.id || "site")}&nick={name}${
                callbackKey ? `&key=${encodeURIComponent(callbackKey)}` : ""
              }`
          return (
            <div key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Название" hint="Показывается игрокам">
                  <TextInput
                    value={s.name}
                    onChange={(e) => {
                      const name = e.target.value
                      // Если слаг пуст или совпадал с автогенерацией — обновляем его.
                      const shouldSync = !s.id || s.id.startsWith("site-")
                      update(i, shouldSync ? { name, id: slugify(name) } : { name })
                    }}
                    placeholder="McRate"
                  />
                </Field>
                <Field label="Бонус, DC" hint="Сколько DC за голос">
                  <TextInput
                    type="number"
                    value={String(s.bonus)}
                    onChange={(e) => update(i, { bonus: Number(e.target.value) || 0 })}
                  />
                </Field>
              </div>

              {/* Переключатель режима приёма голосов */}
              <Field
                label="Режим приёма голоса"
                hint={
                  isScript
                    ? "Скрипт с подписью (как HotMC): мониторинг сам присылает username, time и sign."
                    : "Обычный: мониторинг дёргает URL с ником и общим ключом callback."
                }
              >
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => update(i, { mode: "url" })}
                    className={modeBtn(!isScript)}
                  >
                    Обычный (URL)
                  </button>
                  <button
                    type="button"
                    onClick={() => update(i, { mode: "script" })}
                    className={modeBtn(isScript)}
                  >
                    Скрипт (HotMC)
                  </button>
                </div>
              </Field>

              <Field label="Ссылка для голосования" hint="Куда ведёт кнопка «Голосовать»">
                <TextInput
                  value={s.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="https://mcrate.su/server/1234"
                />
              </Field>
              <Field label="Слаг (id)" hint="Уникальный, используется в callback URL">
                <TextInput value={s.id} onChange={(e) => update(i, { id: e.target.value })} placeholder="mcrate" />
              </Field>
              {isScript && (
                <Field
                  label="Секретный ключ мониторинга"
                  hint="Скопируйте секрет из панели мониторинга (у HotMC — раздел «Система поощрений»). Не путать с общим ключом callback."
                >
                  <TextInput
                    type="password"
                    value={s.secret}
                    onChange={(e) => update(i, { secret: e.target.value })}
                    placeholder="секрет из панели мониторинга"
                  />
                </Field>
              )}
              <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
                <p className="text-[11px] font-semibold text-foreground">Callback URL для этого мониторинга:</p>
                <code className="mt-1 block break-all font-mono text-[11px] text-muted-foreground">{cbUrl}</code>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {isScript
                    ? "Вставьте этот адрес как URL скрипта в панели мониторинга. Он сам отправит username, time и sign; секрет впишите в поле выше."
                    : "Замените {name} на плейсхолдер ника, принятый в вашем мониторинге."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="flex items-center gap-1.5 self-start rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
              >
                <Trash2 className="size-3.5" />
                Удалить
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" />
          Добавить мониторинг
        </button>
      </div>
    </Card>
  )
}
