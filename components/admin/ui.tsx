"use client"

import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react"
import { cn } from "@/lib/utils"

/** Общие стили полей для админ-панели (в проекте нет shadcn input/select). */

const fieldBase =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-20 resize-y", className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, className)} {...props}>
      {children}
    </select>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-lg border border-border bg-card p-4", className)}>{children}</div>
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    paid: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    canceled: "bg-muted text-muted-foreground",
  }
  const labels: Record<string, string> = {
    pending: "ожидает",
    paid: "оплачен",
    delivered: "выдан",
    canceled: "отменён",
  }
  return (
    <span className={cn("inline-block rounded px-2 py-0.5 text-xs font-medium", map[status] ?? "bg-muted")}>
      {labels[status] ?? status}
    </span>
  )
}
