"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { Card, TextArea } from "@/components/admin/ui"
import { isSecretKey, type EnvLine } from "@/lib/env-util"

type EnvFile = "site" | "bot"

type ContainerStatus = {
  name: string
  service: string
  state: string
  status: string
  health: string
  exitCode: number
  image: string
  ports: string
  runningFor: string
}

export function BackendPanel() {
  const [mtEnabled, setMtEnabled] = useState(false)
  const [mtMessage, setMtMessage] = useState("")
  const [mtSaved, setMtSaved] = useState<null | "ok" | "err">(null)

  // env: отдельное состояние на каждый файл (фикс «останется env сайта»)
  const [envFile, setEnvFile] = useState<EnvFile>("site")
  const [envs, setEnvs] = useState<Record<EnvFile, EnvLine[]>>({ site: [], bot: [] })
  const [envLoaded, setEnvLoaded] = useState<Record<EnvFile, boolean>>({ site: false, bot: false })
  const [envRaw, setEnvRaw] = useState<Record<EnvFile, string>>({ site: "", bot: "" })
  const [showRaw, setShowRaw] = useState(false)
  const [envSaving, setEnvSaving] = useState(false)
  const [envMsg, setEnvMsg] = useState<null | { kind: "ok" | "err"; text: string }>(null)
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})
  const rawDirty = useRef(false)

  // docker
  const [containers, setContainers] = useState<ContainerStatus[]>([])
  const [statusLoading, setStatusLoading] = useState(false)
  const [actionRunning, setActionRunning] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState("")
  const [autoRefresh, setAutoRefresh] = useState(false)

  // логи
  const [logService, setLogService] = useState("app")
  const [logText, setLogText] = useState("")
  const [logLoading, setLogLoading] = useState(false)
  const [logMsg, setLogMsg] = useState("")

  const envEntries = envs[envFile]
  // Комментарии и пустые строки в списке не показываем, но при сохранении они остаются.
  const shownEntries = envEntries
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: Extract<EnvLine, { kind: "kv" }>; i: number } => x.e.kind !== "raw")

  const loadMaintenance = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/maintenance", { cache: "no-store" })
      const j = await r.json()
      setMtEnabled(!!j.enabled)
      setMtMessage(j.message ?? "")
    } catch {
      setMtMessage("(не удалось прочитать состояние)")
    }
  }, [])

  const loadEnv = useCallback(async (file: EnvFile) => {
    setEnvMsg(null)
    try {
      const r = await fetch(`/api/admin/backend/env?file=${file}`, { cache: "no-store" })
      const j = await r.json()
      if (j.ok) {
        setEnvs((prev) => ({ ...prev, [file]: j.entries ?? [] }))
        setEnvRaw((prev) => ({ ...prev, [file]: j.content ?? "" }))
        setEnvLoaded((prev) => ({ ...prev, [file]: true }))
        setEnvMsg(null)
      } else {
        setEnvMsg({ kind: "err", text: j.error ?? "Ошибка загрузки" })
      }
    } catch {
      setEnvMsg({ kind: "err", text: "Не удалось прочитать .env" })
    }
  }, [])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const r = await fetch("/api/admin/backend/status?format=json", { cache: "no-store" })
      const j = await r.json()
      if (j.ok) setContainers(j.containers ?? [])
      else setContainers([])
    } catch {
      setContainers([])
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const loadLogs = useCallback(async () => {
    setLogLoading(true)
    setLogMsg("")
    try {
      const r = await fetch(`/api/admin/backend/logs?service=${logService}&lines=300`, { cache: "no-store" })
      const j = await r.json()
      setLogText((j.stdout ?? "") + (j.stderr ? `\n[stderr]\n${j.stderr}` : ""))
      if (!j.ok) setLogMsg(j.error ?? "Ошибка загрузки логов")
    } catch {
      setLogMsg("Не удалось загрузить логи")
    } finally {
      setLogLoading(false)
    }
  }, [logService])

  // Автоматическое обновление статусов раз в 10 секунд, пока включено.
  useEffect(() => {
    if (!autoRefresh) return
    loadStatus()
    const t = setInterval(loadStatus, 10_000)
    return () => clearInterval(t)
  }, [autoRefresh, loadStatus])

  useEffect(() => {
    loadMaintenance()
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // При смене файла: если ещё не загружен — грузим его env (весь по отдельности).
  useEffect(() => {
    if (!envLoaded[envFile]) loadEnv(envFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envFile])

  const saveMaintenance = async (enabled: boolean) => {
    setMtSaved(null)
    try {
      const r = await fetch("/api/admin/maintenance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, message: mtMessage }),
      })
      const j = await r.json()
      if (j.ok) {
        setMtEnabled(enabled)
        setMtSaved("ok")
      } else {
        setMtSaved("err")
      }
    } catch {
      setMtSaved("err")
    }
  }

  const updateEntry = (i: number, patch: Partial<EnvLine>) => {
    setEnvs((prev) => {
      const arr = prev[envFile].map((e, idx) => (idx === i ? { ...e, ...patch } : e))
      return { ...prev, [envFile]: arr }
    })
  }

  const removeEntry = (i: number) => {
    setEnvs((prev) => ({ ...prev, [envFile]: prev[envFile].filter((_, idx) => idx !== i) }))
  }

  const addEntry = () => {
    setEnvs((prev) => ({ ...prev, [envFile]: [...prev[envFile], { kind: "kv", key: "", value: "" }] }))
  }

  const saveEnv = async () => {
    setEnvSaving(true)
    setEnvMsg(null)
    try {
      const body = showRaw
        ? { file: envFile, content: envRaw[envFile] }
        : { file: envFile, entries: envs[envFile] }
      const r = await fetch("/api/admin/backend/env", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.ok) {
        setEnvMsg({ kind: "ok", text: "Сохранено. Изменения вступят в силу после рестарта контейнера." })
        rawDirty.current = false
        loadEnv(envFile) // перечитываем с сервера
      } else {
        setEnvMsg({ kind: "err", text: j.error ?? "Ошибка сохранения" })
      }
    } catch {
      setEnvMsg({ kind: "err", text: "Ошибка сохранения" })
    } finally {
      setEnvSaving(false)
    }
  }

  const runAction = async (action: "restart" | "rebuild", service: string) => {
    setActionRunning(`${action}:${service}`)
    setActionMsg("")
    try {
      const r = await fetch("/api/admin/backend/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, service }),
      })
      const j = await r.json()
      setActionMsg(j.ok ? "Выполнено" : j.stderr || j.error || "Ошибка")
      loadStatus()
    } catch {
      setActionMsg("Ошибка выполнения команды")
    } finally {
      setActionRunning(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* ===== Техработа ===== */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Технические работы</h3>
          <span className="flex items-center gap-2">
            <span className={`inline-block size-2.5 rounded-full ${mtEnabled ? "bg-amber-500" : "bg-emerald-500"}`} />
            <span className={`text-sm font-medium ${mtEnabled ? "text-amber-500" : "text-emerald-500"}`}>
              {mtEnabled ? "Включено" : "Выключено"}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Сообщение для игроков</label>
            <TextArea
              placeholder="«Сервер обновляется, ориентировочно до 22:00»…"
              value={mtMessage}
              onChange={(e) => setMtMessage(e.target.value)}
              className="min-h-14"
            />
          </div>
          <button
            type="button"
            onClick={() => saveMaintenance(!mtEnabled)}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white transition-colors ${
              mtEnabled ? "bg-amber-600 hover:bg-amber-500" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {mtEnabled ? "Выключить" : "Включить"}
          </button>
        </div>
        {mtSaved === "ok" && <p className="mt-2 text-sm text-emerald-600">Сохранено</p>}
        {mtSaved === "err" && <p className="mt-2 text-sm text-red-500">Ошибка сохранения</p>}
      </Card>

      {/* ===== Переменные окружения ===== */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Переменные окружения</h3>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["site", "bot"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setEnvFile(f)
                    setEnvMsg(null)
                  }}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    envFile === f ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f === "site" ? "Сайт" : "Telegram-бот"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowRaw((s) => !s)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                showRaw ? "border-primary text-primary" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {showRaw ? "Вернуться к списку" : "Сырой файл"}
            </button>
          </div>
        </div>

        {!envLoaded[envFile] ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : showRaw ? (
          <TextArea
            className="min-h-64 font-mono text-xs"
            spellCheck={false}
            value={envRaw[envFile]}
            onChange={(e) => {
              setEnvRaw((prev) => ({ ...prev, [envFile]: e.target.value }))
              rawDirty.current = true
            }}
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Переменная</th>
                  <th className="px-3 py-2 font-medium">Значение</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {shownEntries.map(({ e: entry, i }) => (
                  <tr key={`${entry.key}-${i}`} className="border-b border-border/60">
                    <td className="px-3 py-1.5">
                      <input
                        value={entry.key}
                        onChange={(e) => updateEntry(i, { key: e.target.value })}
                        spellCheck={false}
                        className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs font-medium text-foreground outline-none focus:border-primary"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type={showSecret[entry.key] ? "text" : "password"}
                          value={entry.value}
                          onChange={(e) => updateEntry(i, { value: e.target.value })}
                          placeholder={isSecretKey(entry.key) ? "секрет" : ""}
                          spellCheck={false}
                          className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 font-mono text-xs outline-none transition-colors focus:border-primary"
                        />
                        {isSecretKey(entry.key) && (
                          <button
                            type="button"
                            onClick={() => setShowSecret((s) => ({ ...s, [entry.key]: !s[entry.key] }))}
                            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                            title={showSecret[entry.key] ? "Скрыть" : "Показать"}
                          >
                            {showSecret[entry.key] ? "🙈" : "👁️"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => removeEntry(i)}
                        className="text-xs text-muted-foreground hover:text-red-400"
                        title="Удалить строку"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between gap-2 border-t border-border p-2">
              <button
                type="button"
                onClick={addEntry}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                + Добавить переменную
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={saveEnv}
            disabled={envSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {envSaving ? "Сохранение…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => loadEnv(envFile)}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            Перечитать
          </button>
          {envMsg &&
            (envMsg.kind === "ok" ? (
              <p className="text-sm text-emerald-600">{envMsg.text}</p>
            ) : (
              <p className="text-sm text-red-500">{envMsg.text}</p>
            ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Секреты показываются звёздочками (👁 показать). Изменения вступают в силу после рестарта контейнера.
        </p>
      </Card>

      {/* ===== Docker: статусы контейнеров ===== */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Контейнеры</h3>
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="accent-primary"
              />
              Автообновление каждые 10с
            </label>
            <button
              type="button"
              onClick={loadStatus}
              disabled={statusLoading}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {statusLoading ? "Обновление…" : "Обновить"}
            </button>
          </div>
        </div>

        {containers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нажмите «Обновить», чтобы увидеть список контейнеров.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {containers.map((c) => {
              const running = c.state.toLowerCase() === "running"
              return (
                <div
                  key={c.name}
                  className="rounded-md border border-border bg-muted/30 p-3 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`inline-block size-2.5 shrink-0 rounded-full ${running ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="truncate font-mono text-sm font-semibold">{c.name}</span>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${mainStyle(c.state)}`}>
                      {c.state}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-mono">{c.image}</span>
                    <span className="shrink-0">{c.status}</span>
                  </div>
                  {c.ports && <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{c.ports}</div>}
                  <div className="mt-2 flex gap-1.5">
                    {(["restart", "rebuild"] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        disabled={actionRunning === `${a}:${c.service}`}
                        onClick={() => runAction(a, c.service)}
                        className="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
                      >
                        {a === "restart" ? "Рестарт" : "Пересборка"}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {actionMsg && <p className="mt-2 text-sm">{actionMsg}</p>}
      </Card>

      {/* ===== Логи ===== */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Логи</h3>
          <div className="flex items-center gap-2">
            <select
              value={logService}
              onChange={(e) => setLogService(e.target.value)}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none"
            >
              {["app", "bots", "gml-web-api", "gml-web-proxy", "gml-web-frontend", "gml-web-skins"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={loadLogs}
              disabled={logLoading}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {logLoading ? "Загрузка…" : "Обновить"}
            </button>
          </div>
        </div>
        <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
          {logText || "Логи ещё не загружены. Выберите сервис и нажмите «Обновить»."}
        </pre>
        {logMsg && <p className="mt-2 text-sm text-red-500">{logMsg}</p>}
      </Card>
    </div>
  )
}

function mainStyle(state: string): string {
  const s = state.toLowerCase()
  if (s === "running") return "bg-emerald-500/10 text-emerald-600 ring-emerald-500/20"
  if (s === "restarting" || s.startsWith("restart")) return "bg-amber-500/10 text-amber-600 ring-amber-500/20"
  if (s === "exited" || s === "dead") return "bg-red-500/10 text-red-600 ring-red-500/20"
  return "bg-muted text-muted-foreground ring-muted"
}