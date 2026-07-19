/**
 * Database migration script for Polit Empire launcher backend.
 * Usage: node scripts/migrate.mjs   (reads .env / environment variables)
 *
 * - Adds missing columns to the existing `users` table
 * - Creates auth_codes, tg_sessions, telemetry, builds, launcher_versions tables
 */
import mysql from "mysql2/promise"
import fs from "fs"
import path from "path"

// Naive .env loader (no extra deps)
const envPath = path.join(process.cwd(), ".env")
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
})

console.log("Connected to MySQL:", process.env.MYSQL_HOST)

// --- users table: create if missing, then add new columns idempotently ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS users (
    minecraft_nick VARCHAR(32) NOT NULL PRIMARY KEY,
    password_hash  VARCHAR(255) NULL,
    is_banned      TINYINT(1) NOT NULL DEFAULT 0,
    ban_reason     VARCHAR(512) NULL,
    api_token      VARCHAR(64) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)

async function addColumnIfMissing(table, column, ddl) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.MYSQL_DATABASE, table, column]
  )
  if (rows[0].c === 0) {
    console.log(`Adding column ${table}.${column}`)
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`)
  }
}

await addColumnIfMissing("users", "telegram_id", "telegram_id BIGINT NULL")
await addColumnIfMissing("users", "created_at", "created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP")
await addColumnIfMissing("users", "last_login", "last_login TIMESTAMP NULL")

// Index for api_token lookups
const [idx] = await conn.query(
  `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_api_token'`,
  [process.env.MYSQL_DATABASE]
)
if (idx[0].c === 0) {
  await conn.query(`CREATE INDEX idx_users_api_token ON users (api_token)`)
}

// --- one-time login codes (created by launcher "start", confirmed by bot) ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS auth_codes (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    code           VARCHAR(6) NOT NULL,
    minecraft_nick VARCHAR(32) NULL,
    telegram_id    BIGINT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'pending',
    token          VARCHAR(64) NULL,
    expires_at     TIMESTAMP NOT NULL,
    used           TINYINT(1) NOT NULL DEFAULT 0,
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auth_codes_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)
// Idempotent upgrades for databases created by an older version of this script
await addColumnIfMissing("auth_codes", "status", "status VARCHAR(16) NOT NULL DEFAULT 'pending'")
await addColumnIfMissing("auth_codes", "token", "token VARCHAR(64) NULL")
await conn.query(`ALTER TABLE auth_codes MODIFY minecraft_nick VARCHAR(32) NULL, MODIFY telegram_id BIGINT NULL`)

// --- Telegram bot conversation state ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS tg_sessions (
    chat_id      BIGINT NOT NULL PRIMARY KEY,
    state        VARCHAR(32) NOT NULL DEFAULT 'idle',
    pending_code VARCHAR(6) NULL,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)
await addColumnIfMissing("tg_sessions", "pending_code", "pending_code VARCHAR(6) NULL")
await addColumnIfMissing("tg_sessions", "temp_nick", "temp_nick VARCHAR(32) NULL")

// --- telemetry events ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS telemetry (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    event_type       VARCHAR(64) NOT NULL,
    minecraft_nick   VARCHAR(32) NULL,
    launcher_version VARCHAR(32) NULL,
    os               VARCHAR(64) NULL,
    java_version     VARCHAR(64) NULL,
    message          TEXT NULL,
    created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_telemetry_created (created_at),
    INDEX idx_telemetry_event (event_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)

// --- build (modpack) history; manifest stored as JSON ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS builds (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(128) NOT NULL,
    manifest   LONGTEXT NOT NULL,
    file_count INT NOT NULL DEFAULT 0,
    total_size BIGINT NOT NULL DEFAULT 0,
    is_active  TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)

// --- admin notifications (e.g. new player registered) ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS notifications (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    type       VARCHAR(32) NOT NULL DEFAULT 'info',
    title      VARCHAR(255) NOT NULL,
    body       VARCHAR(512) NULL,
    is_read    TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_read (is_read),
    INDEX idx_notifications_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)

// --- launcher binary versions ---
await conn.query(`
  CREATE TABLE IF NOT EXISTS launcher_versions (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    version    VARCHAR(32) NOT NULL,
    changelog  TEXT NULL,
    file_name  VARCHAR(255) NOT NULL,
    file_size  BIGINT NOT NULL DEFAULT 0,
    is_active  TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)

console.log("Migration complete.")
await conn.end()
