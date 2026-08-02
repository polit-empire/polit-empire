"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, Select, TextArea } from "@/components/admin/ui"

type EnvFile = "site" | "bot"

const services = ["app", "bots", "gml-web-api", "gml-web-proxy", "gml-web-frontend", "gml-web-skins"]

export function BackendPanel() {
  // --- Техработа ---
  const [mtEnabled, setMtEnabled] = useState(false)
  const [mtMessage, setMtMessage] = useState("")
  const [mtLoading, setMtLoading] = useState(false)
  const [mtMsg, setMtMsg] = useState("")

  // --- env ---
  const [envFile, setEnvFile] = useState<EnvFile>("site")
  const [envContent, setEnvContent] = useState("")
  const [envSaving, setEnvSaving] = useState(false)
  const [envMsg, setEnvMsg] = useState("")

  // --- докер ---
  const [statusText, setStatusText] = useState("")
  const [statusLoading, setStatusLoading] = useState(false)
  const [actionRunning, setActionRunning] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState("")

  // --- логи ---
  const [logService, setLogService] = useState("app")
  const [logText, setLogText] = useState("")
  const [logLoading, setLogLoading] = useState(false)
  const [logMsg, setLogMsg] = useState("")

  const loadMaintenance = useCallback(async () => {
    setMtLoading(true)
    try {
      const r = await fetch("/api/admin/maintenance", { cache: "no-store" })
      const j = await r.json()
      setMtEnabled(!!j.enabled)
      setMtMessage(j.message ?? "")
    } catch {
      setMtMsg("Не удалось загрузить состояние техработ")
    } finally {
      setMtLoading(false)
    }
  }, [])

  const loadEnv = useCallback(async () => {
    setEnvMsg("")
    setEnvContent("Содержимое не загружено")
    try {
      const r = await fetch(`/api/admin/backend/env?file=${envFile}`, { cache: "no-store" })
      const j = await r.json()
      if (j.ok) setEnvContent(j.content)
      else setEnvMsg(j.error ?? "Ошибка загрузки")
    } catch {
      setEnvMsg("Не удалось прочитать .env")
    }
  }, [envFile])

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusText("")
    try {
      const r = await fetch("/api/admin/backend/status", { cache: "no-store" })
      const j = await r.json()
      setStatusText((j.stderr ? `ERR:\n${j.stderr}\n\n` : "") + (j.stdout ?? ""))
    } catch {
      setStatusText("Не удалось получить статус docker")
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

  const saveMaintenance = async () => {
    setMtMsg("")
    setMtLoading(true)
    try {
      const r = await fetch("/api/admin/maintenance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: mtEnabled, message: mtMessage }),
      })
      const j = await r.json()
      setMtMsg(j.ok ? "Сохранено" : j.error ?? "Ошибка")
    } catch {
      setMtMsg("Ошибка сохранения")
    } finally {
      setMtLoading(false)
    }
  }

  const saveEnv = async () => {
    setEnvSaving(true)
    setEnvMsg("")
    try {
      const r = await fetch("/api/admin/backend/env", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: envFile, content: envContent }),
      })
      const j = await r.json()
      setEnvMsg(j.ok ? "Сохранено. Изменения вступят в силу после рестарта контейнера." : j.error ?? "Ошибка")
    } catch {
      setEnvMsg("Ошибка сохранения")
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
    } catch {
      setActionMsg("Ошибка выполнения команды")
    } finally {
      setActionRunning(null)
    }
  }

  useEffect(() => {
    loadMaintenance()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!envContent || envContent === "Содержимое не загружено") loadEnv()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envFile])

  return (
    <div className="space-y-6">
      {/* ===== Техработа ===== */}
      <Card>
        <h3 className="mb-3 text-lg font-semibold">Технические работы</h3>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setMtEnabled(!mtEnabled)
              setMtMsg("")
            }}
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              mtEnabled ? "bg-destructive text-white" : "bg-emerald-600 text-white"
            }`}
          >
            {mtEnabled ? "Выключить техработы" : "Включить техработы"}
          </button>
          <span className={mtEnabled ? "text-sm font-semibold text-amber-600" : "text-sm text-muted-foreground"}>
            {mtEnabled ? "Включено — посетители видят заглушку" : "Выключено"}
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <TextArea
            placeholder="Сообщение: «Сервер обновляется, до 22:00»…"
            value={mtMessage}
            onChange={(e) => setMtMessage(e.target.value)}
            className="min-h-16"
          />
          <button
            type="button"
            disabled={mtLoading}
            onClick={loadMaintenance}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs"
          >
            Обновить из БД
          </button>
        </div>
        {mtMsg && <p className="mt-2 text-sm">{mtMsg}</p>}
      </Card>

      {/* ===== Переменные окружения ===== */}
      <Card>
        <h3 className="mb-3 text-lg font-semibold">Переменные окружения (.env)</h3>
        <div className="mb-2 flex items-center gap-2">
          <Select value={envFile} onChange={(e) => setEnvFile(e.target.value as EnvFile)} className="w-44">
            <option value="site">Сайт (.env)</option>
            <option value="bot">Telegram-бот (politempire_bots/.env)</option>
          </Select>
          <button
            type="button"
            onClick={saveEnv}
            disabled={envSaving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {envSaving ? "Сохранение…" : "Сохранить"}
          </button>
          </div>
        <TextArea
          className="min-h-64 font-mono text-xs"
          spellCheck={false}
          value={envContent}
          onChange={(e) => setEnvContent(e.target.value)}
        />
        {envMsg && <p className="mt-2 text-sm">{envMsg}</p>}
        <p className="mt-2 text-xs text-muted-foreground">
          Изменения вступают в силу после рестарта контейнера («Пересборка» / «Рестарт» ниже). Секреты
          (токены, пароли) видны только администраторам.
        </p>
      </Card>

      {/* ===== Docker ===== */}
      <Card>
        <h3 className="mb-3 text-lg font-semibold">Docker: контейнеры и логи</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadStatus}
            disabled={statusLoading}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            {statusLoading ? "Загрузка…" : "Статус"}
          </button>
          {services.map((svc) => (
            <div key={svc} className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{svc}</span>
              <button
                type="button"
                disabled={actionRunning === `restart:${svc}`}
                onClick={() => runAction("restart", svc)}
                className="rounded border border-border bg-card px-2 py-1 text-xs"
              >
                Рестарт
              </button>
              <button
                type="button"
                disabled={actionRunning === `rebuild:${svc}`}
                onClick={() => runAction("rebuild", svc)}
                className="rounded border border-border bg-card px-2 py-1 text-xs"
              >
                Пересборка
              </button>
            </div>
          ))}
        </div>
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-muted-foreground">
          {statusText || "Нажмите «Статус», чтобы увидеть список контейнеров."}
        </pre>
        {actionMsg && <p className="mt-2 text-sm">{actionMsg}</p>}
      </Card>

      {/* ===== Логи ===== */}
      <Card>
        <h3 className="mb-3 text-lg font-semibold">Логи</h3>
        <div className="mb-2 flex items-center gap-2">
          <Select value={logService} onChange={(e) => setLogService(e.target.value)} className="w-44">
            {services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={loadLogs}
            disabled={logLoading}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            {logLoading ? "Загрузка…" : "Обновить"}
          </button>
        </div>
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-muted-foreground">
          {logText || "Логи ещё не загружены."}
        </pre>
        {logMsg && <p className="mt-2 text-sm">{logMsg}</p>}
      </Card>
    </div>
  )
}