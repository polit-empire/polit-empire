import { useEffect, useMemo } from "react"
import { applyActiveTheme, getCurrentSeason } from "./lib/theme"

/**
 * Праздничные частицы лаунчера: рисует поверх интерфейса лёгкие падающие
 * символы (снежинки, тыквы и т.п.), когда активен праздник (см. SEASONS).
 * Палитру (обычную тему + сезонную поверх) применяет applyActiveTheme —
 * здесь только повторно синхронизируем её на маунте (тема уже применена
 * синхронно в main.tsx до рендера).
 *
 * Слой не перехватывает клики (pointer-events-none), а при
 * prefers-reduced-motion частицы скрываются (см. styles.css).
 */

interface Particle {
  symbol: string
  leftPct: number
  sizePx: number
  durationS: number
  delayS: number
  driftPx: number
  opacity: number
}

/** Детерминированный псевдорандом: одинаковая «метель» между перерисовками. */
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

const PARTICLE_COUNT = 16

export default function SeasonalOverlay() {
  const season = useMemo(() => getCurrentSeason(), [])

  useEffect(() => {
    applyActiveTheme()
  }, [])

  const particles = useMemo<Particle[]>(() => {
    if (!season) return []
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      symbol: season.particles[i % season.particles.length],
      leftPct: seeded(i, 1) * 100,
      sizePx: 10 + Math.round(seeded(i, 2) * 10),
      durationS: 10 + seeded(i, 3) * 10,
      delayS: -seeded(i, 4) * 20, // отрицательная задержка — частицы уже «в пути»
      driftPx: Math.round(seeded(i, 5) * 120 - 60),
      opacity: 0.25 + seeded(i, 6) * 0.3,
    }))
  }, [season])

  if (!season) return null

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {particles.map((p, i) => (
        <span
          key={i}
          className="pe-flake"
          style={{
            left: `${p.leftPct}%`,
            fontSize: `${p.sizePx}px`,
            opacity: p.opacity,
            animationDuration: `${p.durationS}s`,
            animationDelay: `${p.delayS}s`,
            ["--pe-drift" as string]: `${p.driftPx}px`,
          }}
        >
          {p.symbol}
        </span>
      ))}
    </div>
  )
}
