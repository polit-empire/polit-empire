"use client"

import useSWR from "swr"

interface McStatus {
  online: boolean
  players: number
  max: number
  sample: { name: string; id: string }[]
  version?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<McStatus>)

/** Голова игрока — кроп лица (8,8) из нашего скина + слой шапки (40,8). */
function PlayerHead({ name, size = 44 }: { name: string; size?: number }) {
  const scale = size / 8
  const skin = `/api/skins/${encodeURIComponent(name)}.png`
  const layer = (posX: number, posY: number): React.CSSProperties => ({
    position: "absolute",
    inset: 0,
    backgroundImage: `url(${skin})`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${64 * scale}px auto`,
    backgroundPosition: `-${posX * scale}px -${posY * scale}px`,
    imageRendering: "pixelated",
  })
  return (
    <div
      className="relative overflow-hidden rounded-md bg-muted ring-1 ring-border"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* лицо */}
      <div style={layer(8, 8)} />
      {/* шапка (overlay) поверх */}
      <div style={layer(40, 8)} />
    </div>
  )
}

export function ServerStatus() {
  const { data, isLoading } = useSWR<McStatus>("/api/mc-status", fetcher, {
    refreshInterval: 180_000,
    revalidateOnFocus: true,
  })

  const online = data?.online ?? false
  const players = data?.players ?? 0
  const max = data?.max ?? 0
  const sample = data?.sample ?? []
  // Из строки версии («Paper 1.21.1», «Requires 1.21.1» и т.п.) берём только
  // сам номер версии, чтобы не показывать имя ядра/сервера.
  const versionNumber = data?.version?.match(/\d+(?:\.\d+)+/)?.[0]

  return (
    <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card p-6 md:p-8">
      {/* Заголовок статуса */}
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="relative flex size-3">
            {online && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            )}
            <span
              className={`relative inline-flex size-3 rounded-full ${online ? "bg-primary" : "bg-destructive"}`}
            />
          </span>
          <div>
            <p className="font-mono text-lg font-bold">
              {isLoading ? "Проверяем сервер…" : online ? "Сервер онлайн" : "Сервер офлайн"}
            </p>
            {versionNumber && <p className="text-xs text-muted-foreground">Версия {versionNumber}</p>}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background px-4 py-2 text-center">
          <span className="font-mono text-2xl font-bold text-primary">{players}</span>
          <span className="font-mono text-sm text-muted-foreground"> / {max}</span>
          <p className="text-xs text-muted-foreground">игроков онлайн</p>
        </div>
      </div>

      {/* Список игроков */}
      {online && (
        <div className="mt-6 border-t border-border pt-6">
          {sample.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-4">
              {sample.map((p) => (
                <div key={p.name} className="flex w-16 flex-col items-center gap-1.5">
                  <PlayerHead name={p.name} />
                  <span className="w-full truncate text-center font-mono text-xs text-muted-foreground" title={p.name}>
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              {players > 0 ? "Список игроков сейчас скрыт." : "Сейчас на сервере никого нет — будь первым!"}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
