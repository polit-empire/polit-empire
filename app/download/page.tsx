import Link from "next/link"
import Image from "next/image"

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  )
}

function LinuxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M11.668 1.48C9.539 1.482 7.78 3.518 7.78 6.16c0 1.954.912 3.655 2.146 4.382l-.845 2.502c-1.396.16-3.23.95-4.27 2.174-1.256 1.482-1.764 3.791-2.002 5.068C3.109 20.316 2.217 21 2.217 21h4.48c1.378-1.576 3.037-3.15 5.303-3.15 2.266 0 3.923 1.574 5.302 3.15h4.482s-.892-.684-.592-2.714c-.238-1.277-.745-3.586-2-5.068-1.04-1.225-2.872-2.013-4.268-2.174l-.845-2.502c1.233-.727 2.146-2.428 2.146-4.382 0-2.642-1.76-4.678-3.889-4.68m0 2.219c1.077 0 1.97.947 1.97 2.455s-.893 2.455-1.97 2.455c-1.077 0-1.97-.947-1.97-2.455s.893-2.455 1.97-2.455" />
    </svg>
  )
}

export default function DownloadPage() {
  return (
    <main className="min-h-svh bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
            <Image src="/images/emblem.png" alt="Герб Polit Empire" width={32} height={32} className="rounded" />
            <span className="font-mono text-base font-bold tracking-tight">Polit Empire</span>
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            На главную
          </Link>
        </div>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center p-4">
        <div className="w-full max-w-xl text-center">
          <h1 className="mb-4 font-mono text-3xl font-bold md:text-4xl">Скачать лаунчер</h1>
          <p className="mb-10 text-muted-foreground text-balance">
            Выберите платформу для скачивания официального лаунчера сервера. Он автоматически загрузит и проверит нужную сборку 1.21.1.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <a
              href="/api/launcher/download?ext=exe"
              className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary md:col-span-2"
            >
              <WindowsIcon className="size-10 text-primary" />
              <div className="text-center">
                <h3 className="font-mono font-semibold">Скачать для Windows</h3>
                <span className="text-xs text-muted-foreground">.exe установщик (Windows 10/11)</span>
              </div>
            </a>

            <div className="md:col-span-2 flex items-center gap-4 py-4">
              <div className="flex-1 border-t border-border" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Версии для Linux</span>
              <div className="flex-1 border-t border-border" />
            </div>

            <a
              href="/api/launcher/download?ext=AppImage"
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground"
            >
              <LinuxIcon className="size-6 text-foreground" />
              <div className="text-center">
                <h3 className="font-mono text-sm font-semibold">AppImage</h3>
                <span className="text-xs text-muted-foreground">Универсальный пакет</span>
              </div>
            </a>

            <a
              href="/api/launcher/download?ext=deb"
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground"
            >
              <LinuxIcon className="size-6 text-foreground" />
              <div className="text-center">
                <h3 className="font-mono text-sm font-semibold">Debian / Ubuntu</h3>
                <span className="text-xs text-muted-foreground">.deb пакет</span>
              </div>
            </a>

            <a
              href="/api/launcher/download?ext=rpm"
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground md:col-span-2 md:w-1/2 md:mx-auto"
            >
              <LinuxIcon className="size-6 text-foreground" />
              <div className="text-center">
                <h3 className="font-mono text-sm font-semibold">Fedora / Red Hat</h3>
                <span className="text-xs text-muted-foreground">.rpm пакет</span>
              </div>
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
