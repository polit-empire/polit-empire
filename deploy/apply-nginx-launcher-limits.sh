#!/bin/bash
# Применяет новые лимиты nginx для трафика лаунчера. Запускать под root.
set -e

cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d-%H%M%S)
cp /etc/nginx/sites-enabled/politempire.org      "/root/nginx-backup-politempire.org-$STAMP"
cp /etc/nginx/sites-available/gml.politempire.ru "/root/nginx-backup-gml.politempire.ru-$STAMP"
echo "Бэкапы: /root/nginx-backup-*-$STAMP"

cp deploy/nginx-politempire-org.conf     /etc/nginx/sites-enabled/politempire.org
cp deploy/nginx-gml-politempire-ru.conf  /etc/nginx/sites-available/gml.politempire.ru

if nginx -t; then
    systemctl reload nginx
    echo "OK: nginx перезагружен"
else
    echo "ОШИБКА конфига — откатываю"
    cp "/root/nginx-backup-politempire.org-$STAMP"      /etc/nginx/sites-enabled/politempire.org
    cp "/root/nginx-backup-gml.politempire.ru-$STAMP"   /etc/nginx/sites-available/gml.politempire.ru
    exit 1
fi
