import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Правила сервера — Polit Empire",
  description:
    "Основные правила и правила общения военно-политического Minecraft-сервера Polit Empire. Ознакомьтесь перед игрой и общением в сообществе.",
}

const DISCORD_URL = "https://discord.gg/dqDx9qsQd9"
const TELEGRAM_URL = "https://t.me/politempire"

type Rule = {
  id: string
  text: string
  list?: string[]
  listOutro?: string
  punishment?: string
}

type Section = {
  icon: string
  title: string
  rules: Rule[]
}

const sections: Section[] = [
  {
    icon: "📜",
    title: "Основные правила сервера",
    rules: [
      {
        id: "1.1",
        text: "Наш сервер следует правилам Discord Terms of Service и Discord Community Guidelines. Каждый участник, присоединившись, подтверждает согласие с ними и обязуется соблюдать данные правила.",
      },
      {
        id: "1.2",
        text: "Незнание правил не освобождает от ответственности. Администрация имеет право вносить изменения и дополнения в любое время. Наказание определяется по усмотрению модератора.",
      },
      {
        id: "1.3",
        text: "Все правила, установленные для текстовых чатов, распространяются также на ветки, голосовые чаты и демонстрацию экрана. Наказания за нарушения в голосовых каналах применяются только при наличии видео- или фото-доказательств.",
      },
      {
        id: "1.4",
        text: "Запрещено распространять вредоносные файлы, программы и ссылки.",
        punishment: "бан от 1 дня до перманентного.",
      },
      {
        id: "1.5",
        text: "Любые действия, наносящие вред серверу, строго запрещены.",
        punishment: "мут до 12 часов / бан до 7 дней / перманентный бан.",
      },
      {
        id: "1.6",
        text: "Реклама и упоминание сторонних серверов или проектов, не связанных с Polit, запрещены. Также нельзя демонстрировать экран, где присутствует подобная информация.",
        punishment: "мут до 12 часов / бан до 14 дней / перманентный бан.",
      },
      {
        id: "1.7",
        text: "Никнеймы, аватары, статусы и описания не должны:",
        list: [
          "копировать других пользователей или администрацию;",
          "содержать личные данные;",
          "включать технические или вводящие в заблуждение слова (Helper, Admin и т.п.);",
          "содержать оскорбления, пропаганду, рекламу или неприемлемый контент.",
        ],
        punishment: "устное предупреждение / варн / кик / перманентный бан.",
      },
      {
        id: "1.8",
        text: "Запрещены любые теги, статусы или роли, связанные с:",
        list: [
          "политическими, националистическими, военными или радикальными организациями;",
          "контентом сексуального, насильственного, оскорбительного характера;",
          "символикой или идеологиями, вызывающими споры.",
        ],
        listOutro: "Провокационные или замаскированные теги также считаются нарушением.",
        punishment: "устное предупреждение / варн / кик / перманентный бан.",
      },
    ],
  },
  {
    icon: "💬",
    title: "Правила общения в чате",
    rules: [
      {
        id: "2.1",
        text: "Запрещается:",
        list: [
          "флуд, капс (от 3 слов), транслит, оффтоп, мультипост, спам эмодзи, GIF или бот-командами;",
          "угрозы, оскорбления, троллинг, попрошайничество, распространение дезинформации;",
          "использование SoundPad и других помех в голосовых каналах;",
          "NSFW/порнографический контент, QR-коды, чрезмерная нецензурная лексика.",
        ],
        listOutro: "Ненормативная лексика допускается в умеренных количествах.",
        punishment: "мут до 6 часов / бан до 5 дней / перманентный бан.",
      },
      {
        id: "2.2",
        text: "Любые проявления неуважения, критики или провокации в адрес Команды проекта или самого проекта Polit запрещены. В случае конфликта — обращайтесь к Куратору проекта или подавайте жалобу.",
        punishment: "мут от 20 минут / бан до 7 дней / перманентный бан.",
      },
      {
        id: "2.3",
        text: "Не допускается злоупотребление упоминаниями (пингами) и ссылками без причины. Применяется также к Команде проекта, если участник был против упоминания.",
        punishment: "мут до 6 часов.",
      },
      {
        id: "2.4",
        text: "Запрещена любая коммерческая деятельность — продажа, обмен, покупка или предоставление услуг за реальные деньги.",
        punishment: "мут до 5 часов / бан до 7 дней / перманентный бан.",
      },
    ],
  },
]

export default function RulesPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/images/emblem.png" alt="Герб Polit Empire" width={36} height={36} className="rounded" />
            <span className="font-mono text-lg font-bold tracking-tight">Polit Empire</span>
          </Link>
          <Link
            href="/"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← На главную
          </Link>
        </div>
      </header>

      {/* Title */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center">
          <h1 className="text-balance font-mono text-3xl font-bold md:text-4xl">Правила сервера</h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
            Ознакомьтесь с правилами перед игрой и общением в сообществе. Незнание правил не освобождает от
            ответственности.
          </p>
        </div>
      </section>

      {/* Rules */}
      <div className="mx-auto max-w-4xl px-4 py-12">
        {sections.map((section) => (
          <section key={section.title} className="mb-14 last:mb-0">
            <h2 className="mb-6 flex items-center gap-3 font-mono text-2xl font-bold">
              <span aria-hidden="true">{section.icon}</span>
              {section.title}
            </h2>
            <div className="flex flex-col gap-4">
              {section.rules.map((rule) => (
                <article key={rule.id} className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-baseline gap-3">
                    <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-sm font-semibold text-primary">
                      {rule.id}
                    </span>
                    <p className="leading-relaxed text-foreground">{rule.text}</p>
                  </div>

                  {rule.list && (
                    <ul className="mt-3 flex flex-col gap-1.5 pl-9">
                      {rule.list.map((item, i) => (
                        <li key={i} className="flex gap-2 leading-relaxed text-muted-foreground">
                          <span className="text-primary" aria-hidden="true">
                            ›
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {rule.listOutro && <p className="mt-3 pl-9 leading-relaxed text-muted-foreground">{rule.listOutro}</p>}

                  {rule.punishment && (
                    <p className="mt-3 pl-9 text-sm leading-relaxed">
                      <span className="font-mono font-semibold text-destructive">Наказание: </span>
                      <span className="text-muted-foreground">{rule.punishment}</span>
                    </p>
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 px-4 py-8 text-center md:flex-row md:text-left">
          <p className="text-sm text-muted-foreground">
            Вопросы по правилам? Обращайтесь к администрации в наших сообществах.
          </p>
          <div className="flex items-center gap-4">
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Discord
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Telegram
            </a>
          </div>
        </div>
      </footer>
    </main>
  )
}
