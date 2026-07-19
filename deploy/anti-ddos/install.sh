#!/bin/bash
# ============================================================================
# Polit Empire — установка anti-DDoS защиты на сервер (nginx + fail2ban).
# ----------------------------------------------------------------------------
# Что делает:
#   1. Копирует nginx anti-DDoS конфиги в /etc/nginx/conf.d/ и /etc/nginx/snippets/
#   2. Копирует обновлённые site-конфиги (.org, .ru, gml.*.ru) в sites-available/
#   3. Отключает старый zz-ratelimit.conf и дублирующий site `politempire`
#   4. Устанавливает fail2ban (если не установлен) и копирует jail'ы
#   5. Ставит агрессивный logrotate (по размеру 500M, hourly cron)
#   6. Проверяет nginx -t и применяет, перезапускает fail2ban
#
# Запускать ПОД ROOT на сервере:
#   sudo bash deploy/anti-ddos/install.sh
#
# Перед запуском: убедитесь, что бэкапы старых конфигов есть
# (скрипт делает бэкап в /etc/nginx/sites-available.bak.<timestamp>).
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "$(id -u)" != "0" ]; then
  echo "Запустите под root: sudo bash $0" >&2
  exit 1
fi

DEPLOY_DIR="$(pwd)/deploy"
TS="$(date +%s)"

echo "==> 1. Установка nginx anti-DDoS конфигов"
install -m 0644 "$DEPLOY_DIR/anti-ddos/nginx/00-antiddos.conf" /etc/nginx/conf.d/00-antiddos.conf
mkdir -p /etc/nginx/snippets
install -m 0644 "$DEPLOY_DIR/anti-ddos/nginx/antiddos-server.conf" /etc/nginx/snippets/antiddos-server.conf

# Отключаем старый zz-ratelimit.conf (конфликтует с новым zone antiddos_general).
if [ -f /etc/nginx/conf.d/zz-ratelimit.conf ]; then
  mv /etc/nginx/conf.d/zz-ratelimit.conf /etc/nginx/conf.d/zz-ratelimit.conf.disabled.$TS
  echo "    старый zz-ratelimit.conf отключён"
fi

echo "==> 2. Бэкап site-конфигов и установка новых"
mkdir -p /etc/nginx/sites-available.bak.$TS
cp -a /etc/nginx/sites-available/* /etc/nginx/sites-available.bak.$TS/ 2>/dev/null || true

install -m 0644 "$DEPLOY_DIR/nginx-politempire-org.conf" /etc/nginx/sites-available/politempire.org
install -m 0644 "$DEPLOY_DIR/nginx-politempire-ru.conf"  /etc/nginx/sites-available/politempire.ru
install -m 0644 "$DEPLOY_DIR/nginx-gml-politempire-ru.conf" /etc/nginx/sites-available/gml.politempire.ru

ln -sf /etc/nginx/sites-available/politempire.org    /etc/nginx/sites-enabled/politempire.org
ln -sf /etc/nginx/sites-available/politempire.ru     /etc/nginx/sites-enabled/politempire.ru
ln -sf /etc/nginx/sites-available/gml.politempire.ru /etc/nginx/sites-enabled/gml.politempire.ru

# Дублирующий site `politempire` (старая копия politempire.org) — убираем.
if [ -L /etc/nginx/sites-enabled/politempire ]; then
  rm /etc/nginx/sites-enabled/politempire
  echo "    дублирующий site 'politempire' отключён (конфликтовал с politempire.org)"
fi

echo "==> 3. Установка fail2ban"
if ! command -v fail2ban-client >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban
fi
install -m 0644 "$DEPLOY_DIR/anti-ddos/fail2ban/jail.local"           /etc/fail2ban/jail.local
install -m 0644 "$DEPLOY_DIR/anti-ddos/fail2ban/nginx-429-flood.conf" /etc/fail2ban/filter.d/nginx-429-flood.conf
install -m 0644 "$DEPLOY_DIR/anti-ddos/fail2ban/nginx-post-root.conf" /etc/fail2ban/filter.d/nginx-post-root.conf

echo "==> 4. Установка logrotate (по размеру, hourly cron)"
install -m 0644 "$DEPLOY_DIR/anti-ddos/logrotate.nginx"        /etc/logrotate.d/nginx-politempire
install -m 0755 "$DEPLOY_DIR/anti-ddos/logrotate-hourly.cron" /etc/cron.hourly/logrotate-nginx-size
if [ -f /etc/logrotate.d/nginx ]; then
  mv /etc/logrotate.d/nginx /etc/logrotate.d/nginx.disabled
  echo "    стандартный /etc/logrotate.d/nginx отключён (заменён на nginx-politempire)"
fi

echo "==> 5. Проверка nginx -t"
if ! nginx -t; then
  echo "ОШИБКА: nginx -t упал. Бэкап старых конфигов: /etc/nginx/sites-available.bak.$TS" >&2
  exit 1
fi

echo "==> 6. Применение"
systemctl reload nginx
systemctl enable --now fail2ban
systemctl restart fail2ban

echo
echo "Готово. Проверка:"
echo "  fail2ban-client status                          # список jail'ов"
echo "  fail2ban-client status nginx-limit-req          # статистика банов"
echo "  curl -sI https://politempire.ru/                # сайт жив"
echo "  curl -sI -X POST https://politempire.ru/        # должен быть 403 (POST / блокирован)"
echo "  curl -sI -A 'sqlmap/1.6' https://politempire.ru/ # должен быть 403 (bad UA)"
echo
echo "Бэкап старых site-конфигов: /etc/nginx/sites-available.bak.$TS"
