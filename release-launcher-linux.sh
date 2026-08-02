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
EXE="$APPIMAGE_DIR/polit-empire-launcher_${VERSION}_amd64.AppImage"

if [[ ! -f "$EXE" ]]; then
  echo "Ожидаемый файл не найден, беру самый свежий *.AppImage из папки..."
  EXE=$(ls -t "$APPIMAGE_DIR"/*.AppImage 2>/dev/null | head -n 1 || true)
fi

if [[ -z "$EXE" || ! -f "$EXE" ]]; then
  echo "[ОШИБКА] Не найден установщик в $APPIMAGE_DIR"
  exit 1
fi
echo "Установщик: $EXE"

echo ""
echo "=== [3/3] Загрузка на сервер ==="
if ! node scripts/upload-launcher.mjs "$EXE" "$VERSION" "$CHANGELOG"; then
  echo "[ОШИБКА] Не удалось загрузить на сервер."
  exit 1
fi

echo ""
echo "=== ГОТОВО! Версия $VERSION собрана и опубликована. ==="
