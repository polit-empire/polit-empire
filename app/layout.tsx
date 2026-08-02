import { Analytics } from '@vercel/analytics/next'
import { headers } from 'next/headers'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { SeasonalTheme } from '@/components/seasonal-theme'
import { MaintenanceScreen } from '@/components/maintenance-screen'
import { getMaintenanceState } from '@/lib/maintenance'
import { getSessionUser } from '@/lib/session'
import { isAdminUser } from '@/lib/admin'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const SITE_URL = (
  process.env.SITE_URL ||
  process.env.PUBLIC_BASE_URL ||
  'https://politempire.ru'
).replace(/\/+$/, '')

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Polit Empire — военно-политический Minecraft-сервер 1.21.1',
    template: '%s — Polit Empire',
  },
  description:
    'Военно-политический Minecraft-сервер с модами на 1.21.1: государства, войны, дипломатия, армия и экономика. Скачай официальный лаунчер и присоединяйся к политической войне.',
  keywords: [
    'военно-политический сервер',
    'военно-политический майнкрафт сервер',
    'политический майнкрафт сервер',
    'майнкрафт сервер с модами',
    'minecraft сервер 1.21.1',
    'сервер с государствами',
    'сервер с войнами',
    'политика в майнкрафте',
    'дипломатия',
    'экономика',
    'кланы и войны',
    'PolitEmpire',
    'Polit Empire',
    'политемпайр',
    'donate сервер minecraft',
  ],
  applicationName: 'Polit Empire',
  authors: [{ name: 'Polit Empire' }],
  category: 'games',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    url: SITE_URL,
    siteName: 'Polit Empire',
    title: 'Polit Empire — военно-политический Minecraft-сервер 1.21.1',
    description:
      'Военно-политический Minecraft-сервер с модами на 1.21.1: государства, войны, дипломатия, армия и экономика. Скачай лаунчер и присоединяйся.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Polit Empire — военно-политический Minecraft-сервер 1.21.1',
    description:
      'Государства, войны, дипломатия и экономика на Minecraft 1.21.1. Скачай официальный лаунчер и играй.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0d1117',
}

// Структурированные данные (Schema.org) — помогают поисковикам понять,
// что это игровой проект, и показывать расширенный сниппет.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'Polit Empire',
      description:
        'Военно-политический Minecraft-сервер с модами на 1.21.1: государства, войны, дипломатия, армия и экономика.',
      inLanguage: 'ru-RU',
    },
    {
      '@type': 'VideoGame',
      name: 'Polit Empire — военно-политический Minecraft-сервер',
      url: SITE_URL,
      description:
        'Военно-политический Minecraft-сервер 1.21.1: создавай государства, веди войны, занимайся дипломатией и экономикой.',
      inLanguage: 'ru-RU',
      genre: ['Военно-политический', 'MMO', 'Стратегия', 'Roleplay'],
      gamePlatform: ['Minecraft Java Edition 1.21.1', 'PC'],
      keywords:
        'военно-политический сервер, политический майнкрафт сервер, сервер с государствами и войнами, minecraft 1.21.1',
    },
  ],
}

export const dynamic = "force-dynamic"

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
// Шлюз технических работ: при включённых техработах посетителям показывается
  // заглушка, а админам («заходить могут только админы» — ADMIN_NICKS /
  // ADMIN_TELEGRAM_IDS / bot_admins) сайт доступен. Исключения — страница входа
  // (/account), чтобы администратор мог войти и выключить режим, и страница
  // загрузки лаунчера (/download).
  const maintenance = await getMaintenanceState()
  const maintenanceGated = maintenance.enabled && (await isMaintenanceBlocked())

  return (
    <html lang="ru" className={`${geistSans.variable} ${geistMono.variable} bg-background`}>
      <body className="font-sans antialiased">
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Праздничное оформление: сезонная палитра + падающие частицы
            (Новый год, Хэллоуин, Пасха, 14 февраля — см. lib/season.ts). */}
        <SeasonalTheme />
        {maintenanceGated ? <MaintenanceScreen message={maintenance.message} /> : children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

async function isMaintenanceBlocked(): Promise<boolean> {
  try {
    const pathname = (await headers()).get('x-pe-path') ?? ''
    if (pathname === '/account' || pathname.startsWith('/account/') || pathname === '/download' || pathname.startsWith('/download/')) {
      return false
    }
    const user = await getSessionUser()
    if (user && (await isAdminUser(user))) return false
    return true
  } catch {
    return true
  }
}
