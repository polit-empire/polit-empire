import { useEffect, useMemo, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { openUrl } from "@tauri-apps/plugin-opener"
import HomeTab from "./screens/HomeTab"
import ModsTab from "./screens/ModsTab"
import ProfileTab from "./screens/ProfileTab"
import SettingsTab from "./screens/SettingsTab"
import { getCurrentSeason } from "./lib/theme"
import type { SyncProgress, VerifyResponse } from "./types"

type Tab = "home" | "mods" | "profile" | "settings"

interface MaintenanceStatus {
  enabled: boolean
  site: boolean
  launcher: boolean
  message: string
  admin_allowed: boolean
}

interface Props {
  nickname: string
  onLogout: () => void
  onSessionExpired: () => void
}

const DISCORD_URL = "https://discord.gg/dqDx9qsQd9"
const TELEGRAM_URL = "https://t.me/politempire"
const MAP_URL = "https://map.politempire.org"

const STAGE_LABELS: Record<string, string> = {
  manifest: "Получение манифеста…",
  checking: "Проверка файлов…",
  downloading: "Загрузка файлов",
  cleaning: "Очистка лишнего…",
  launching: "Защита и запуск…",
  done: "Игра запущена",
  error: "Ошибка",
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ГБ`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  return `${(bytes / 1024).toFixed(0)} КБ`
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "home",
    label: "Главная",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 9.5V21h14V9.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "mods",
    label: "Моды",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true">
        <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" strokeLinejoin="round" />
        <path d="M3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "profile",
    label: "Профиль",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Настройки",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.09a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
]

export default function Shell({ nickname, onLogout, onSessionExpired }: Props) {
  const [tab, setTab] = useState<Tab>("home")
  const [busy, setBusy] = useState(false)
  const [gameRunning, setGameRunning] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [error, setError] = useState("")
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null)
  const pollRef = useRef<number | null>(null)
  const gamePollRef = useRef<number | null>(null)
  // Активный праздник (если есть): эмодзи у логотипа + приветствие внизу.
  const season = useMemo(() => getCurrentSeason(), [])

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const stopGamePolling = () => {
    if (gamePollRef.current) {
      window.clearInterval(gamePollRef.current)
      gamePollRef.current = null
    }
  }

  useEffect(() => stopGamePolling, [])

  // Статус техработ: периодически опрашиваем сайт и показываем баннер.
  useEffect(() => {
    let cancelled = false
    const fetchStatus = async () => {
      try {
        const s = await invoke<MaintenanceStatus>("get_maintenance_status")
        if (!cancelled) setMaintenance(s)
      } catch {
        // fail-open: не показываем баннер, если сайт недоступен
      }
    }
    fetchStatus()
    const t = window.setInterval(fetchStatus, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

  // Пока игра запущена: лаунчер скрыт в трее, следим за процессом игры.
  // Когда игра закрывается — возвращаем окно лаунчера.
  const watchGame = () => {
    setGameRunning(true)
    getCurrentWindow().hide().catch(() => {})
    gamePollRef.current = window.setInterval(async () => {
      try {
        const running = await invoke<boolean>("is_game_running")
        if (!running) {
          stopGamePolling()
          setGameRunning(false)
          const win = getCurrentWindow()
          await win.show().catch(() => {})
          await win.unminimize().catch(() => {})
          await win.setFocus().catch(() => {})
        }
      } catch {
        // ignore
      }
    }, 2000)
  }

  const play = async () => {
    // Игра уже запущена — кнопка работает как «Закрыть»
    if (gameRunning) {
      try {
        await invoke("kill_game")
      } catch {
        // ignore
      }
      stopGamePolling()
      setGameRunning(false)
      return
    }

    setBusy(true)
    setError("")
    setProgress(null)

    pollRef.current = window.setInterval(async () => {
      try {
        const p = await invoke<SyncProgress | null>("get_sync_progress")
        if (p) setProgress(p)
      } catch {
        // ignore
      }
    }, 400)

    let launched = false
    let sessionInvalid = false
    try {
      await invoke("sync_and_launch")
      launched = true
    } catch (e) {
      setError(String(e))
      // При 403 бэкенд уже стёр токен. Перепроверяем сессию: если она
      // недействительна — уводим игрока на экран входа за свежим токеном
      // (иначе "войдите заново" невыполнимо). Сетевые ошибки не трогаем.
      try {
        const res = await invoke<VerifyResponse>("verify_session")
        if (!res.valid) sessionInvalid = true
      } catch {
        // сеть недоступна — оставляем пользователя на месте
      }
    } finally {
      stopPolling()
      setBusy(false)
      setProgress(null)
    }
    if (launched) watchGame()
    else if (sessionInvalid) onSessionExpired()
  }

  const cancel = async () => {
    await invoke("cancel_sync")
  }

  const external = (url: string) => {
    openUrl(url).catch(() => {})
  }

  const pct =
    progress && progress.bytes_total > 0
      ? Math.min(100, Math.round((progress.bytes_done / progress.bytes_total) * 100))
      : null

  return (
    <div className="flex h-screen flex-col bg-gradient-to-b from-[color:var(--pe-tint)] via-background to-background">
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-background/60">
          <div className="px-5 pb-4 pt-5">
            <h1 className="text-base font-bold tracking-tight">
              Polit <span className="text-primary">Empire</span>
              {season && (
                <span className="ml-1.5" title={season.title} aria-hidden="true">
                  {season.emoji}
                </span>
              )}
            </h1>
          </div>

          <nav className="flex flex-col gap-1 px-3" aria-label="Разделы лаунчера">
            {TABS.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  tab === id
                    ? "bg-primary/15 font-semibold text-primary"
                    : "text-muted hover:bg-card hover:text-foreground"
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-1 px-3 pb-4">
            <button
              onClick={() => external(MAP_URL)}
              className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
                <path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2Z" strokeLinejoin="round" />
                <path d="M9 4v14M15 6v14" />
              </svg>
              Онлайн-карта
            </button>
            <button
              onClick={() => external(DISCORD_URL)}
              className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden="true">
                <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.78 13.78 0 0 0-.64 1.28 18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.64-1.28c-1.71.29-3.37.8-4.93 1.51A20.26 20.26 0 0 0 .1 18.06a19.9 19.9 0 0 0 6.07 3.03c.49-.66.92-1.37 1.29-2.1a12.9 12.9 0 0 1-2.03-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.14 0c.16.13.33.26.5.38-.65.38-1.33.7-2.03.97.37.73.8 1.44 1.29 2.1a19.84 19.84 0 0 0 6.07-3.03 20.2 20.2 0 0 0-2.58-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.95-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42Z" />
              </svg>
              Discord
            </button>
            <button
              onClick={() => external(TELEGRAM_URL)}
              className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors hover:text-foreground"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden="true">
                <path d="M21.94 3.62a1.5 1.5 0 0 0-2-1.1L2.6 9.16c-1.4.52-1.35 2.5.07 2.96l4.44 1.42 1.72 5.35c.4 1.24 1.98 1.53 2.8.53l2.16-2.66 4.3 3.14c1.04.76 2.52.2 2.79-1.07l3.06-15.2ZM7.9 12.6l9.44-5.9c.35-.22.72.26.42.55l-7.34 6.98a1.5 1.5 0 0 0-.44.85l-.31 2.3-1.15-3.58a1.5 1.5 0 0 1 .69-1.2Z" />
              </svg>
              Telegram
            </button>

            <div className="mt-2 border-t border-border pt-2">
              <button
                onClick={onLogout}
                className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors hover:text-danger"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" strokeLinecap="round" />
                  <path d="m16 17 5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Выйти ({nickname})
              </button>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          {maintenance && (maintenance.enabled || maintenance.site || maintenance.launcher) && (
            <div className="mx-5 mt-5 flex items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3.5">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-amber-500">Технические работы</p>
                {maintenance.message && <p className="text-xs text-muted">{maintenance.message}</p>}
                <p className="mt-0.5 text-[11px] text-muted">
                  {[
                    maintenance.site && "сайт",
                    maintenance.launcher && "лаунчер",
                  ]
                    .filter(Boolean)
                    .join(" + ")}
                </p>
              </div>
              {maintenance.admin_allowed && (
                <span className="shrink-0 text-[11px] font-medium text-emerald-500">Вы администратор — доступ разрешён</span>
              )}
            </div>
          )}
          {tab === "home" && <HomeTab nickname={nickname} />}
          {tab === "mods" && <ModsTab />}
          {tab === "profile" && <ProfileTab nickname={nickname} />}
          {tab === "settings" && <SettingsTab />}
        </main>
      </div>

      {/* Bottom play bar */}
      <footer className="flex items-center gap-4 border-t border-border bg-background/80 px-5 py-3.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {busy && progress ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="truncate text-foreground">
                  {STAGE_LABELS[progress.stage] ?? progress.stage}
                  {progress.stage === "downloading" && progress.current_file && (
                    <span className="ml-2 text-muted">{progress.current_file}</span>
                  )}
                </span>
                {pct !== null && progress.stage === "downloading" && (
                  <span className="ml-3 shrink-0 text-muted">
                    {formatBytes(progress.bytes_done)} / {formatBytes(progress.bytes_total)} · {pct}%
                  </span>
                )}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-card">
                <div
                  className={`h-full rounded-full bg-primary transition-all ${
                    progress.stage !== "downloading" ? "animate-pulse" : ""
                  }`}
                  style={{ width: progress.stage === "downloading" ? `${pct ?? 0}%` : "100%" }}
                />
              </div>
            </>
          ) : error ? (
            <p className="truncate text-xs text-danger" title={error}>
              {error}
            </p>
          ) : gameRunning ? (
            <p className="text-xs text-muted">Игра запущена — лаунчер свёрнут в трей</p>
          ) : (
            <p className="text-xs text-muted">{season ? season.greeting : ""}</p>
          )}
        </div>

        {busy && progress?.stage === "downloading" && (
          <button
            onClick={cancel}
            className="shrink-0 rounded border border-border px-3 py-2 text-xs text-muted transition-colors hover:border-danger hover:text-danger"
          >
            Отменить
          </button>
        )}

        <button
          onClick={play}
          disabled={busy}
          className={`shrink-0 rounded-md px-10 py-3 text-base font-bold shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            gameRunning
              ? "bg-danger text-white shadow-danger/20 hover:opacity-90"
              : "bg-primary text-background shadow-primary/20 hover:bg-primary-dark"
          }`}
        >
          {busy ? "Запуск…" : gameRunning ? "Закрыть" : "Играть"}
        </button>
      </footer>
    </div>
  )
}
