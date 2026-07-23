import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { Settings } from "../types"
import {
  BASE_THEMES,
  applyActiveTheme,
  getCurrentSeason,
  loadBaseThemeId,
  saveBaseThemeId,
} from "../lib/theme"

const MEMORY_PRESETS = [
  { label: "4 ГБ", value: 4096, hint: "минимум" },
  { label: "6 ГБ", value: 6144, hint: "рекомендуем" },
  { label: "8 ГБ", value: 8192, hint: "комфортно" },
  { label: "12 ГБ", value: 12288, hint: "с запасом" },
]

export default function SettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  // Автопоиск Java = пустой путь. Снятие галочки открывает ручной ввод.
  const [javaAuto, setJavaAuto] = useState(true)
  // Выбранная обычная тема оформления (хранится в localStorage, не в Rust).
  const [themeId, setThemeId] = useState<string>(loadBaseThemeId())
  // Активный праздник: в праздничные дни поверх обычной темы включается
  // сезонная палитра — предупреждаем игрока, что выбор виден не сразу.
  const season = getCurrentSeason()

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((s) => {
        setSettings(s)
        setJavaAuto(s.java_path.trim() === "")
      })
      .catch((e) => setError(String(e)))
  }, [])

  const chooseTheme = (id: string) => {
    setThemeId(id)
    saveBaseThemeId(id)
    // Применяем сразу (в праздник сезонная палитра остаётся поверх).
    applyActiveTheme(id)
  }

  const openFolder = async (path: string, select: boolean) => {
    setError("")
    try {
      await invoke("open_in_explorer", { path, select })
    } catch (e) {
      setError(String(e))
    }
  }

  const browseJava = async () => {
    setError("")
    try {
      const picked = await invoke<string | null>("pick_java_file")
      if (picked && settings) setSettings({ ...settings, java_path: picked })
    } catch (e) {
      setError(String(e))
    }
  }

  const toggleJavaAuto = (auto: boolean) => {
    setJavaAuto(auto)
    // Включили автопоиск — очищаем путь, чтобы лаунчер искал Java сам.
    if (auto && settings) setSettings({ ...settings, java_path: "" })
  }

  const browseFolder = async () => {
    setError("")
    try {
      const picked = await invoke<string | null>("pick_folder", { current: settings?.game_dir ?? null })
      if (picked && settings) setSettings({ ...settings, game_dir: picked })
    } catch (e) {
      setError(String(e))
    }
  }

  const save = async () => {
    if (!settings) return
    setError("")
    try {
      await invoke("save_settings", { settings })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(String(e))
    }
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">Загрузка настроек…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-bold">Настройки</h2>
      </div>

      {/* Appearance / themes */}
      <section className="rounded-lg border border-border bg-card/60 p-5">
        <h3 className="text-sm font-semibold">Оформление</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Выберите тему лаунчера. В праздники (Новый год, Хэллоуин, Пасха и другие) поверх неё
          автоматически включается праздничное оформление.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {BASE_THEMES.map((t) => {
            const active = themeId === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => chooseTheme(t.id)}
                className={`flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/60"
                }`}
                title={t.hint}
                aria-pressed={active}
              >
                {/* Мини-превью палитры темы */}
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-5 shrink-0 rounded-full border border-white/10"
                    style={{ background: `rgb(${t.palette.background})` }}
                  />
                  <span
                    className="size-5 shrink-0 rounded-full border border-white/10"
                    style={{ background: `rgb(${t.palette.card})` }}
                  />
                  <span
                    className="size-5 shrink-0 rounded-full border border-white/10"
                    style={{ background: `rgb(${t.palette.primary})` }}
                  />
                </span>
                <span className="flex items-center justify-between gap-1">
                  <span className={`text-sm font-medium ${active ? "text-primary" : "text-foreground"}`}>
                    {t.title}
                  </span>
                  {active && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="size-3.5 text-primary" aria-hidden="true">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="text-[11px] leading-tight text-muted">{t.hint}</span>
              </button>
            )
          })}
        </div>

        {season && (
          <p className="mt-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted">
            {season.emoji} Сейчас активно праздничное оформление «{season.title}». Выбранная тема
            вступит в силу после окончания праздника.
          </p>
        )}
      </section>

      {/* Performance */}
      <section className="rounded-lg border border-border bg-card/60 p-5">
        <h3 className="text-sm font-semibold">Производительность</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Не выделяйте игре больше половины памяти компьютера.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="memory" className="text-sm">
              Выделяемая память
            </label>
            <span className="rounded bg-primary/15 px-2 py-0.5 text-sm font-semibold text-primary">
              {(settings.memory_mb / 1024).toFixed(1)} ГБ
            </span>
          </div>
          <input
            id="memory"
            type="range"
            min={2048}
            max={16384}
            step={512}
            value={settings.memory_mb}
            onChange={(e) => setSettings({ ...settings, memory_mb: Number(e.target.value) })}
            className="accent-primary"
          />
          <div className="flex justify-between text-xs text-muted">
            <span>2 ГБ</span>
            <span>16 ГБ</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            {MEMORY_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setSettings({ ...settings, memory_mb: p.value })}
                className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                  settings.memory_mb === p.value
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted hover:border-primary hover:text-foreground"
                }`}
                title={p.hint}
              >
                {p.label}
                <span className="ml-1.5 opacity-60">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Files */}
      <section className="rounded-lg border border-border bg-card/60 p-5">
        <h3 className="text-sm font-semibold">Файлы игры</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Где хранится сборка сервера. При смене папки файлы будут скачаны заново при следующем запуске.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="gamedir" className="text-sm">
              Папка со сборкой
            </label>
            <div className="flex items-stretch gap-2">
              <input
                id="gamedir"
                type="text"
                value={settings.game_dir}
                onChange={(e) => setSettings({ ...settings, game_dir: e.target.value })}
                className="flex-1 rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={browseFolder}
                className="shrink-0 rounded border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-primary hover:text-foreground"
                title="Выбрать папку со сборкой"
              >
                Обзор…
              </button>
              <button
                type="button"
                onClick={() => openFolder(settings.game_dir, false)}
                className="shrink-0 rounded border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-primary hover:text-foreground"
                title="Открыть папку со сборкой в проводнике"
              >
                Открыть папку
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm">Java</span>

            <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={javaAuto}
                onChange={(e) => toggleJavaAuto(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span>Автоматический поиск Java</span>
            </label>

            {javaAuto ? (
              <p className="text-xs leading-relaxed text-muted">
                Лаунчер сам найдёт подходящую Java 21+. Снимите галочку, чтобы указать путь вручную.
              </p>
            ) : (
              <>
                <div className="flex items-stretch gap-2">
                  <input
                    id="java"
                    type="text"
                    placeholder="C:\Program Files\Java\jdk-21\bin\java.exe"
                    value={settings.java_path}
                    onChange={(e) => setSettings({ ...settings, java_path: e.target.value })}
                    className="flex-1 rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={browseJava}
                    className="shrink-0 rounded border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-primary hover:text-foreground"
                    title="Выбрать java.exe"
                  >
                    Обзор…
                  </button>
                  <button
                    type="button"
                    onClick={() => openFolder(settings.java_path, true)}
                    disabled={settings.java_path.trim() === ""}
                    className="shrink-0 rounded border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title="Открыть папку с Java в проводнике"
                  >
                    Открыть папку
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  Для Minecraft 1.21.1 требуется Java 21 или новее. Укажите путь до java.exe.
                </p>
              </>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-background transition-colors hover:bg-primary-dark"
        >
          Сохранить
        </button>
        {saved && <span className="text-sm text-primary">Сохранено</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  )
}
