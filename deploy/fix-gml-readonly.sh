#!/usr/bin/env bash
#
# Чинит две связанные проблемы GML одним окном обслуживания:
#
#   1. «attempt to write a readonly database» при входе в лаунчере
#   2. бесконечная сборка профиля в панели
#
# ПРИЧИНА (установлена измерением, а не догадкой)
#
#   Процесс Gml.Web.Api.dll работает с 15:59:47. В 16:52 файл
#   data/GmlBackend/data.db подменили ПОД работающим процессом — правили
#   офлайн, снимая бан по железу (BannedHardwareItem: 3 -> 2, UserStorageItem:
#   561 -> 562). С этого момента в data.db не записалось НИЧЕГО: mtime так и
#   стоит на 16:52, хотя входы в лаунчер были.
#
#   Всё остальное проверено и исключено: mountinfo контейнера показывает rw на
#   /root/PolitEmpire и /app/database, процесс идёт от root, каталоги 777,
#   PRAGMA integrity_check на обеих БД — ok, диск не полон, immutable-атрибутов
#   нет. Сайт SQLite вообще не использует, так что исключение бросает именно
#   gml-web-api.
#
#   Профиль зависает по той же причине: сборка пишет прогресс в StorageItem
#   той же самой data.db.
#
# ПОЧЕМУ ЧЕРЕЗ ОСТАНОВКУ КОНТЕЙНЕРА
#
#   Пункт 3 меняет SkinUrl/CloakUrl прямо в БД. Делать это на живой базе —
#   повторить ошибку 16:52. Контейнер остановлен, БД никем не открыта, запись
#   безопасна. Заодно старт контейнера и есть лекарство от пункта 1.
#
# Запускать от root:  bash deploy/fix-gml-readonly.sh

set -euo pipefail

cd "$(dirname "$0")/.."
DB="data/GmlBackend/data.db"
STAMP="$(date +%Y%m%d-%H%M%S)"

command -v sqlite3 >/dev/null || { echo "нужен sqlite3: apt install -y sqlite3"; exit 1; }
[ -f "$DB" ] || { echo "не найден $DB (запускать из корня репозитория)"; exit 1; }

echo "==> 1/6  Останавливаю gml-web-api"
docker compose stop gml-web-api

# Процесс мог не успеть закрыть файл. Ждём, пока БД реально освободится.
for i in $(seq 1 15); do
    docker compose ps --status running --services 2>/dev/null | grep -qx gml-web-api || break
    sleep 1
done

echo "==> 2/6  Резервная копия -> $DB.bak-$STAMP"
cp -p "$DB" "$DB.bak-$STAMP"

echo "==> 3/6  Проверка копии перед правкой"
sqlite3 "file:$DB.bak-$STAMP?mode=ro" "PRAGMA integrity_check;"

echo "==> 4/6  Текущие URL текстур:"
sqlite3 "$DB" "SELECT Key, Value FROM StorageItem WHERE Key IN ('SkinUrl','CloakUrl');"

# .org идёт через Cloudflare: он видит запрос с публичного IP этого же сервера
# и отдаёт HTML-челлендж вместо картинки. .ru резолвится напрямую.
# CloakUrl гасим: ни одного файла плаща не заведено, эндпоинт отвечал 204 на
# каждый из ~5800 запросов в сутки — это чистый холостой трафик.
echo "==> 5/6  Перевожу скины на .ru и выключаю плащи"
sqlite3 "$DB" <<'SQL'
BEGIN;
UPDATE StorageItem
   SET Value = '"https://politempire.ru/api/skins/{userName}.png"'
 WHERE Key = 'SkinUrl';
UPDATE StorageItem
   SET Value = '""'
 WHERE Key = 'CloakUrl';
COMMIT;
SQL
sqlite3 "$DB" "SELECT Key, Value FROM StorageItem WHERE Key IN ('SkinUrl','CloakUrl');"
sqlite3 "file:$DB?mode=ro" "PRAGMA integrity_check;"

echo "==> 6/6  Поднимаю gml-web-api"
docker compose start gml-web-api

cat <<EOF

Готово. Проверка (mtime базы ДОЛЖЕН сдвинуться после первого же входа):

    stat -c '%y %n' $DB
    # войти в лаунчере, затем повторить stat — время должно измениться

Если время стоит на месте — писать readonly продолжает, покажи лог:

    docker logs --tail 100 gml-web-api 2>&1 | grep -i -B5 'readonly\|SQLite'

Откат правки URL (если панель начнёт ругаться на пустой CloakUrl):

    docker compose stop gml-web-api
    cp -p $DB.bak-$STAMP $DB
    docker compose start gml-web-api

ВАЖНО: больше не редактируй data.db, пока контейнер запущен — именно это и
привело к readonly. Всегда stop -> правка -> start.
EOF
