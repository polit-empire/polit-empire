import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SkinViewer, WalkingAnimation } from "skinview3d"

interface PlaytimeStats {
  total_seconds: number
  session_count: number
  last_session_seconds: number
  longest_session_seconds: number
  last_played_unix: number
}

interface Props {
  nickname: string
}

function formatPlaytime(seconds: number): string {
  if (seconds < 60) return `${seconds}с`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

export default function ProfileTab({ nickname }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewerRef = useRef<SkinViewer | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [skinUrl, setSkinUrl] = useState<string | null>(null)
  const [hasSkin, setHasSkin] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [cacheBust, setCacheBust] = useState(() => Date.now())
  const [playtime, setPlaytime] = useState<PlaytimeStats | null>(null)

  useEffect(() => {
    invoke<string | null>("get_skin_url")
      .then(setSkinUrl)
      .catch(() => setSkinUrl(null))
  }, [])

  useEffect(() => {
    invoke<PlaytimeStats>("get_playtime_stats")
      .then(setPlaytime)
      .catch(() => {})
  }, [])

  // Инициализация и обновление 3D-просмотрщика
  useEffect(() => {
    if (!canvasRef.current || !skinUrl) return

    const viewer = new SkinViewer({
      canvas: canvasRef.current,
      width: 300,
      height: 400,
    })
    viewer.animation = new WalkingAnimation()
    viewer.animation.speed = 0.6
    viewer.autoRotate = true
    viewer.autoRotateSpeed = 0.5
    viewer.zoom = 0.85
    viewerRef.current = viewer

    viewer
      .loadSkin(`${skinUrl}?v=${cacheBust}`)
      .then(() => setHasSkin(true))
      .catch(() => setHasSkin(false))

    return () => {
      viewer.dispose()
      viewerRef.current = null
    }
  }, [skinUrl, cacheBust])

  const pickFile = () => fileRef.current?.click()

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setError("")
    setMessage("")

    if (!file.name.toLowerCase().endsWith(".png")) {
      setError("Скин должен быть PNG-файлом (64x64 или 64x32)")
      return
    }
    if (file.size > 128 * 1024) {
      setError("Файл слишком большой (максимум 128 КБ)")
      return
    }

    setBusy(true)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      await invoke("upload_skin", { data: Array.from(buf) })
      setMessage("Скин загружен! Он применится при следующем входе на сервер.")
      setCacheBust(Date.now())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const resetSkin = async () => {
    setError("")
    setMessage("")
    setBusy(true)
    try {
      await invoke("delete_skin")
      setMessage("Скин сброшен на стандартный.")
      setCacheBust(Date.now())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-bold">Профиль</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          3D-предпросмотр текущего скина. Модель можно вращать мышью.
        </p>
      </div>

      <div className="flex gap-6">
        {/* 3D viewer */}
        <div className="relative flex w-[300px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-gradient-to-b from-emerald-950/40 to-card">
          <canvas ref={canvasRef} className="cursor-grab active:cursor-grabbing" aria-label={`3D-модель скина игрока ${nickname}`} />
          {hasSkin === false && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/90 px-6 text-center">
              <p className="text-sm text-muted">Скин ещё не загружен</p>
              <p className="text-xs leading-relaxed text-muted">
                Загрузите PNG-файл — и модель появится здесь
              </p>
            </div>
          )}
        </div>

        {/* Info & actions */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-lg border border-border bg-card/60 p-4">
            <p className="text-xs text-muted">Никнейм</p>
            <p className="mt-0.5 truncate text-lg font-bold text-primary">{nickname}</p>
          </div>

          {playtime && (
            <div className="rounded-lg border border-border bg-card/60 p-4">
              <p className="text-xs text-muted">Наиграно всего</p>
              <p className="mt-0.5 text-lg font-bold text-primary">
                {playtime.total_seconds > 0
                  ? formatPlaytime(playtime.total_seconds)
                  : "Ещё не играли"}
              </p>
              {playtime.total_seconds > 0 && (
                <div className="mt-2 flex gap-4 text-xs text-muted">
                  <span>Сессий: {playtime.session_count}</span>
                  <span>Лучшая: {formatPlaytime(playtime.longest_session_seconds)}</span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-card/60 p-4">
            <h3 className="text-sm font-semibold">Скин</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Формат: PNG 64x64 (или классический 64x32), максимум 128 КБ. Скин применится на сервере при следующем
              входе в игру.
            </p>
            <input ref={fileRef} type="file" accept="image/png" onChange={onFileChosen} className="hidden" />
            <div className="mt-3 flex items-center gap-2.5">
              <button
                onClick={pickFile}
                disabled={busy}
                className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-background transition-colors hover:bg-primary-dark disabled:opacity-50"
              >
                {busy ? "Загрузка…" : "Загрузить скин"}
              </button>
              <button
                onClick={resetSkin}
                disabled={busy}
                className="rounded border border-border px-4 py-2 text-sm text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              >
                Сбросить
              </button>
            </div>
            {message && <p className="mt-3 text-xs leading-relaxed text-primary">{message}</p>}
            {error && <p className="mt-3 text-xs leading-relaxed text-danger">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
