/**
 * Next.js instrumentation hook: runs once at server startup.
 * Automatically applies the database schema migration, so no manual
 * `node scripts/migrate.mjs` is needed inside the Docker container.
 */
function setupCrashHandler() {
  const seen = new WeakSet()
  const handler = (err: unknown) => {
    if (
      err instanceof TypeError &&
      (err as NodeJS.ErrnoException).code === "ERR_INVALID_STATE" &&
      err.message.includes("ReadableStream")
    ) {
      if (!seen.has(err)) {
        seen.add(err)
        console.error("[crash-handler] подавлен ReadableStream error (Node undici bug):", err.message)
      }
      return
    }
    console.error("[crash-handler] uncaught exception:", err)
  }
  process.on("uncaughtException", handler)
  process.on("unhandledRejection", handler)
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    setupCrashHandler()
    const { ensureSchema } = await import("./lib/schema")
    void ensureSchema()
  }
}
