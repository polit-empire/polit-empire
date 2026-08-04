#!/bin/bash
# Резервное копирование SQLite-БД GML (data.db + GmlDatabase).
# sqlite3 .backup даёт консистентный снапшот, даже пока контейнер пишет.
# Хранение: 48 последних копий + лог целостности.
# Cron (каждый час):
#   17 * * * * /usr/local/bin/gml-backup.sh >> /var/log/gml-backup.log 2>&1
set -u

BACKUP_DIR=/opt/polit-empire/data/backups
KEEP=48
STAMP=$(date +%Y%m%d-%H%M)
LOG=/var/log/gml-backup.log

mkdir -p "$BACKUP_DIR"
chown 1000:1000 "$BACKUP_DIR" 2>/dev/null

backup_db() {
    local src="$1" name="$2"
    [ -f "$src" ] || { echo "[$(date '+%F %T')] SKIP: $src не существует"; return; }
    local dst="$BACKUP_DIR/${name}-${STAMP}.db"
    # VACUUM INTO с busy_timeout=15с: ждёт завершения чужой записи
    # (у GML-контейнера busy_timeout=0, но короткие транзакции не держат долго).
    if sqlite3 "$src" ".timeout 15000" "VACUUM INTO '$dst'" 2>/tmp/gml-backup.err; then
        chown 1000:1000 "$dst" 2>/dev/null
        local check
        check=$(sqlite3 "$dst" "PRAGMA integrity_check;" 2>/dev/null)
        if [ "$check" = "ok" ]; then
            echo "[$(date '+%F %T')] OK: $dst ($(du -h "$dst" | cut -f1), integrity ok)"
        else
            echo "[$(date '+%F %T')] WARN: $dst integrity=$check"
            rm -f "$dst"
        fi
    else
        echo "[$(date '+%F %T')] FAIL: $src -> $dst: $(cat /tmp/gml-backup.err)"
    fi
}

backup_db /opt/polit-empire/data/GmlBackend/data.db          gml-auth
backup_db /opt/polit-empire/data/GmlDatabase/data.db         gml-main

ls -1t "$BACKUP_DIR"/*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "[$(date '+%F %T')] cleanup: оставлено $(ls -1 "$BACKUP_DIR"/*.db 2>/dev/null | wc -l) копий"
