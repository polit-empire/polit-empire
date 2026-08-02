import type { ReactNode } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"

/**
 * Мини-рендерер Discord-markdown в React-элементы (без dangerouslySetInnerHTML).
 * Поддерживает: **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~,
 * `код`, ```блоки кода```, # заголовки, - списки, > цитаты,
 * [текст](url) — кликабельные ссылки как в Discord.
 *
 * Вырезается полностью (не показывается в лаунчере):
 * кастомные эмодзи <:name:id>, спойлеры ||текст||,
 * упоминания <@id> / <@&id> / <#id> / @everyone / @here.
 */

/** Убирает Discord-специфичный мусор, который не должен попадать в лаунчер. */
function sanitize(raw: string): string {
  return (
    raw
      // Спойлеры ||текст|| — скрываем целиком
      .replace(/\|\|[\s\S]*?\|\|/g, "")
      // Кастомные эмодзи <:name:id> и анимированные <a:name:id>
      .replace(/<a?:\w+:\d+>/g, "")
      // Упоминания пользователей/ролей/каналов
      .replace(/<@[!&]?\d+>/g, "")
      .replace(/<#\d+>/g, "")
      // @everyone / @here
      .replace(/@(everyone|here)/g, "")
      // Хвостовые пробелы и лишние пустые строки после чистки
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

function open(url: string) {
  openUrl(url).catch(() => {})
}

// Инлайн-токены в порядке приоритета: [текст](url) → жирный → подчёркнутый →
// курсив → зачёркнутый → код → голая ссылка
const INLINE_RE =
  /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*(.+?)\*\*)|(__(.+?)__)|(\*(.+?)\*)|(_(.+?)_)|(~~(.+?)~~)|(`([^`]+?)`)|(https?:\/\/[^\s<>]+)/

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  let i = 0
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest)
    if (!m || m.index === undefined) {
      nodes.push(rest)
      break
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1]) {
      // [текст](url) — как в Discord: виден текст, клик открывает ссылку
      const url = m[3]
      nodes.push(
        <a
          key={key}
          href={url}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            open(url)
          }}
          className="cursor-pointer text-primary hover:underline"
          title={url}
        >
          {renderInline(m[2], key)}
        </a>,
      )
    } else if (m[4]) {
      nodes.push(<strong key={key}>{renderInline(m[5], key)}</strong>)
    } else if (m[6]) {
      nodes.push(
        <span key={key} className="underline">
          {renderInline(m[7], key)}
        </span>,
      )
    } else if (m[8]) {
      nodes.push(<em key={key}>{renderInline(m[9], key)}</em>)
    } else if (m[10]) {
      nodes.push(<em key={key}>{renderInline(m[11], key)}</em>)
    } else if (m[12]) {
      nodes.push(
        <span key={key} className="line-through opacity-70">
          {renderInline(m[13], key)}
        </span>,
      )
    } else if (m[14]) {
      nodes.push(
        <code key={key} className="rounded bg-card px-1 py-0.5 font-mono text-[0.9em]">
          {m[15]}
        </code>,
      )
    } else if (m[16]) {
      const url = m[16]
      nodes.push(
        <a
          key={key}
          href={url}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            open(url)
          }}
          className="cursor-pointer break-all text-primary hover:underline"
        >
          {url}
        </a>,
      )
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return nodes
}

export function DiscordMarkdown({ content }: { content: string }) {
  const blocks: ReactNode[] = []
  // Сначала выделяем блоки кода ```...```
  const parts = sanitize(content).split(/```(?:[a-z]*\n)?/)
  let key = 0

  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      // Внутри блока кода
      blocks.push(
        <pre
          key={`cb-${key++}`}
          className="overflow-x-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed"
        >
          {part.replace(/\n$/, "")}
        </pre>,
      )
      return
    }
    // Обычный текст: построчно
    const lines = part.split("\n")
    let listBuffer: string[] = []

    const flushList = () => {
      if (listBuffer.length === 0) return
      blocks.push(
        <ul key={`ul-${key++}`} className="flex list-disc flex-col gap-1 pl-5">
          {listBuffer.map((li, j) => (
            <li key={j}>{renderInline(li, `li-${key}-${j}`)}</li>
          ))}
        </ul>,
      )
      listBuffer = []
    }

    lines.forEach((line) => {
      const trimmed = line.trim()
      if (/^[-*] +/.test(trimmed)) {
        listBuffer.push(trimmed.replace(/^[-*] +/, ""))
        return
      }
      flushList()
      if (trimmed === "") return

      const h = /^(#{1,3}) +(.*)$/.exec(trimmed)
      if (h) {
        const level = h[1].length
        const cls =
          level === 1
            ? "text-lg font-bold text-foreground"
            : level === 2
              ? "text-base font-bold text-foreground"
              : "text-sm font-semibold text-foreground"
        blocks.push(
          <p key={`h-${key++}`} className={cls}>
            {renderInline(h[2], `h-${key}`)}
          </p>,
        )
        return
      }
      if (trimmed.startsWith("> ")) {
        blocks.push(
          <blockquote
            key={`q-${key++}`}
            className="border-l-2 border-primary/50 pl-3 text-muted"
          >
            {renderInline(trimmed.slice(2), `q-${key}`)}
          </blockquote>,
        )
        return
      }
      blocks.push(<p key={`p-${key++}`}>{renderInline(line, `p-${key}`)}</p>)
    })
    flushList()
  })

  return <div className="flex flex-col gap-1.5 text-sm leading-relaxed">{blocks}</div>
}
