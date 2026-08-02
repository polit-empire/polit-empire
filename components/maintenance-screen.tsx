export function MaintenanceScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="max-w-md rounded-2xl border border-border bg-background p-8 shadow-lg">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-yellow-500/10 text-3xl">
          🛠️
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Технические работы</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {message?.trim()
            ? message
            : "Сервер временно недоступен. Мы проводим технические работы — скоро всё восстановится. Загляните чуть позже."}
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          Администраторы могут зайти в личный кабинет и продолжить работу.
        </p>
      </div>
    </div>
  )
}