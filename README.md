# Polit Empire — лаунчер, сайт и панель управления GML

Полный стек для приватного Minecraft-сервера:

| Модуль | Технологии | Где лежит |
|---|---|---|
| Сайт + API (TG-бот, мост авторизации) | Next.js 16 (App Router), MySQL | `app/api/*`, `lib/*` |
| Telegram-бот | Webhook на `app/api/telegram/webhook` | `lib/telegram.ts` |
| Панель управления | **GML (Gml.Web.Client)** | `panel/` |
| Бэкенд лаунчер-платформы | **GML (Gml.Web.Api)** — Docker-образ | `docker-compose.yml` |
| Лаунчер | Tauri 2 (Rust) + React + Vite | `launcher/` |

## Архитектура

```
Игрок ── Telegram-бот ──> аккаунт (ник + пароль) в MySQL
Лаунчер ──> Gml.Web.Api (авторизация, профиль, файлы сборки)
Gml.Web.Api ──(Custom auth)──> POST /api/gml/auth (проверка ника/пароля в MySQL)
Панель GML ──> Gml.Web.Api (управление сборками, игроками, интеграциями)
```

- Аккаунты по-прежнему создаются через Telegram-бота (регистрация, смена пароля).
- Сборки игры загружаются и управляются в панели GML (профили, моды, Java-аргументы).
- Лаунчер скачивает файлы и авторизуется через Gml.Web.Api.

## 1. Быстрый старт (сайт + бот)

```bash
cp .env.example .env      # заполните значения (в т.ч. GML_SECURITY_KEY)
pnpm install
node scripts/migrate.mjs  # создаёт таблицы в MySQL
pnpm dev                  # http://localhost:3000
```

## 2. Запуск GML (панель + бэкенд)

```bash
docker compose up -d --build
```

Поднимутся: сайт (`app`), боты (`bots`), а также GML-стек (БД — внешний MySQL, задаётся в `.env`):

| Сервис | Назначение | Порт на хосте |
|---|---|---|
| `gml-web-api` | Gml.Web.Api — ядро платформы | внутри сети |
| `gml-web-frontend` | Панель управления (собирается из `panel/`) | внутри сети |
| `gml-web-proxy` | Reverse-proxy: `/` → панель, `/api` → API | `127.0.0.1:5003` |
| `gml-web-skins` | Сервис скинов | внутри сети |

Настройте nginx на проброс поддомена (например `gml.politempire.org`) на `127.0.0.1:5003` с TLS. При первом входе в панель создайте аккаунт администратора.

### Подключение авторизации через Telegram-бота

В панели GML: **Интеграции → Аутентификация → Custom (Собственная)** и укажите endpoint:

```
https://politempire.org/api/gml/auth
```

После этого игроки входят в лаунчер по нику и паролю, выданному Telegram-ботом. Проверка происходит в вашей базе MySQL.

#### Важно: authlib-injector на самом Minecraft-сервере

Клиент (лаунчер) и Minecraft-сервер должны обращаться к одному и тому же
authlib-эндпоинту — **напрямую, минуя Cloudflare**. Если сервер находится на
российском IP, запросы к домену через Cloudflare (`gml.politempire.org`)
блокируются, и вход завершается ошибкой **«Недействительная сессия»**
(`hasJoined` не доходит до бэкенда, хотя клиент уже отправил `join`).

**Шаг 1 — задеплоить nginx-прокси `/api/v1/` на GML-бэкенд.**
Домен `politempire.ru` обслуживает сайт (Next.js, порт 3001), а authlib-эндпоинт
живёт на GML-бэкенде (порт 5003). Без проксирующего правила запрос
`https://politempire.ru/api/v1/integrations/authlib` попадает в Next.js и
возвращает **404** (тёмная страница «Страница politempire.ru не найдена»).
Готовый конфиг лежит в `deploy/nginx-politempire-ru.conf` — в нём блок
`location /api/v1/ { proxy_pass http://127.0.0.1:5003; }` стоит ПЕРЕД
`location /`. Установите и перезагрузите nginx:

```bash
sudo cp deploy/nginx-politempire-ru.conf /etc/nginx/sites-available/politempire.ru
sudo ln -sf /etc/nginx/sites-available/politempire.ru /etc/nginx/sites-enabled/politempire.ru
sudo nginx -t && sudo systemctl reload nginx

# Проверка: должен вернуть JSON метаданных, а НЕ HTML сайта
curl -s https://politempire.ru/api/v1/integrations/authlib/minecraft | head
```

**Шаг 2 — команда запуска Minecraft-сервера.**
В команде запуска (Velocity/Paper, в Pterodactyl — поле **Startup Command**
или egg-переменная) укажите authlib-injector на **прямой** адрес, минуя
Cloudflare. Путь должен заканчиваться на `/authlib/minecraft`:

```diff
- -javaagent:authlib-injector-1.2.5.jar=https://gml.politempire.org/api/v1/integrations/authlib
+ -javaagent:authlib-injector-1.2.5.jar=https://politempire.ru/api/v1/integrations/authlib/minecraft
```

Если Minecraft-сервер и GML-бэкенд на одной машине — ещё надёжнее локальный
адрес (вообще без выхода в интернет и nginx):

```
-javaagent:authlib-injector-1.2.5.jar=http://127.0.0.1:5003/api/v1/integrations/authlib/minecraft
```

После правки перезапустите сервер. Клиентский лаунчер (`GML_API_BASE` в
`launcher/src-tauri/src/config.rs`) должен указывать на тот же прямой домен
(`https://politempire.ru`).

## 3. Telegram-бот

1. Создайте бота у [@BotFather](https://t.me/BotFather), получите токен.
2. Впишите `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` в `.env`.
3. После деплоя установите вебхук:

```bash
node scripts/set-telegram-webhook.mjs
```

Бот регистрирует игрока (ник + пароль) — эти же учётные данные используются для входа в лаунчер через GML.

## 4. Загрузка сборки игры

Делается в панели GML: **Профили → Создать профиль** (версия Minecraft, загрузчик модов), затем загрузите моды/конфиги в файлы профиля. GML сам считает хеши файлов, лаунчер докачивает только изменившееся.

Имя профиля должно совпадать с `GML_PROFILE_NAME` в `.env` и `GML_PROFILE_NAME` в `launcher/src-tauri/src/config.rs` (по умолчанию `PolitEmpire`).

## 5. Сборка лаунчера (Windows)

Требуются: Node.js, pnpm, Rust (rustup), WebView2.

```bash
cd launcher
pnpm install
# укажите боевые адреса в src-tauri/src/config.rs:
#   API_BASE      — сайт (https://politempire.org)
#   GML_API_BASE  — GML-прокси (https://gml.politempire.org)
pnpm tauri build   # → src-tauri/target/release/bundle/nsis/*.exe
```

## 6. API сайта (для справки)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/gml/auth` | мост авторизации для GML (Custom-провайдер) |
| POST | `/api/auth/telegram` | start/poll авторизации через бота |
| GET | `/api/auth/verify` | проверка токена (Bearer) |
| GET | `/api/launcher/version` | актуальная версия лаунчера |
| GET | `/api/launcher/download` | скачать exe лаунчера |
| POST | `/api/telemetry` | телеметрия от лаунчера (Bearer) |

Управление игроками (бан/разбан), сборками и мониторинг — в панели GML.
