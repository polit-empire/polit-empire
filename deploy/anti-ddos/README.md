# Polit Empire — Anti-DDoS

Защита сайта (`politempire.org`, `politempire.ru`) и панели GML (`gml.politempire.ru`)
от DDoS и сканеров. Работает на уровне nginx + fail2ban + nftables.

## Состав

```
deploy/anti-ddos/
├── install.sh                       #一键 установка на сервере (под root)
├── nginx/
│   ├── 00-antiddos.conf             # глобально в http{}: real_ip Cloudflare,
│   │                                #   зоны limit_req/limit_conn, map'ы
│   │                                #   bad UA / bad URI / bad method / $loggable
│   └── antiddos-server.conf         # snippet для server{}: limit_conn,
│                                    #   блок bad UA/URI/method, общий limit_req
├── fail2ban/
│   ├── jail.local                   # jails: nginx-limit-req, nginx-post-root,
│   │                                #   nginx-botsearch, nginx-forbidden, sshd
│   ├── nginx-429-flood.conf         # фильтр всплеска 429 (выключен, см. jail.local)
│   └── nginx-post-root.conf         # фильтр POST / (главная страница)
├── logrotate.nginx                  # ротация по размеру 500M, hourly
└── logrotate-hourly.cron            # cron-задача ежечасной ротации
```

Обновлённые nginx site-конфиги, в которые включён anti-DDoS:

```
deploy/
├── nginx-politempire-org.conf       # politempire.org + www (сайт)
├── nginx-politempire-ru.conf        # politempire.ru + www (прямой домен + authlib)
└── nginx-gml-politempire-ru.conf    # gml.politempire.ru (панель GML)
```

## Установка

На сервере под root:

```bash
sudo bash deploy/anti-ddos/install.sh
```

Скрипт:
1. Копирует конфиги nginx, fail2ban, logrotate.
2. Делает бэкап старых site-конфигов в `/etc/nginx/sites-available.bak.<ts>/`.
3. Отключает старый `zz-ratelimit.conf` и дублирующий site `politempire`.
4. Ставит `fail2ban` (если не установлен), включает jail'ы.
5. Проверяет `nginx -t` и применяет, перезапускает fail2ban.

## Что именно защищает

### nginx (первая линия)

| Механизм | Что ловит |
|---|---|
| `real_ip_header CF-Connecting-IP` + `set_real_ip_from` (диапазоны Cloudflare) | Сайт за Cloudflare (.org) — nginx и fail2ban видят **настоящий IP клиента**, а не Cloudflare. Для прямого домена .ru — остаётся реальный IP. |
| `limit_req zone=antiddos_general rate=15r/s burst=40 nodelay` | Общий лимит на каждый server: 15 запросов/сек с всплеском 40. Превышение → 429. |
| `limit_req zone=antiddos_api rate=5r/s burst=20` | Лимит на `/api/` сайта и GML. |
| `limit_req zone=antiddos_auth rate=1r/s` | Лимит на `/api/auth/...` (заготовка под расширение). |
| `limit_req zone=antiddos_authlib rate=30r/s burst=60` | Authlib-эндпоинт для Minecraft (`/api/v1/...`): высокий лимит, чтобы реальные клиенты не страдали при входе/смене сервера. |
| `limit_conn antiddos_conn 20` | Не больше 20 одновременных соединений с IP. |
| `limit_except GET HEAD OPTIONS` в `location = /` | **Блок POST / на корень** — основная атака «POST / HTTP/2.0» теперь сразу 403. |
| `map $http_user_agent $bad_ua` + `if ($bad_ua) { return 403; }` | Блок пустых и известных сканерских UA: `sqlmap`, `nikto`, `acunetix`, `nmap`, `masscan`, `zgrab`, `Go-http-client`, `Python-urllib`, `python-requests`, `libwww-perl`. **Легитимные браузеры и curl/wget НЕ блокятся.** |
| `map $request_uri $bad_uri` + `if ($bad_uri) { return 403; }` | Блок scanner-путей: `/wp-admin`, `/wp-login`, `/xmlrpc.php`, `/phpmyadmin`, `/.env`, `/.git`, `/.aws`, `/phpinfo`, `/shell.php`, `/etc/passwd`, `/cgi-bin`, `/vendor/phpunit`, `/actuator`, path-traversal `../..`. |
| `map $request_method $bad_method` | Разрешены только `GET/POST/HEAD/OPTIONS/PUT/PATCH/DELETE`. `TRACE/CONNECT/DEBUG/...` → 405. |
| `access_log ... if=$loggable` | **Не пишем в access.log статусы 400/429/444** — во время атаки они забивают диск (было 9 GB/день, стало ~120 MB/день). 403/404/405 и 2xx/3xx/5xx логируются — нужны для fail2ban и отладки. |
| `client_body_timeout 10s`, `client_header_timeout 10s`, `keepalive_timeout 30s`, `send_timeout 10s` | Защита от slowloris. |

### fail2ban (вторая линия — бан на уровне nftables)

| Jail | Что делает |
|---|---|
| `nginx-limit-req` | Читает `error.log`, ловит `limiting requests, excess: ... by zone "..."`. 8 срабатываний за 5 мин → бан 2 ч. **Это основной механизм: attackers, превышающие rate-limit, банятся в nftables — пакеты больше не доходят до nginx.** |
| `nginx-post-root` | Читает `access.log`, ловит `POST / HTTP/x.x`. 3 за минуту → бан 6 ч. Главная страница никогда не запрашивается POST — это всегда бот. |
| `nginx-botsearch` | Встроенный фильтр: `/phpmyadmin`, `/.env`, `/wp-admin` и т.п. 3 за 10 мин → бан 1 день. |
| `nginx-forbidden` | Встроенный фильтр: 403-ответы. 5 за 10 мин → бан 1 ч. |
| `sshd` | Защита SSH от перебора (5 попыток / 10 мин → бан 1 ч). |

Бан: `nftables[type=allports]` (по умолчанию в Debian) — заблокированный IP не
достучится ни до одного порта сервера. Время бана растёт в 2 раза при повторных
срабатываниях (`bantime.increment = true`), максимум 24 ч.

### logrotate (третья линия — защита диска)

Стандартный `/etc/logrotate.d/nginx` крутит логи раз в сутки по дате — при DDoS
это поздно (лог успевает вырасти до 9 GB и забить диск). Заменён на
`/etc/logrotate.d/nginx-politempire`:

- Ротация по размеру **500M** (а не по дате).
- Проверка каждый час через `/etc/cron.hourly/logrotate-nginx-size`.
- Сжатие `zstd -19 --long` (быстрее и плотнее gzip).
- Хранится 5 копий.

## Мониторинг

```bash
# Список активных jail'ов
sudo fail2ban-client status

# Статистика по конкретному jail'у (число банов, список IP)
sudo fail2ban-client status nginx-limit-req
sudo fail2ban-client status nginx-post-root

# Разбанить IP
sudo fail2ban-client set nginx-limit-req unbanip 1.2.3.4

# Список забаненных IP в nftables
sudo nft list set inet f2b-table addr-set-nginx-limit-req 2>/dev/null || \
sudo nft list ruleset | grep -A2 f2b

# Скорость роста логов (должна быть низкой после включения защиты)
watch -n5 'ls -lh /var/log/nginx/access.log /var/log/nginx/error.log'
```

## Что НЕ блокируется (важно)

- **Легитимные браузеры** — UA `Mozilla/5.0 ...` с реальными признаками не
  попадают в `$bad_ua`.
- **`curl` и `wget`** — нужны для certbot, healthcheck, ручной отладки.
- **Googlebot / YandexBot / легитимные crawler'ы** — `~*bot` и `~*crawler` в map
  намеренно дают 0 (не блокируем).
- **POST на `/api/...`** — POST нужен для `/api/auth/telegram`, `/api/gml/auth`,
  `/api/launcher/logs`, `/api/telemetry`, `/api/mod/...`. Поэтому `limit_except`
  стоит **только в `location = /`** (точное совпадение корня), а не в `location /`.
- **Authlib-запросы Minecraft** (`/api/v1/...`) — высокий лимит 30r/s + burst 60,
  чтобы реальные клиенты не страдали при входе.
- **Панель GML (`gml.politempire.ru`)** — POST нужен для логина и управления.
  Поэтому на этом домене `limit_except` **НЕ** стоит, только общий rate-limit и
  фильтры bad UA/URI/method.

## Если нужно ослабить/усилить

- **Жёстче общее**: уменьшить `rate=15r/s` → `rate=10r/s` в `00-antiddos.conf`
  и `burst=40` → `burst=20` в `antiddos-server.conf`.
- **Мягче для API**: увеличить `rate=5r/s` → `rate=10r/s` для `antiddos_api`.
- **Быстрее бан**: в `jail.local` уменьшить `maxretry` (например, 8 → 3) и
  `findtime` (10m → 1m).
- **Дольше бан**: `bantime = 1h` → `bantime = 1d` (или `1w`).

## Откат

```bash
# Восстановить старые site-конфиги
sudo cp /etc/nginx/sites-available.bak.<ts>/politempire.org /etc/nginx/sites-available/
sudo cp /etc/nginx/sites-available.bak.<ts>/politempire.ru  /etc/nginx/sites-available/
sudo cp /etc/nginx/sites-available.bak.<ts>/gml.politempire.ru /etc/nginx/sites-available/
sudo rm /etc/nginx/conf.d/00-antiddos.conf
sudo mv /etc/nginx/conf.d/zz-ratelimit.conf.disabled.* /etc/nginx/conf.d/zz-ratelimit.conf
sudo systemctl stop fail2ban && sudo systemctl disable fail2ban
sudo nginx -t && sudo systemctl reload nginx
```
