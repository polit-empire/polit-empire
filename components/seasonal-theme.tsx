'use client'

import { useEffect, useMemo, useState } from 'react'
import { applySeasonTheme, getCurrentSeason, type SeasonTheme } from '@/lib/season'

/**
 * Праздничное оформление сайта: в праздники (Новый год, Хэллоуин, Пасха,
 * 14 февраля — см. lib/season.ts) переопределяет палитру (CSS-переменные
 * shadcn из globals.css) и рисует поверх страницы лёгкие падающие частицы.
 *
 * Монтируется один раз в app/layout.tsx, поэтому действует на всех страницах.
 * Слой частиц не перехватывает клики (pointer-events-none) и полностью
 * скрывается при prefers-reduced-motion (см. globals.css). Тема применяется
 * после гидратации (useEffect) — на серверном HTML остаётся обычная палитра,
 * что исключает расхождения при гидратации.
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

/** Детерминированный псевдорандом: одинаковые частицы между перерисовками. */
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

const PARTICLE_COUNT = 14

export function SeasonalTheme() {
  // Сезон определяем только на клиенте (после mount): сервер не знает локальное
  // время посетителя, а несовпадение серверного и клиентского рендера дало бы
  // ошибку гидратации.
  const [season, setSeason] = useState<SeasonTheme | null>(null)

  useEffect(() => {
    const current = getCurrentSeason()
    setSeason(current)
    applySeasonTheme(current)
  }, [])

  const particles = useMemo<Particle[]>(() => {
    if (!season) return []
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      symbol: season.particles[i % season.particles.length],
      leftPct: seeded(i, 1) * 100,
      sizePx: 12 + Math.round(seeded(i, 2) * 10),
      durationS: 11 + seeded(i, 3) * 10,
      delayS: -seeded(i, 4) * 20, // отрицательная задержка — частицы уже «в пути»
      driftPx: Math.round(seeded(i, 5) * 140 - 70),
      opacity: 0.2 + seeded(i, 6) * 0.25,
    }))
  }, [season])

  if (!season) return null

  return (
    <div
      aria-hidden="true"
      title={season.title}
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
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
            ['--pe-drift' as string]: `${p.driftPx}px`,
          }}
        >
          {p.symbol}
        </span>
      ))}
    </div>
  )
}
