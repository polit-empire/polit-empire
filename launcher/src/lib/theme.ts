/**
 * Темы оформления лаунчера — обычные и сезонные (праздничные).
 *
 * Палитра применяется через CSS-переменные (см. styles.css + tailwind.config.js,
 * цвета вида `rgb(var(--pe-*) / <alpha-value>)`):
 *   • BASE_THEMES — обычные темы, игрок переключает их в настройках;
 *   • SEASONS — праздничные темы, включаются автоматически по дате и
 *     временно накладываются поверх выбранной обычной темы.
 * applyActiveTheme() — единая точка применения (база + праздник поверх).
 * SeasonalOverlay рисует лёгкие падающие частицы (снег, тыквы и т.п.).
 *
 * Как добавить новый праздник: дописать элемент в массив SEASONS ниже —
 * палитру (RGB-триплеты «R G B»), приветствие, частицы и правило дат.
 * Как добавить обычную тему: дописать элемент в BASE_THEMES.
 */

export interface SeasonPalette {
  /** RGB-триплеты «R G B» для rgb(var(--pe-*) / alpha) из tailwind.config.js */
  background: string
  card: string
  border: string
  foreground: string
  muted: string
  primary: string
  "primary-dark": string
  danger: string
  /** Полный цвет подложки-градиента главного экрана (Shell). */
  tint: string
}

export interface SeasonTheme {
  id: string
  /** Название праздника (для title/подсказок). */
  title: string
  /** Приветствие в нижней панели главного экрана. */
  greeting: string
  /** Эмодзи рядом с логотипом в сайдбаре. */
  emoji: string
  /** Символы падающих частиц оверлея. */
  particles: string[]
  palette: SeasonPalette
  /** Активен ли праздник в указанную дату (локальное время игрока). */
  matches: (date: Date) => boolean
}

/** Палитра по умолчанию — те же значения, что в :root (styles.css). */
const DEFAULT_PALETTE: SeasonPalette = {
  background: "13 17 23",
  card: "22 27 34",
  border: "48 54 61",
  foreground: "230 237 243",
  muted: "139 148 158",
  primary: "63 185 80",
  "primary-dark": "46 160 67",
  danger: "248 81 73",
  tint: "rgba(2, 44, 34, 0.5)",
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
  // Юлианская дата -> григорианская: +13 дней (Date сам нормализует перенос).
  return new Date(year, month - 1, day + 13)
}

/** Пасхальная неделя: от Страстной пятницы до конца Светлой седмицы. */
function isEasterTime(date: Date): boolean {
  const easter = orthodoxEaster(date.getFullYear())
  const from = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2)
  const to = new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 7)
  return date >= from && date <= new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59)
}

export const SEASONS: SeasonTheme[] = [
  {
    id: "newyear",
    title: "Новый год",
    greeting: "🎄 С Новым годом и Рождеством!",
    emoji: "🎄",
    particles: ["❄", "❅", "❆", "✦"],
    palette: {
      ...DEFAULT_PALETTE,
      background: "11 15 26",
      card: "18 26 43",
      border: "44 58 86",
      foreground: "232 240 250",
      muted: "138 152 178",
      primary: "240 177 42", // праздничное золото
      "primary-dark": "214 148 18",
      tint: "rgba(30, 41, 82, 0.55)",
    },
    matches: (d) => inRange(d, [12, 15], [1, 14]),
  },
  {
    id: "halloween",
    title: "Хэллоуин",
    greeting: "🎃 Счастливого Хэллоуина!",
    emoji: "🎃",
    particles: ["🦇", "🍂", "🎃", "👻"],
    palette: {
      ...DEFAULT_PALETTE,
      background: "16 11 21",
      card: "26 18 34",
      border: "66 45 84",
      foreground: "240 233 245",
      muted: "160 143 178",
      primary: "255 137 51", // тыквенный оранжевый
      "primary-dark": "230 106 24",
      tint: "rgba(59, 7, 100, 0.45)",
    },
    matches: (d) => inRange(d, [10, 24], [11, 1]),
  },
  {
    id: "valentine",
    title: "День святого Валентина",
    greeting: "💝 С Днём всех влюблённых!",
    emoji: "💝",
    particles: ["💗", "💘", "💕"],
    palette: {
      ...DEFAULT_PALETTE,
      background: "24 13 19",
      card: "36 20 29",
      border: "82 45 62",
      foreground: "248 234 240",
      muted: "176 142 156",
      primary: "244 114 158",
      "primary-dark": "219 84 130",
      tint: "rgba(76, 5, 25, 0.45)",
    },
    matches: (d) => inRange(d, [2, 13], [2, 15]),
  },
  {
    id: "easter",
    title: "Пасха",
    greeting: "🐣 Светлой Пасхи!",
    emoji: "🐣",
    particles: ["🥚", "🐣", "🌷", "✿"],
    palette: {
      ...DEFAULT_PALETTE,
      background: "13 20 15",
      card: "21 31 24",
      border: "48 68 54",
      foreground: "232 243 234",
      muted: "142 160 146",
      primary: "122 205 132", // весенняя зелень
      "primary-dark": "90 176 102",
      tint: "rgba(22, 78, 45, 0.45)",
    },
    matches: isEasterTime,
  },
]

/** Активный праздник на дату (или null — обычное оформление). */
export function getCurrentSeason(now: Date = new Date()): SeasonTheme | null {
  return SEASONS.find((s) => s.matches(now)) ?? null
}

/* ================================================================== */
/* Обычные (не праздничные) темы оформления                            */
/* ================================================================== */

export interface BaseTheme {
  id: string
  /** Название темы для выбора в настройках. */
  title: string
  /** Короткое описание/подсказка. */
  hint: string
  palette: SeasonPalette
}

/**
 * Набор обычных тем, между которыми игрок переключается в настройках.
 * Выбранная тема применяется всегда; в праздники сезонная палитра
 * (SEASONS) временно накладывается поверх (см. applyActiveTheme).
 *
 * Первая тема — оформление по умолчанию (совпадает с :root в styles.css).
 */
export const BASE_THEMES: BaseTheme[] = [
  {
    id: "graphite",
    title: "Графит",
    hint: "классическая тёмно-зелёная",
    palette: { ...DEFAULT_PALETTE },
  },
  {
    id: "midnight",
    title: "Полночь",
    hint: "сине-фиолетовая тёмная",
    palette: {
      background: "12 15 28",
      card: "20 25 44",
      border: "45 54 82",
      foreground: "228 233 246",
      muted: "132 143 173",
      primary: "124 138 255",
      "primary-dark": "96 110 235",
      danger: "248 113 113",
      tint: "rgba(30, 33, 82, 0.5)",
    },
  },
  {
    id: "ocean",
    title: "Океан",
    hint: "графит с бирюзовым акцентом",
    palette: {
      background: "10 20 24",
      card: "16 29 34",
      border: "38 58 64",
      foreground: "226 240 242",
      muted: "130 156 160",
      primary: "34 197 194",
      "primary-dark": "20 165 162",
      danger: "248 113 113",
      tint: "rgba(6, 58, 60, 0.5)",
    },
  },
  {
    id: "crimson",
    title: "Багровая",
    hint: "тёмная с красным акцентом",
    palette: {
      background: "20 12 14",
      card: "31 18 21",
      border: "66 40 45",
      foreground: "244 233 235",
      muted: "168 140 145",
      primary: "239 68 68",
      "primary-dark": "214 45 45",
      danger: "251 146 60",
      tint: "rgba(74, 16, 22, 0.5)",
    },
  },
  {
    id: "sandstone",
    title: "Песчаник",
    hint: "тёплая светлая тема",
    palette: {
      background: "245 242 235",
      card: "255 253 248",
      border: "214 208 196",
      foreground: "38 34 28",
      muted: "112 106 94",
      primary: "22 143 74",
      "primary-dark": "16 120 60",
      danger: "204 51 43",
      tint: "rgba(214, 224, 208, 0.6)",
    },
  },
]

/** Тема оформления по умолчанию (первая в списке). */
export const DEFAULT_BASE_THEME_ID = BASE_THEMES[0].id

const THEME_STORAGE_KEY = "pe-base-theme"

/** Возвращает базовую тему по id (или тему по умолчанию, если id неизвестен). */
export function getBaseTheme(id: string | null): BaseTheme {
  return BASE_THEMES.find((t) => t.id === id) ?? BASE_THEMES[0]
}

/** Читает id выбранной темы из localStorage (устойчиво к недоступности хранилища). */
export function loadBaseThemeId(): string {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_BASE_THEME_ID
  } catch {
    return DEFAULT_BASE_THEME_ID
  }
}

/** Сохраняет выбор темы в localStorage. */
export function saveBaseThemeId(id: string): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // localStorage недоступен — тема просто не запомнится между запусками.
  }
}

const PALETTE_KEYS: Array<keyof SeasonPalette> = [
  "background",
  "card",
  "border",
  "foreground",
  "muted",
  "primary",
  "primary-dark",
  "danger",
  "tint",
]

/** Записывает палитру в CSS-переменные документа (--pe-*). */
function applyPalette(palette: SeasonPalette): void {
  const root = document.documentElement
  for (const key of PALETTE_KEYS) {
    root.style.setProperty(`--pe-${key}`, palette[key])
  }
}

/**
 * Применяет к документу актуальную палитру: выбранную игроком базовую тему,
 * а в праздничные дни — сезонную палитру поверх неё. Возвращает активный
 * праздник (или null) — удобно для отрисовки частиц/приветствия.
 *
 * Вызывается при старте (App) и при смене темы в настройках. Единая точка
 * применения гарантирует, что базовая тема и праздник не конфликтуют:
 * праздник имеет приоритет в свои даты, в остальное время видна базовая тема.
 */
export function applyActiveTheme(baseThemeId: string = loadBaseThemeId()): SeasonTheme | null {
  const season = getCurrentSeason()
  applyPalette(season ? season.palette : getBaseTheme(baseThemeId).palette)
  return season
}
