/**
 * Next.js instrumentation hook: runs once at server startup.
 * Automatically applies the database schema migration, so no manual
 * `node scripts/migrate.mjs` is needed inside the Docker container.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchema } = await import("./lib/schema")
    // Fire-and-forget with internal retries; do not block server startup.
    void ensureSchema()
  }
}
