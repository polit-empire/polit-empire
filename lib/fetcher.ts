/** Общий fetcher для SWR: JSON GET с бросанием ошибки на не-2xx. */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin" })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    const err = new Error(body.error || `Ошибка ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

/** Отправить JSON произвольным методом; бросает Error(message) на ошибку. */
export async function sendJson<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error((data.error as string) || `Ошибка ${res.status}`)
  }
  return data as T
}

/** POST JSON и вернуть распарсенный ответ; бросает Error(message) на ошибку. */
export async function postJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  return sendJson<T>(url, "POST", body)
}
