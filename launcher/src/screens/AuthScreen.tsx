import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import type { LoginResponse } from "../types"

interface Props {
  onAuthorized: (nickname: string) => void
}

const BOT_URL = "https://t.me/polit_empire_bot"

export default function AuthScreen({ onAuthorized }: Props) {
  const [nickname, setNickname] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const canSubmit = nickname.trim().length >= 3 && password.length >= 1 && !loading

  const submit = async () => {
    if (!canSubmit) return
    setError("")
    setLoading(true)
    try {
      const res = await invoke<LoginResponse>("login", {
        nickname: nickname.trim(),
        password,
      })
      if (res.error) {
        setError(res.error)
      } else if (res.nickname) {
        onAuthorized(res.nickname)
      } else {
        setError("Неизвестная ошибка. Попробуйте ещё раз.")
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) submit()
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-emerald-950/50 via-background to-background px-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          Polit <span className="text-primary">Empire</span>
        </h1>
        <p className="text-sm text-muted">Официальный лаунчер сервера</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Ник</span>
          <input
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Steve"
            autoFocus
            maxLength={16}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="••••••••"
            maxLength={64}
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
          />
        </label>

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-1 rounded-md bg-primary px-8 py-3 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Вход…" : "Войти"}
        </button>

        {error && <p className="text-center text-sm text-danger">{error}</p>}
      </div>

      <p className="text-center text-xs leading-relaxed text-muted">
        Нет аккаунта? Зарегистрируйтесь в{" "}
        <button onClick={() => openUrl(BOT_URL)} className="text-primary underline-offset-2 hover:underline">
          Telegram-боте
        </button>{" "}
        — команда /start
      </p>
    </div>
  )
}
