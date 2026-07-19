import { NextResponse } from "next/server"
import { getSetting } from "@/lib/donate"
import { getAdminUser } from "@/lib/admin"
import { processDonatelloDonation } from "@/lib/donatello"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/cron/donatello
 * Синхронизирует платежи Donatello: получает последние донаты через API,
 * извлекает код заказа из комментария, сверяет сумму и автоматически
 * начисляет DC через deliverOrder. Один donation_id обрабатывается ровно
 * один раз (уникальный индекс в donatello_payments).
 *
 * Авторизация:
 *  - `Authorization: Bearer $CRON_SECRET` — Vercel Cron
 *  - авторизованный администратор — ручной запуск из панели
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  const cronSecret = process.env.CRON_SECRET

  let authorized = false
  if (cronSecret && token === cronSecret) {
    authorized = true
  } else {
    const admin = await getAdminUser()
    if (admin) authorized = true
  }
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const enabled = (await getSetting("donatello_enabled", "0")) === "1"
  if (!enabled) {
    return NextResponse.json({ ok: true, message: "Donatello отключён" })
  }

  const apiToken = await getSetting("donatello_api_token", "")
  const apiBase = (await getSetting("donatello_api_base", "")).replace(/\/$/, "")
  const pageSize = Number(await getSetting("donatello_page_size", "50"))
  if (!apiToken || !apiBase) {
    return NextResponse.json({ ok: true, message: "Donatello API не настроен" })
  }

  let processed = 0
  let skipped = 0
  let failed = 0
  const newPayments: Array<{ donation_id: string; order_id: number | null; status: string }> = []

  const debug = new URL(request.url).searchParams.get("debug") === "1"

  try {
    // Получаем последние донаты через Donatello API (v1).
    // Согласно докам: GET /donates?page=0&size=N, авторизация ТОЛЬКО заголовком
    // X-Token. Лишний Authorization: Bearer вызывал ошибку (502).
    const url = `${apiBase}/donates?page=0&size=${pageSize}`
    const res = await fetch(url, {
      headers: {
        "X-Token": apiToken,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(25_000),
    })
    const rawText = await res.text()
    if (!res.ok) {
      console.error("[donatello] API returned", res.status, rawText)
      return NextResponse.json(
        { error: "Donatello API unavailable", status: res.status, body: debug ? rawText.slice(0, 2000) : undefined },
        { status: 502 },
      )
    }

    let body: unknown
    try {
      body = JSON.parse(rawText)
    } catch {
      console.error("[donatello] non-JSON response:", rawText.slice(0, 500))
      return NextResponse.json(
        { error: "Donatello вернул не JSON", body: debug ? rawText.slice(0, 2000) : undefined },
        { status: 502 },
      )
    }

    // По докам список лежит в поле `content`. Оставляем запасные варианты на
    // случай изменения схемы, но приоритет — content.
    const b = body as Record<string, unknown>
    const donates = (
      Array.isArray(body) ? body : (b.content ?? b.data ?? b.donates ?? [])
    ) as Array<Record<string, unknown>>

    // debug=1 — возвращаем сырой первый элемент, чтобы увидеть реальные поля.
    if (debug) {
      return NextResponse.json({
        ok: true,
        debug: true,
        count: donates.length,
        sample: donates[0] ?? null,
        keys: donates[0] ? Object.keys(donates[0]) : [],
      })
    }

    if (donates.length === 0) {
      return NextResponse.json({ ok: true, message: "Нет новых донатов", processed: 0, skipped: 0 })
    }

    // Обрабатываем донаты от старых к новым (реверс, т.к. Donatello отдаёт свежие первыми).
    for (const donate of donates.slice().reverse()) {
      // Поля по докам Donatello: pubId, clientName, message, amount (строка),
      // currency, createdAt. amount приходит строкой ("100") — приводим к числу.
      const result = await processDonatelloDonation({
        donationId: String(donate.pubId ?? donate.pub_id ?? donate.id ?? ""),
        message: String(donate.message ?? donate.clientComment ?? ""),
        amountUah: Number(donate.amount ?? 0),
        currency: String(donate.currency ?? "UAH").toUpperCase(),
        donorName: (donate.clientName ?? null) as string | null,
      })

      if (result.status === "processed") processed++
      else if (result.status === "invalid_currency" || result.status === "insufficient_amount" || result.status === "deliver_failed") failed++
      else skipped++

      if (result.status !== "already") {
        newPayments.push({ donation_id: String(donate.pubId ?? donate.pub_id ?? donate.id ?? ""), order_id: result.orderId, status: result.status })
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      skipped,
      failed,
      total: donates.length,
      payments: newPayments,
    })
  } catch (err) {
    console.error("[donatello] cron error:", err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
