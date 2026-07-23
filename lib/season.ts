/**
 * Сезонные (праздничные) темы сайта — зеркало тем лаунчера
 * (launcher/src/lib/theme.ts), адаптированное под токены shadcn/Tailwind v4
 * из app/globals.css (:root, формат oklch).
 *
 * SeasonalTheme (components/seasonal-theme.tsx) применяет палитру через
 * переопределение CSS-переменных на <html> и рисует падающие частицы.
 *
 * Как добавить праздник: дописать элемент в массив SEASONS — правило дат,
 * cssVars-переопределения и символы частиц. Больше ничего менять не нужно.
 */

export interface SeasonTheme {
  id: string
  /** Название праздника (для title/подсказок). */
  title: string
  emoji: string
  /** Символы падающих частиц оверлея. */
  particles: string[]
  /** Переопределения CSS-переменных из :root (globals.css), формат oklch. */
  cssVars: Record<string, string>
  /** Активен ли праздник в указанную дату (локальное время посетителя). */
  matches: (date: Date) => boolean
}

/**
 * Попадает ли дата в диапазон [from .. to] включительно (месяцы 1-12).
 * Диапазон может переходить через Новый год (например, 15.12 — 14.01).
 */
function inRange(date: Date, from: [number, number], to: [number, number]): boolean {
  const v = (date.getMonth() + 1) * 100 + date.getDate()
  const a = from[0] * 100 + from[1]
  const b = to[0] * 100 + to[1]
  return a <= b ? v >= a && v <= b : v >= a || v <= b
}

/**
 * Дата православной Пасхи по григорианскому календарю (алгоритм Меёса для
 * юлианской Пасхи + сдвиг на 13 дней; верен для 1900–2099 годов).
 */
export function orthodoxEaster(year: number): Date {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const month = Math.floor((d + e + 114) / 31) // 3 = март, 4 = апрель (юлианские)
  const day = ((d + e + 114) % 31) + 1
  return new Date(year, month - 1, day + 13)
}

/** Пасхальная неделя: от Страстной пятницы до конца Светлой седмицы. */
function isEasterTime(date: Date): boolean {
  const easter = orthodoxEaster(date.getFullYear())
  const from = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2)
  const to = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 7, 23, 59, 59)
  return date >= from && date <= to
}

export const SEASONS: SeasonTheme[] = [
  {
    id: 'newyear',
    title: 'Новый год',
    emoji: '🎄',
    particles: ['❄', '❅', '❆', '✦'],
    // Зимняя ночь: тёмно-синий фон, золотые акценты.
    cssVars: {
      background: 'oklch(0.16 0.03 262)',
      card: 'oklch(0.2 0.035 262)',
      popover: 'oklch(0.2 0.035 262)',
      secondary: 'oklch(0.25 0.032 262)',
      muted: 'oklch(0.25 0.032 262)',
      primary: 'oklch(0.78 0.13 85)',
      'primary-foreground': 'oklch(0.2 0.05 85)',
      accent: 'oklch(0.68 0.12 85)',
      'accent-foreground': 'oklch(0.98 0.005 85)',
      ring: 'oklch(0.78 0.13 85)',
      'chart-1': 'oklch(0.78 0.13 85)',
      'chart-2': 'oklch(0.68 0.12 85)',
      sidebar: 'oklch(0.14 0.028 262)',
      'sidebar-primary': 'oklch(0.78 0.13 85)',
      'sidebar-primary-foreground': 'oklch(0.2 0.05 85)',
      'sidebar-accent': 'oklch(0.23 0.03 262)',
      'sidebar-ring': 'oklch(0.78 0.13 85)',
    },
    matches: (d) => inRange(d, [12, 15], [1, 14]),
  },
  {
    id: 'halloween',
    title: 'Хэллоуин',
    emoji: '🎃',
    particles: ['🦇', '🍂', '🎃', '👻'],
    // Тёмный фиолет + тыквенный оранжевый.
    cssVars: {
      background: 'oklch(0.16 0.03 315)',
      card: 'oklch(0.2 0.04 315)',
      popover: 'oklch(0.2 0.04 315)',
      secondary: 'oklch(0.25 0.04 315)',
      muted: 'oklch(0.25 0.04 315)',
      primary: 'oklch(0.72 0.17 55)',
      'primary-foreground': 'oklch(0.18 0.05 55)',
      accent: 'oklch(0.62 0.15 55)',
      'accent-foreground': 'oklch(0.98 0.005 55)',
      ring: 'oklch(0.72 0.17 55)',
      'chart-1': 'oklch(0.72 0.17 55)',
      'chart-2': 'oklch(0.62 0.15 55)',
      sidebar: 'oklch(0.14 0.027 315)',
      'sidebar-primary': 'oklch(0.72 0.17 55)',
      'sidebar-primary-foreground': 'oklch(0.18 0.05 55)',
      'sidebar-accent': 'oklch(0.23 0.035 315)',
      'sidebar-ring': 'oklch(0.72 0.17 55)',
    },
    matches: (d) => inRange(d, [10, 24], [11, 1]),
  },
  {
    id: 'valentine',
    title: 'День святого Валентина',
    emoji: '💝',
    particles: ['💗', '💘', '💕'],
    // Тёмная роза + розовые акценты.
    cssVars: {
      background: 'oklch(0.17 0.03 355)',
      card: 'oklch(0.21 0.04 355)',
      popover: 'oklch(0.21 0.04 355)',
      secondary: 'oklch(0.26 0.038 355)',
      muted: 'oklch(0.26 0.038 355)',
      primary: 'oklch(0.71 0.16 5)',
      'primary-foreground': 'oklch(0.18 0.05 5)',
      accent: 'oklch(0.63 0.14 5)',
      'accent-foreground': 'oklch(0.98 0.005 5)',
      ring: 'oklch(0.71 0.16 5)',
      'chart-1': 'oklch(0.71 0.16 5)',
      'chart-2': 'oklch(0.63 0.14 5)',
      sidebar: 'oklch(0.15 0.028 355)',
      'sidebar-primary': 'oklch(0.71 0.16 5)',
      'sidebar-primary-foreground': 'oklch(0.18 0.05 5)',
      'sidebar-accent': 'oklch(0.24 0.035 355)',
      'sidebar-ring': 'oklch(0.71 0.16 5)',
    },
    matches: (d) => inRange(d, [2, 13], [2, 15]),
  },
  {
    id: 'easter',
    title: 'Пасха',
    emoji: '🐣',
    particles: ['🥚', '🐣', '🌷', '✿'],
    // Весенняя зелень + сиреневый акцент.
    cssVars: {
      background: 'oklch(0.18 0.02 145)',
      card: 'oklch(0.22 0.024 145)',
      popover: 'oklch(0.22 0.024 145)',
      secondary: 'oklch(0.27 0.026 145)',
      muted: 'oklch(0.27 0.026 145)',
      primary: 'oklch(0.76 0.15 145)',
      'primary-foreground': 'oklch(0.19 0.05 145)',
      accent: 'oklch(0.7 0.11 310)',
      'accent-foreground': 'oklch(0.98 0.005 310)',
      ring: 'oklch(0.76 0.15 145)',
      'chart-1': 'oklch(0.76 0.15 145)',
      'chart-2': 'oklch(0.7 0.11 310)',
      sidebar: 'oklch(0.16 0.018 145)',
      'sidebar-primary': 'oklch(0.76 0.15 145)',
      'sidebar-primary-foreground': 'oklch(0.19 0.05 145)',
      'sidebar-accent': 'oklch(0.25 0.024 145)',
      'sidebar-ring': 'oklch(0.76 0.15 145)',
    },
    matches: isEasterTime,
  },
]

/** Активный праздник на дату (или null — обычное оформление). */
export function getCurrentSeason(now: Date = new Date()): SeasonTheme | null {
  return SEASONS.find((s) => s.matches(now)) ?? null
}

/**
 * Применяет палитру темы: переопределяет CSS-переменные :root на <html>.
 * null — сброс к значениям по умолчанию из globals.css.
 * Безопасна на сервере (без document ничего не делает).
 */
export function applySeasonTheme(theme: SeasonTheme | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  // Сбрасываем переопределения всех сезонов, затем ставим текущие.
  const allKeys = new Set<string>()
  for (const season of SEASONS) {
    for (const key of Object.keys(season.cssVars)) allKeys.add(key)
  }
  for (const key of allKeys) root.style.removeProperty(`--${key}`)
  if (theme) {
    for (const [key, value] of Object.entries(theme.cssVars)) {
      root.style.setProperty(`--${key}`, value)
    }
  }
}
