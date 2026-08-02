import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import AuthScreen from "./screens/AuthScreen"
import Shell from "./Shell"
import type { UpdateInfo, UpdateProgress, VerifyResponse } from "./types"

type Screen = "loading" | "updating" | "auth" | "main" | "banned"

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading")
  const [nickname, setNickname] = useState<string>("")
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)
  const [updateError, setUpdateError] = useState("")
  const pollRef = useRef<number | null>(null)

  const checkSession = () => {
    invoke<VerifyResponse>("verify_session")
      .then((res) => {
        if (res.banned) {
          setScreen("banned")
        } else if (res.valid && res.nickname) {
          setNickname(res.nickname)
          setScreen("main")
        } else {
          setScreen("auth")
        }
      })
      .catch(() => setScreen("auth"))
  }

  // При запуске: сначала проверяем обновление лаунчера, затем сессию
  useEffect(() => {
    let cancelled = false
    invoke<UpdateInfo>("check_launcher_update")
      .then((info) => {
        if (cancelled) return
        if (info.available) {
          setUpdateInfo(info)
          setScreen("updating")
          // Тихо скачиваем и устанавливаем — лаунчер сам перезапустится
          pollRef.current = window.setInterval(async () => {
            try {
              const p = await invoke<UpdateProgress | null>("get_update_progress")
              if (p) setUpdateProgress(p)
            } catch {
              // ignore
            }
          }, 300)
          invoke("apply_launcher_update").catch((e) => {
            if (pollRef.current) window.clearInterval(pollRef.current)
            setUpdateError(String(e))
          })
        } else {
          checkSession()
        }
      })
      .catch(() => {
        // Сервер обновлений недоступен — работаем как обычно
        if (!cancelled) checkSession()
      })
    return () => {
      cancelled = true
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  // Пока открыт главный экран, раз в минуту проверяем бан.
  // Забанили — закрываем игру, разлогиниваем, показываем экран бана.
  useEffect(() => {
    if (screen !== "main") return
    const id = window.setInterval(async () => {
      try {
        const res = await invoke<VerifyResponse>("verify_session")
        if (res.banned) {
          await invoke("kill_game").catch(() => {})
          await invoke("logout").catch(() => {})
          setNickname("")
          setScreen("banned")
        }
      } catch {
        // Сеть недоступна — проверим в следующий раз
      }
    }, 60_000)
    return () => window.clearInterval(id)
  }, [screen])

  const handleLogout = async () => {
    await invoke("logout")
    setNickname("")
    setScreen("auth")
  }

  if (screen === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted">Проверка сессии…</p>
      </div>
    )
  }

  if (screen === "updating") {
    const pct =
      updateProgress && updateProgress.bytes_total > 0
        ? Math.min(100, Math.round((updateProgress.bytes_done / updateProgress.bytes_total) * 100))
        : null
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-5 px-8 text-center">
        <h1 className="text-xl font-bold">
          Обновление лаунчера{updateInfo ? ` до ${updateInfo.latestVersion}` : ""}
        </h1>
        {updateError ? (
          <>
            <p className="max-w-md text-sm leading-relaxed text-danger">{updateError}</p>
            <button
              onClick={() => {
                setUpdateError("")
                setScreen("loading")
                checkSession()
              }}
              className="rounded border border-border px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Продолжить без обновления
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {updateProgress?.stage === "installing"
                ? "Установка… Лаунчер перезапустится автоматически."
                : "Загрузка обновления…"}
            </p>
            <div className="w-72">
              <div className="h-1.5 overflow-hidden rounded-full bg-card">
                <div
                  className={`h-full rounded-full bg-primary transition-all ${pct === null ? "animate-pulse" : ""}`}
                  style={{ width: pct === null ? "100%" : `${pct}%` }}
                />
              </div>
              {updateProgress && updateProgress.bytes_total > 0 && (
                <p className="mt-2 text-xs text-muted">
                  {formatMb(updateProgress.bytes_done)} / {formatMb(updateProgress.bytes_total)}
                  {pct !== null ? ` · ${pct}%` : ""}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  if (screen === "banned") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-8 text-center">
        <h1 className="text-2xl font-bold text-danger">Аккаунт заблокирован</h1>
        <p className="max-w-md leading-relaxed text-muted">
          Ваш аккаунт был забанен администрацией сервера. Если вы считаете это ошибкой — напишите в поддержку в
          Telegram.
        </p>
      </div>
    )
  }

  if (screen === "auth") {
    return (
      <AuthScreen
        onAuthorized={(nick) => {
          setNickname(nick)
          setScreen("main")
        }}
      />
    )
  }

  return (
    <Shell
      nickname={nickname}
      onLogout={handleLogout}
      onSessionExpired={() => {
        // Токен уже стёрт бэкендом при 403 — просто возвращаемся на вход.
        setNickname("")
        setScreen("auth")
      }}
    />
  )
}
