import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"

interface OptionalMod {
  file: string
  title: string
  description: string
  enabled: boolean
}

export default function ModsTab() {
  const [mods, setMods] = useState<OptionalMod[] | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    invoke<OptionalMod[]>("get_optional_mods")
      .then(setMods)
      .catch((e) => setError(String(e)))
  }, [])

  const toggle = async (file: string) => {
    if (!mods || saving) return
    const next = mods.map((m) => (m.file === file ? { ...m, enabled: !m.enabled } : m))
    setMods(next)
    setSaving(true)
    try {
      await invoke("set_optional_mods", {
        enabled: next.filter((m) => m.enabled).map((m) => m.file),
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-xl font-bold">Моды</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Дополнительные моды сборки. Изменения применяются при следующем запуске игры.
        </p>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {mods === null && !error && (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card/40" />
          ))}
        </div>
      )}

      {mods !== null && mods.length === 0 && (
        <div className="rounded-lg border border-border bg-card/60 p-6 text-center">
          <p className="text-sm text-muted">Для этой сборки нет опциональных модов</p>
        </div>
      )}

      {mods !== null && mods.length > 0 && (
        <div className="flex flex-col gap-3">
          {mods.map((mod) => (
            <button
              key={mod.file}
              onClick={() => toggle(mod.file)}
              className={`flex items-center gap-4 rounded-lg border p-4 text-left transition-colors ${
                mod.enabled
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card/60 hover:border-primary/30"
              }`}
              aria-pressed={mod.enabled}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
                  mod.enabled ? "border-primary bg-primary text-background" : "border-border"
                }`}
                aria-hidden="true"
              >
                {mod.enabled && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="size-3.5">
                    <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{mod.title}</span>
                {mod.description && (
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{mod.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
