import { getRawDb as getDb } from "./db"

/**
 * Idempotent schema migration, executed automatically at server startup
 * (see instrumentation.ts). Mirrors scripts/migrate.mjs so the Docker
 * standalone image does not need node_modules for external scripts.
 */

async function addColumnIfMissing(table: string, column: string, ddl: string) {
  const db = getDb()
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [process.env.MYSQL_DATABASE, table, column],
  )
  const c = (rows as Array<{ c: number }>)[0]?.c ?? 0
  if (c === 0) {
    console.log(`[migrate] Adding column ${table}.${column}`)
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`)
  }
}

async function runMigration() {
  const db = getDb()

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      minecraft_nick VARCHAR(32) NOT NULL PRIMARY KEY,
      password_hash  VARCHAR(255) NULL,
      is_banned      TINYINT(1) NOT NULL DEFAULT 0,
      ban_reason     VARCHAR(512) NULL,
      api_token      VARCHAR(64) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await addColumnIfMissing("users", "telegram_id", "telegram_id BIGINT NULL")
  await addColumnIfMissing("users", "created_at", "created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP")
  await addColumnIfMissing("users", "last_login", "last_login TIMESTAMP NULL")
  await addColumnIfMissing("users", "last_hwid", "last_hwid VARCHAR(64) NULL")
  await addColumnIfMissing("users", "last_ip", "last_ip VARCHAR(45) NULL")
  // Античит: счётчик попыток инжекта и id последней «засчитанной» сессии
  await addColumnIfMissing("users", "ac_strikes", "ac_strikes INT NOT NULL DEFAULT 0")
  await addColumnIfMissing("users", "ac_last_session", "ac_last_session VARCHAR(64) NULL")
  await addColumnIfMissing("users", "ac_last_strike", "ac_last_strike TIMESTAMP NULL")

  // Баны по железу: HWID устройства, с которого запрещён вход
  await db.query(`
    CREATE TABLE IF NOT EXISTS banned_hwids (
      hwid        VARCHAR(64) NOT NULL PRIMARY KEY,
      mc_username VARCHAR(32) NULL,
      reason      VARCHAR(512) NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Баны по UUID игрока (offline-UUID Minecraft, детерминирован по нику)
  await db.query(`
    CREATE TABLE IF NOT EXISTS banned_uuids (
      uuid        VARCHAR(64) NOT NULL PRIMARY KEY,
      mc_username VARCHAR(32) NULL,
      reason      VARCHAR(512) NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Баны по IP-адресу
  await db.query(`
    CREATE TABLE IF NOT EXISTS banned_ips (
      ip          VARCHAR(45) NOT NULL PRIMARY KEY,
      mc_username VARCHAR(32) NULL,
      reason      VARCHAR(512) NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  const [idx] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_api_token'`,
    [process.env.MYSQL_DATABASE],
  )
  if (((idx as Array<{ c: number }>)[0]?.c ?? 0) === 0) {
    await db.query(`CREATE INDEX idx_users_api_token ON users (api_token)`)
  }

  await db.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await addColumnIfMissing("auth_codes", "status", "status VARCHAR(16) NOT NULL DEFAULT 'pending'")
  await addColumnIfMissing("auth_codes", "token", "token VARCHAR(64) NULL")
  await db.query(`ALTER TABLE auth_codes MODIFY minecraft_nick VARCHAR(32) NULL, MODIFY telegram_id BIGINT NULL`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS tg_sessions (
      chat_id      BIGINT NOT NULL PRIMARY KEY,
      state        VARCHAR(32) NOT NULL DEFAULT 'idle',
      pending_code VARCHAR(6) NULL,
      updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  await addColumnIfMissing("tg_sessions", "pending_code", "pending_code VARCHAR(6) NULL")
  await addColumnIfMissing("tg_sessions", "temp_nick", "temp_nick VARCHAR(32) NULL")

  await db.query(`
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Живой статус лаунчера у игрока: обновляется heartbeat'ом каждые ~30с.
  // status: 'idle' (лаунчер открыт) | 'playing' (игра запущена).
  // «Лаунчер запущен» = last_seen свежее порога (см. /api/admin/players).
  await db.query(`
    CREATE TABLE IF NOT EXISTS launcher_heartbeats (
      minecraft_nick   VARCHAR(32) NOT NULL PRIMARY KEY,
      status           VARCHAR(16) NOT NULL DEFAULT 'idle',
      launcher_version VARCHAR(32) NULL,
      os               VARCHAR(64) NULL,
      last_seen        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_hb_seen (last_seen)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Активные игровые сессии. Таблицу ведёт Telegram-бот (плагин сервера шлёт
  // join/quit), но создаём её идемпотентно и здесь, чтобы JOIN в админке
  // работал даже до первого запуска бота. Определение совпадает с ботом.
  await db.query(`
    CREATE TABLE IF NOT EXISTS bot_play_sessions (
      mc_username VARCHAR(80) NOT NULL PRIMARY KEY,
      joined_at   DATETIME NOT NULL,
      ip          VARCHAR(45) DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Live-логи игры/лаунчера у игрока (строки stdout/stderr процесса игры).
  // Хранилище скользящее: старые строки чистятся при вставке (см. /logs).
  await db.query(`
    CREATE TABLE IF NOT EXISTS launcher_logs (
      id             BIGINT AUTO_INCREMENT PRIMARY KEY,
      minecraft_nick VARCHAR(32) NOT NULL,
      session        VARCHAR(64) NULL,
      level          VARCHAR(16) NOT NULL DEFAULT 'info',
      source         VARCHAR(16) NOT NULL DEFAULT 'game',
      line           VARCHAR(2048) NOT NULL,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_logs_nick_id (minecraft_nick, id),
      INDEX idx_logs_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS builds (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(128) NOT NULL,
      manifest   LONGTEXT NOT NULL,
      file_count INT NOT NULL DEFAULT 0,
      total_size BIGINT NOT NULL DEFAULT 0,
      is_active  TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      type       VARCHAR(32) NOT NULL DEFAULT 'info',
      title      VARCHAR(255) NOT NULL,
      body       VARCHAR(512) NULL,
      is_read    TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_read (is_read),
      INDEX idx_notifications_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // События античита, присланные лаунчером (DLL + внешние проверки).
  // Discord-бот забирает необработанные строки и постит их в канал.
  await db.query(`
    CREATE TABLE IF NOT EXISTS anticheat_events (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      minecraft_nick VARCHAR(32) NULL,
      hwid           VARCHAR(64) NULL,
      kind           VARCHAR(64) NOT NULL,
      detail         VARCHAR(1024) NULL,
      source         VARCHAR(32) NOT NULL DEFAULT 'dll',
      posted         TINYINT(1) NOT NULL DEFAULT 0,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_anticheat_posted (posted),
      INDEX idx_anticheat_created (created_at),
      INDEX idx_anticheat_nick (minecraft_nick)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Журнал действий администраторов (аудит). Пишется из /api/admin/action и
  // других админ-эндпоинтов через logAdminAction (lib/audit.ts). Показывает
  // абсолютно все действия: баны, кики, смена ника/пароля, выдача/списание DC
  // и привилегий, удаление аккаунтов, точечные баны по HWID/UUID/IP.
  //  • admin_nick  — кто сделал действие
  //  • action      — машинное имя действия (ban, unban, give_dc, set_nick, ...)
  //  • target_nick — над кем действие (может быть NULL для value-банов)
  //  • detail      — человекочитаемое описание (что именно изменилось)
  //  • ip          — IP администратора на момент действия
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_logs (
      id          BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_nick  VARCHAR(32) NOT NULL,
      action      VARCHAR(48) NOT NULL,
      target_nick VARCHAR(32) NULL,
      detail      VARCHAR(1024) NULL,
      ip          VARCHAR(45) NULL,
      created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admin_logs_created (created_at),
      INDEX idx_admin_logs_admin (admin_nick),
      INDEX idx_admin_logs_target (target_nick),
      INDEX idx_admin_logs_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Журнал событий аккаунтов (не-админские). Пишется через logAccountEvent
  // (lib/audit.ts). Показывает вход в лаунчер и в личный кабинет; регистрации
  // при этом берутся напрямую из users.created_at (создаются Telegram-ботом).
  //  • event_type       — launcher_login | web_login | register (на будущее)
  //  • minecraft_nick   — чей аккаунт
  //  • ip / hwid         — откуда вошли (если известно)
  //  • launcher_version — версия лаунчера (из User-Agent), для launcher_login
  await db.query(`
    CREATE TABLE IF NOT EXISTS account_events (
      id               BIGINT AUTO_INCREMENT PRIMARY KEY,
      event_type       VARCHAR(32) NOT NULL,
      minecraft_nick   VARCHAR(32) NULL,
      ip               VARCHAR(45) NULL,
      hwid             VARCHAR(64) NULL,
      launcher_version VARCHAR(32) NULL,
      detail           VARCHAR(512) NULL,
      created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_acct_events_created (created_at),
      INDEX idx_acct_events_type (event_type),
      INDEX idx_acct_events_nick (minecraft_nick)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Тикеты поддержки. Игрок создаёт тикет в личном кабинете, админ отвечает
  // в админ-панели. status: open (ждёт ответа админа) | answered (админ
  // ответил, ждём игрока) | closed (закрыт). last_message_at — для сортировки
  // по свежести переписки.
  await db.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      minecraft_nick  VARCHAR(32) NOT NULL,
      subject         VARCHAR(160) NOT NULL,
      status          VARCHAR(16) NOT NULL DEFAULT 'open',
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_message_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tickets_nick (minecraft_nick),
      INDEX idx_tickets_status (status),
      INDEX idx_tickets_last (last_message_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Сообщения тикета (переписка игрока и админов). is_admin=1 — сообщение от
  // администрации. Скриншот (необязательный) хранится файлом на диске
  // ({STORAGE_DIR}/ticket-attachments/{id}.{ext}); в БД — только тип и
  // расширение (attachment_mime/attachment_ext), сам файл отдаётся через
  // /api/support/attachment/[id] с проверкой доступа.
  await db.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id       INT NOT NULL,
      author_nick     VARCHAR(32) NOT NULL,
      is_admin        TINYINT(1) NOT NULL DEFAULT 0,
      body            TEXT NULL,
      attachment_mime VARCHAR(32) NULL,
      attachment_ext  VARCHAR(8) NULL,
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_messages_ticket (ticket_id, id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS launcher_versions (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      version    VARCHAR(32) NOT NULL,
      changelog  TEXT NULL,
      file_name  VARCHAR(255) NOT NULL,
      file_size  BIGINT NOT NULL DEFAULT 0,
      is_active  TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Белый список SHA-256 официальных сборок лаунчера (self-integrity).
  // Лаунчер на старте хеширует собственный .exe и присылает хеш на /verify.
  // Если в таблице есть хотя бы одна активная запись, а присланный хеш в ней
  // не найден — сервер не даёт запустить игру (модифицированный лаунчер).
  // Пустая таблица = проверка выключена (fail-open), чтобы не блокировать
  // игроков до того, как эталонный хеш будет зарегистрирован при релизе.
  //  • sha256  — 64 hex-символа, нижний регистр
  //  • version — версия сборки, к которой относится хеш (для нескольких ОС/сборок
  //    одной версии может быть несколько строк)
  //  • label   — произвольная пометка (например "win-x64 1.0.3")
  await db.query(`
    CREATE TABLE IF NOT EXISTS launcher_hashes (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      sha256     CHAR(64) NOT NULL,
      version    VARCHAR(32) NULL,
      label      VARCHAR(128) NULL,
      is_active  TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_launcher_hash (sha256),
      INDEX idx_launcher_hash_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Веб-сессии личного кабинета (вход по нику+паролю, как в лаунчере).
  // token — sha256 от cookie-значения, сам cookie игроку не хранится в БД.
  await db.query(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      token          CHAR(64) NOT NULL PRIMARY KEY,
      minecraft_nick VARCHAR(32) NOT NULL,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at     TIMESTAMP NOT NULL,
      INDEX idx_web_sessions_nick (minecraft_nick),
      INDEX idx_web_sessions_exp (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Настройки магазина (реквизиты оплаты, бонусы) — редактируются в админке.
  await db.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      skey       VARCHAR(64) NOT NULL PRIMARY KEY,
      svalue     TEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Товары доната: привилегии (kind='privilege') и пакеты DC (kind='dc').
  // rcon_command — шаблон выдачи с плейсхолдерами {nick} {group} {days} {amount}.
  await db.query(`
    CREATE TABLE IF NOT EXISTS donate_products (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      kind          VARCHAR(16) NOT NULL DEFAULT 'privilege',
      name          VARCHAR(64) NOT NULL,
      description   VARCHAR(1024) NULL,
      price_rub     INT NOT NULL DEFAULT 0,
      group_name    VARCHAR(64) NULL,
      duration_days INT NOT NULL DEFAULT 30,
      dc_amount     INT NOT NULL DEFAULT 0,
      rcon_command  VARCHAR(512) NULL,
      accent        VARCHAR(16) NOT NULL DEFAULT 'emerald',
      sort_order    INT NOT NULL DEFAULT 0,
      is_active     TINYINT(1) NOT NULL DEFAULT 1,
      created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Иконка товара для игрового мода: id предмета Minecraft (например
  // "minecraft:diamond") — мод рисует его в GUI магазина/корзины. Также
  // теперь kind может быть 'item' — предмет, выдаваемый в игру за DC.
  await addColumnIfMissing("donate_products", "icon_item", "icon_item VARCHAR(64) NULL")

  // Заказы: покупка привилегии/DC. method: crypto|easydonate|dc|admin.
  // status: pending|paid|delivered|canceled.
  await db.query(`
    CREATE TABLE IF NOT EXISTS donate_orders (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      minecraft_nick VARCHAR(32) NOT NULL,
      product_id     INT NULL,
      kind           VARCHAR(16) NOT NULL,
      title          VARCHAR(128) NOT NULL,
      amount_rub     INT NOT NULL DEFAULT 0,
      dc_amount      INT NOT NULL DEFAULT 0,
      method         VARCHAR(16) NOT NULL,
      status         VARCHAR(16) NOT NULL DEFAULT 'pending',
      payment_ref    VARCHAR(191) NULL,
      pay_url        VARCHAR(512) NULL,
      note           VARCHAR(512) NULL,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at        TIMESTAMP NULL,
      delivered_at   TIMESTAMP NULL,
      INDEX idx_orders_nick (minecraft_nick),
      INDEX idx_orders_status (status),
      INDEX idx_orders_ref (payment_ref)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Полученные донаты Donatello. donation_id уникален, поэтому повторный
  // cron-запрос никогда не начислит один и тот же платёж дважды.
  await db.query(`
    CREATE TABLE IF NOT EXISTS donatello_payments (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      donation_id    VARCHAR(191) NOT NULL UNIQUE,
      order_id       INT NULL,
      amount_uah     DECIMAL(12,2) NOT NULL DEFAULT 0,
      currency       VARCHAR(12) NOT NULL DEFAULT 'UAH',
      donor_name     VARCHAR(191) NULL,
      message        TEXT NULL,
      status         VARCHAR(32) NOT NULL,
      error_message  VARCHAR(512) NULL,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at   TIMESTAMP NULL,
      INDEX idx_donatello_order (order_id),
      INDEX idx_donatello_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Журнал голосований на мониторингах. Одна строка = один засчитанный голос
  // (с начислением бонуса). Используется для проверки кулдауна (нельзя голосовать
  // на одном мониторинге чаще, чем раз в vote_cooldown_hours) и для истории в ЛК.
  await db.query(`
    CREATE TABLE IF NOT EXISTS vote_log (
      id             BIGINT AUTO_INCREMENT PRIMARY KEY,
      minecraft_nick VARCHAR(32) NOT NULL,
      site_id        VARCHAR(64) NOT NULL,
      site_name      VARCHAR(128) NULL,
      bonus          INT NOT NULL DEFAULT 0,
      ip             VARCHAR(45) NULL,
      created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vote_nick (minecraft_nick),
      INDEX idx_vote_site (site_id),
      INDEX idx_vote_nick_site (minecraft_nick, site_id),
      INDEX idx_vote_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Активные привилегии игроков (для отображения в ЛК и продления).
  await db.query(`
    CREATE TABLE IF NOT EXISTS donate_privileges (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      minecraft_nick VARCHAR(32) NOT NULL,
      group_name     VARCHAR(64) NOT NULL,
      product_id     INT NULL,
      order_id       INT NULL,
      granted_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at     TIMESTAMP NULL,
      INDEX idx_priv_nick (minecraft_nick),
      INDEX idx_priv_exp (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Промокоды: скидки при покупке товаров.
  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      code            VARCHAR(32) NOT NULL,
      discount_type   VARCHAR(16) NOT NULL DEFAULT 'percent',
      discount_value  INT NOT NULL DEFAULT 0,
      max_uses        INT NOT NULL DEFAULT 0,
      used_count      INT NOT NULL DEFAULT 0,
      min_amount_rub  INT NOT NULL DEFAULT 0,
      product_ids     TEXT NULL,
      expires_at      TIMESTAMP NULL,
      is_active       TINYINT(1) NOT NULL DEFAULT 1,
      created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_promo_code (code),
      INDEX idx_promo_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // Использование промокодов: каждый игрок может использовать промокод столько
  // раз, сколько допускает max_uses (0 = без ограничений на игрока).
  await db.query(`
    CREATE TABLE IF NOT EXISTS promo_code_usage (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      promo_id        INT NOT NULL,
      minecraft_nick  VARCHAR(32) NOT NULL,
      order_id        INT NULL,
      used_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_promo_usage_promo (promo_id),
      INDEX idx_promo_usage_nick (minecraft_nick)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)

  // --- Сиды настроек по умолчанию (не перезаписывают существующие) ---
  const defaultSettings: Array<[string, string]> = [
    ["privilege_rcon_template", "lp user {nick} parent addtemp {group} {days}d"],
    ["dc_rcon_template", "dc give {nick} {amount}"],
    ["dc_bonus_threshold", "250"],
    ["dc_bonus_percent", "10"],
    // MyDonate: редирект на витрину магазина (оплата + выдача DC в игре на их
    // стороне). Указывается только адрес витрины; включается в админке.
    ["mydonate_enabled", "0"],
    ["mydonate_shop_url", "https://politempireshop.mydonate.io"],
    // EasyDonate. Ключ магазина — секрет, задаётся в .env (EASYDONATE_SHOP_KEY)
    // или в админке; в код не коммитим. server_id / product_id не секретны.
    ["easydonate_enabled", "1"],
    ["easydonate_shop_key", ""],
    ["easydonate_server_id", "138850"],
    ["easydonate_dc_product_id", "1097608"],
    ["easydonate_email", "shop@politempire.ru"],
    // Donatello: 1 гривна = 1 DC. Токен и страницу задаёт администратор.
    ["donatello_enabled", "0"],
    ["donatello_page_url", ""],
    ["donatello_api_token", ""],
    ["donatello_api_base", "https://donatello.to/api/v1"],
    ["donatello_page_size", "50"],
    // Секретный ключ для колбэков Donatello (заголовок X-Key). Мгновенное
    // начисление в реальном времени, задаётся администратором.
    ["donatello_callback_key", ""],
    // Игровой мод (NeoForge). mod_admin_key — секрет для серверных команд /dc
    // (выдача/списание DC). Задаётся администратором и прописывается в конфиге
    // мода на игровом сервере. Пустой ключ = команды /dc отключены.
    ["mod_admin_key", ""],
    // Шаблон команды выдачи предмета (kind='item'), плейсхолдеры {nick} {amount}.
    ["item_rcon_template", "give {nick} {item} {count}"],
    // Бонусы за голос на мониторингах.
    //  • vote_sites — JSON-массив мониторингов [{id,name,url,bonus}]
    //  • vote_cooldown_hours — как часто можно получать бонус за один мониторинг
    //  • vote_callback_key — секрет, который мониторинг передаёт в колбэке
    ["vote_sites", "[]"],
    ["vote_cooldown_hours", "24"],
    ["vote_callback_key", ""],
  ]
  for (const [k, v] of defaultSettings) {
    await db.query("INSERT IGNORE INTO site_settings (skey, svalue) VALUES (?, ?)", [k, v])
  }

  // --- Сиды товаров по умолчанию (только если таблица пуста) ---
  const [cntRows] = await db.query("SELECT COUNT(*) AS c FROM donate_products")
  const productCount = (cntRows as Array<{ c: number }>)[0]?.c ?? 0
  if (productCount === 0) {
    console.log("[migrate] Seeding default donate products")
    const tmpl = "lp user {nick} parent addtemp {group} {days}d"
    const privileges: Array<[string, string, number, string, string]> = [
      ["Солдат", "Базовая привилегия: цветной ник, /kit soldier, доступ к /hat.", 150, "soldat", "sky"],
      ["Сержант", "Расширенные команды, /kit sergeant, приоритетный вход.", 250, "serzhant", "emerald"],
      ["Коман��ир", "Наборы техники, /kit commander, доступ к /feed и /heal.", 450, "komandir", "amber"],
      ["Генерал", "Максимум привилегий: все киты, /fly в лобби, префикс «Генерал».", 650, "general", "rose"],
    ]
    let order = 0
    for (const [name, desc, price, group, accent] of privileges) {
      await db.query(
        `INSERT INTO donate_products (kind, name, description, price_rub, group_name, duration_days, rcon_command, accent, sort_order)
         VALUES ('privilege', ?, ?, ?, ?, 30, ?, ?, ?)`,
        [name, desc, price, group, tmpl, accent, order++],
      )
    }
    // Пакеты DC (1₽ = 1 DC). Бонус начисляется автоматически по настройкам.
    const dcPacks: Array<[number, string]> = [
      [100, "sky"],
      [250, "emerald"],
      [500, "amber"],
      [1000, "rose"],
    ]
    for (const [amount, accent] of dcPacks) {
      await db.query(
        `INSERT INTO donate_products (kind, name, description, price_rub, dc_amount, rcon_command, accent, sort_order)
         VALUES ('dc', ?, ?, ?, ?, 'dc give {nick} {amount}', ?, ?)`,
        [`${amount} DC`, `Пополнение баланса на ${amount} донат-коинов.`, amount, amount, accent, order++],
      )
    }
  }

  console.log("[migrate] Schema is up to date.")
}

// Миграция вызывается лениво перед первым запросом к БД (см. lib/db.ts),
// поэтому долги�� ретраи не нужны: при неудаче следующий запрос попробует снова.
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 2000

let migrated = false
let migrating: Promise<void> | null = null

/** Runs the migration with retries (MySQL container may still be starting). */
export async function ensureSchema(): Promise<void> {
  if (migrated) return
  if (migrating) return migrating
  migrating = (async () => {
    let lastError: unknown = null
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await runMigration()
        migrated = true
        return
      } catch (err) {
        lastError = err
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[migrate] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${message}`)
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        }
      }
    }
    // Пробрасываем ошибку: lib/db.ts сбросит кэш и повторит при следующем запросе.
    throw lastError
  })()
  try {
    await migrating
  } finally {
    migrating = null
  }
}
