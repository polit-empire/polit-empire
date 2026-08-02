#!/usr/bin/env bash
# ============================================================================
#  Полный релиз лаунчера в одну команду (для Linux):
#    1) поднимает номер версии во всех файлах
#    2) собирает установщик (npm run tauri build)
#    3) заливает готовый установщик на сервер
#
#  Использование:
#    ./release-launcher-linux.sh                       -> patch (1.0.0 -> 1.0.1), без описания
#    ./release-launcher-linux.sh patch "Баг-фиксы"
#    ./release-launcher-linux.sh minor "Новые функции"
#    ./release-launcher-linux.sh major "Крупное обновление"
#    ./release-launcher-linux.sh 1.2.5 "Точная версия"
#
#  Дополнительные флаги (в любом месте команды):
#    --no-build   пропустить сборку (залить уже собранный установщик)
# ============================================================================

set -e
cd "$(dirname "$0")"

BUMP=""
CHANGELOG=""
SKIP_BUILD=""

for ARG in "$@"; do
  if [[ "$ARG" == "--no-build" ]]; then
    SKIP_BUILD="1"
  elif [[ -z "$BUMP" ]]; then
    BUMP="$ARG"
  elif [[ -z "$CHANGELOG" ]]; then
    CHANGELOG="$ARG"
  fi
done

if [[ -z "$BUMP" ]]; then
  BUMP="patch"
fi

echo ""
echo "=== [1/4] Обновление версии ($BUMP) ==="

VERSION=$(node scripts/bump-version.mjs "$BUMP" | tail -n 1)

if [[ -z "$VERSION" ]]; then
  echo "[ОШИБКА] Не удалось получить новую версию. Проверьте, что установлен Node.js."
  exit 1
fi
echo "Новая версия: $VERSION"

if [[ -n "$SKIP_BUILD" ]]; then
  echo ""
  echo "=== [2/4] Сборка ПРОПУЩЕНА (--no-build) ==="
else
  echo ""
  echo "=== [2/4] Сборка установщика ==="
  pushd launcher-linux > /dev/null
  if ! npm run tauri build; then
    echo "[ОШИБКА] Сборка завершилась с ошибкой."
    popd > /dev/null
    exit 1
  fi
  popd > /dev/null
fi

APPIMAGE_DIR="launcher-linux/src-tauri/target/release/bundle/appimage"
DEB_DIR="launcher-linux/src-tauri/target/release/bundle/deb"
RPM_DIR="launcher-linux/src-tauri/target/release/bundle/rpm"

EXE_APPIMAGE="$APPIMAGE_DIR/polit-empire-launcher_${VERSION}_amd64.AppImage"
EXE_DEB="$DEB_DIR/polit-empire-launcher_${VERSION}_amd64.deb"
EXE_RPM="$RPM_DIR/polit-empire-launcher-${VERSION}-1.x86_64.rpm"

if [[ ! -f "$EXE_APPIMAGE" ]]; then EXE_APPIMAGE=$(ls -t "$APPIMAGE_DIR"/*.AppImage 2>/dev/null | head -n 1 || true); fi
if [[ ! -f "$EXE_DEB" ]]; then EXE_DEB=$(ls -t "$DEB_DIR"/*.deb 2>/dev/null | head -n 1 || true); fi
if [[ ! -f "$EXE_RPM" ]]; then EXE_RPM=$(ls -t "$RPM_DIR"/*.rpm 2>/dev/null | head -n 1 || true); fi

echo ""
echo "=== [3/3] Загрузка на сервер ==="

UPLOADED=0
for FILE in "$EXE_APPIMAGE" "$EXE_DEB" "$EXE_RPM"; do
  if [[ -n "$FILE" && -f "$FILE" ]]; then
    echo "Установщик найден: $FILE"
    if ! node scripts/upload-launcher.mjs "$FILE" "$VERSION" "$CHANGELOG"; then
      echo "[ОШИБКА] Не удалось загрузить на сервер: $FILE"
      exit 1
    fi
    UPLOADED=1
  else
    echo "[ВНИМАНИЕ] Файл не найден (пропуск)"
  fi
done

if [[ $UPLOADED -eq 0 ]]; then
  echo "[ОШИБКА] Не найдено ни одного собранного установщика."
  exit 1
fi

echo ""
echo "=== ГОТОВО! Версия $VERSION собрана и опубликована. ==="
