-- ============================================================
--  Polit Empire — служебные таблицы лаунчера
--  Импортируйте этот файл через phpMyAdmin / панель хостинга,
--  выбрав вашу базу (например s81_BANITD).
--
--  Все таблицы создаются через CREATE TABLE IF NOT EXISTS —
--  существующие данные и таблицы с игроками НЕ затрагиваются.
-- ============================================================

-- Таблица игроков.
-- Если у вас УЖЕ есть своя таблица игроков с другим именем/структурой,
-- НЕ выполняйте этот блок, а вместо него добавьте недостающие столбцы
-- в свою таблицу (см. ALTER-подсказки в самом низу файла).
CREATE TABLE IF NOT EXISTS users (
  minecraft_nick VARCHAR(32) NOT NULL PRIMARY KEY,
  password_hash  VARCHAR(255) NULL,
  telegram_id    BIGINT NULL,
  is_banned      TINYINT(1) NOT NULL DEFAULT 0,
  ban_reason     VARCHAR(512) NULL,
  api_token      VARCHAR(64) NULL,
  created_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  last_login     TIMESTAMP NULL,
  last_hwid      VARCHAR(64) NULL,
  last_ip        VARCHAR(45) NULL,
  ac_strikes     INT NOT NULL DEFAULT 0,
  ac_last_session VARCHAR(64) NULL,
  ac_last_strike TIMESTAMP NULL,
  INDEX idx_users_api_token (api_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Баны по железу (HWID устройства)
CREATE TABLE IF NOT EXISTS banned_hwids (
  hwid        VARCHAR(64) NOT NULL PRIMARY KEY,
  mc_username VARCHAR(32) NULL,
  reason      VARCHAR(512) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Баны по UUID игрока (offline-UUID Minecraft, детерминирован по нику)
CREATE TABLE IF NOT EXISTS banned_uuids (
  uuid        VARCHAR(64) NOT NULL PRIMARY KEY,
  mc_username VARCHAR(32) NULL,
  reason      VARCHAR(512) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Баны по IP-адресу
CREATE TABLE IF NOT EXISTS banned_ips (
  ip          VARCHAR(45) NOT NULL PRIMARY KEY,
  mc_username VARCHAR(32) NULL,
  reason      VARCHAR(512) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- События античита (присылает лаунчер; Discord-бот постит в канал)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Одноразовые коды входа (создаются лаунчером, подтверждаются ботом)
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

-- Состояние диалога Telegram-бота
CREATE TABLE IF NOT EXISTS tg_sessions (
  chat_id      BIGINT NOT NULL PRIMARY KEY,
  state        VARCHAR(32) NOT NULL DEFAULT 'idle',
  pending_code VARCHAR(6) NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Телеметрия лаунчера
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

-- Сборки (манифесты клиента)
CREATE TABLE IF NOT EXISTS builds (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  manifest   LONGTEXT NOT NULL,
  file_count INT NOT NULL DEFAULT 0,
  total_size BIGINT NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Версии лаунчера (авто-обновление)
CREATE TABLE IF NOT EXISTS launcher_versions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  version    VARCHAR(32) NOT NULL,
  changelog  TEXT NULL,
  file_name  VARCHAR(255) NOT NULL,
  file_size  BIGINT NOT NULL DEFAULT 0,
  is_active  TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
--  ЕСЛИ у вас уже есть СВОЯ таблица игроков (с другой структурой),
--  приложению нужны в ней такие столбцы. Выполните ALTER-и по
--  очереди; если столбец уже есть — MySQL выдаст ошибку "Duplicate
--  column", её можно игнорировать.
--
--  ALTER TABLE users ADD COLUMN telegram_id BIGINT NULL;
--  ALTER TABLE users ADD COLUMN api_token   VARCHAR(64) NULL;
--  ALTER TABLE users ADD COLUMN is_banned   TINYINT(1) NOT NULL DEFAULT 0;
--  ALTER TABLE users ADD COLUMN ban_reason  VARCHAR(512) NULL;
--  ALTER TABLE users ADD COLUMN last_login  TIMESTAMP NULL;
-- ============================================================
