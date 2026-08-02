import Image from "next/image"
import Link from "next/link"
import { HeroBackground } from "@/components/hero-background"
import { ServerStatus } from "@/components/server-status"
import { AccountNavButton } from "@/components/account-nav-button"

const DISCORD_URL = "https://discord.gg/dqDx9qsQd9"
const TELEGRAM_URL = "https://t.me/politempire"
const TELEGRAM_BOT_URL = "https://t.me/polit_empire_bot"
const MAP_URL = "https://map.politempire.org"

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function MapIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" />
      <path d="M15 5.764v15" />
      <path d="M9 3.236v15" />
    </svg>
  )
}

export default function HomePage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex w-full items-center justify-between px-6 py-3 lg:px-10">
          <div className="flex items-center gap-3">
            <Image src="/images/emblem.png" alt="Герб Polit Empire" width={36} height={36} className="rounded" />
            <span className="font-mono text-lg font-bold tracking-tight">Polit Empire</span>
          </div>
          <nav className="flex items-center gap-1 md:gap-2">
            <a
              href="#download"
              className="hidden px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Скачать
            </a>
            <Link
              href="/donate"
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Донат
            </Link>
            <Link
              href="/rules"
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Правила
            </Link>
            <Link
              href="/forum"
              className="px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Форум
            </Link>
            <a
              href={MAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <MapIcon className="size-4" />
              Карта
            </a>
            <AccountNavButton />
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord сервера"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <DiscordIcon className="size-4" />
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram сервера"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
            >
              <TelegramIcon className="size-4" />
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-900/40 via-emerald-950/60 to-background">
        <HeroBackground />
        <div className="pe-fade-in relative mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-24 text-center md:py-32">
          <h1 className="max-w-3xl text-balance font-mono text-4xl font-bold leading-tight md:text-6xl">
            Военно-политический сервер Polit Empire
          </h1>
          <p className="max-w-2xl text-pretty leading-relaxed text-muted-foreground md:text-lg">
            Основывай государства, заключай союзы, объявляй войны и веди дипломатию. Сервер на версии 1.21.1 с
            собственной сборкой модов: техника, оружие, экономика и политика. Вход — только через официальный лаунчер.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/download"
              className="rounded-md bg-primary px-6 py-3 font-mono text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Скачать лаунчер
            </Link>
            <a
              href={MAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md border border-border px-6 py-3 font-mono text-sm text-foreground transition-colors hover:border-primary"
            >
              <MapIcon className="size-4" />
              Онлайн-карта мира
            </a>
          </div>
          <div className="flex items-center gap-4">
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <DiscordIcon className="size-5" />
              Discord
            </a>
            <span className="text-border">·</span>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <TelegramIcon className="size-5" />
              Telegram
            </a>
          </div>
        </div>
      </section>

      {/* Server status */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="mb-10 text-center font-mono text-2xl font-bold md:text-3xl">Статус сервера</h2>
          <ServerStatus />
        </div>
      </section>

      {/* How to start */}
      <section id="how" className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="mb-10 text-center font-mono text-2xl font-bold md:text-3xl">Как начать играть</h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Зарегистрируйся в боте",
                text: (
                  <>
                    Открой нашего{" "}
                    <a
                      href={TELEGRAM_BOT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline underline-offset-4 transition-opacity hover:opacity-80"
                    >
                      Telegram-бота
                    </a>
                    , придумай ник и пароль — аккаунт готов за минуту.
                  </>
                ),
              },
              {
                step: "02",
                title: "Скачай и установи лаунчер",
                text: "Скачай установщик лаунчера Polit Empire и пройди быструю установку — ярлык появится на рабочем столе.",
              },
              {
                step: "03",
                title: "Войди и играй",
                text: "Введи ник и пароль в лаунчере — он сам скачает сборку 1.21.1, проверит файлы и запустит игру.",
              },
            ].map((item) => (
              <div key={item.step} className="rounded-lg border border-border bg-card p-6">
                <span className="font-mono text-sm text-primary">{item.step}</span>
                <h3 className="mb-2 mt-3 font-mono text-lg font-semibold">{item.title}</h3>
                <p className="leading-relaxed text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="mb-10 text-center font-mono text-2xl font-bold md:text-3xl">Что тебя ждёт</h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Государства и дипломатия",
                text: "Создавай страну, назначай министров, подписывай договоры и вступай в альянсы.",
              },
              {
                title: "Войны и техника",
                text: "Моды на оружие и технику: от стрелкового вооружения до бронетехники и артиллерии.",
              },
              {
                title: "Экономика",
                text: "Торговля между государствами, валюта, ресурсы и промышленность.",
              },
              {
                title: "Своя сборка 1.21.1",
                text: "Лаунчер сам качает и проверяет моды — никаких ручных установок и конфликтов версий.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-border bg-card p-6">
                <h3 className="mb-2 font-mono text-base font-semibold">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Community */}
      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center">
          <h2 className="font-mono text-2xl font-bold md:text-3xl">Присоединяйся к сообществу</h2>
          <p className="max-w-xl text-pretty leading-relaxed text-muted-foreground">
            Новости сервера, набор в государства, дипломатия и войны — всё обсуждается в Discord и Telegram.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-card px-6 py-3 font-mono text-sm transition-colors hover:border-primary"
            >
              <DiscordIcon className="size-5" />
              Discord-сервер
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-card px-6 py-3 font-mono text-sm transition-colors hover:border-primary"
            >
              <TelegramIcon className="size-5" />
              Telegram-канал
            </a>
            <a
              href={MAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-md border border-border bg-card px-6 py-3 font-mono text-sm transition-colors hover:border-primary"
            >
              <MapIcon className="size-5" />
              Карта
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 md:flex-row">
          <p className="text-sm text-muted-foreground">Polit Empire — военно-политический Minecraft-сервер · 1.21.1</p>
          <div className="flex items-center gap-4">
            <Link
              href="/rules"
              className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Правила
            </Link>
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <DiscordIcon className="size-4" />
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Telegram"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <TelegramIcon className="size-4" />
            </a>
            <a
              href={MAP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <MapIcon className="size-4" />
              Онлайн-карта
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
