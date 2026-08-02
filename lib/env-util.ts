/**
 * Строки .env-файла и утилиты для их UI-отображения.
 * Этот модуль НЕ должен импортировать node-библиотеки — он используется и
 * серверными маршрутами, и клиентским компонентом админ-панели.
 */

export type EnvLine = { kind: "kv"; key: string; value: string } | { kind: "raw"; text: string }

/** Разбирает .env в упорядоченный список строк (порядок сохраняется). */
export function parseEnv(content: string): EnvLine[] {
  const out: EnvLine[] = []
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m) out.push({ kind: "kv", key: m[1], value: m[2] })
    else out.push({ kind: "raw", text: line })
  }
  return out
}

/** Эвристика «секрет» для UI: показываем скрытым (type=password). */
export function isSecretKey(key: string): boolean {
  return /(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|WEBHOOK|RCON|DATABASE_URL|DISCORD|DONATE|MOD_ADMIN)/i.test(key)
}