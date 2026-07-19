@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

REM ============================================================================
REM  Полный релиз лаунчера в одну команду:
REM    1) поднимает номер версии во всех файлах
REM    2) собирает установщик (npm run tauri build)
REM    3) регистрирует SHA-256 собранного лаунчера в белом списке (self-integrity)
REM    4) заливает готовый установщик на сервер
REM
REM  Использование:
REM    release-launcher.bat                       -> patch (1.0.0 -> 1.0.1), без описания
REM    release-launcher.bat patch "Баг-фиксы"
REM    release-launcher.bat minor "Новые функции"
REM    release-launcher.bat major "Крупное обновление"
REM    release-launcher.bat 1.2.5 "Точная версия"
REM
REM  Дополнительные флаги (в любом месте команды):
REM    --no-build   пропустить сборку (залить уже собранный установщик)
REM    --no-hash    не регистрировать хеш в белом списке
REM    --only       сделать активным ТОЛЬКО хеш этой сборки (деактивировать прежние)
REM ============================================================================

cd /d "%~dp0"

REM --- разбор аргументов ------------------------------------------------------
REM Флаги ищем в любомд месте; первый не-флаг -> bump, второй не-флаг -> changelog.
set "BUMP="
set "CHANGELOG="
set "SKIP_BUILD="
set "SKIP_HASH="
set "HASH_ONLY="

for %%A in (%*) do (
  set "ARG=%%~A"
  if /i "!ARG!"=="--no-build" (
    set "SKIP_BUILD=1"
  ) else if /i "!ARG!"=="--no-hash" (
    set "SKIP_HASH=1"
  ) else if /i "!ARG!"=="--only" (
    set "HASH_ONLY=--only"
  ) else if not defined BUMP (
    set "BUMP=!ARG!"
  ) else if not defined CHANGELOG (
    set "CHANGELOG=!ARG!"
  )
)
if not defined BUMP set "BUMP=patch"

echo(
echo === [1/4] Обновление версии (%BUMP%) ===

REM Захватываем новую версию: bump-version.mjs печатает её последней строкой в stdout.
set "VERSION="
for /f "usebackq delims=" %%v in (`node scripts\bump-version.mjs %BUMP%`) do set "VERSION=%%v"

if "%VERSION%"=="" (
  echo [ОШИБКА] Не удалось получить новую версию. Проверьте, что установлен Node.js.
  exit /b 1
)
echo Новая версия: %VERSION%

REM --- сборка -----------------------------------------------------------------
if defined SKIP_BUILD (
  echo(
  echo === [2/4] Сборка ПРОПУЩЕНА (--no-build) ===
) else (
  echo(
  echo === [2/4] Сборка установщика ===
  pushd launcher
  call npm run tauri build
  if errorlevel 1 (
    echo [ОШИБКА] Сборка завершилась с ошибкой.
    popd
    exit /b 1
  )
  popd
)

REM --- регистрация хеша самого лаунчера (self-integrity) ----------------------
REM Хешируется НЕ установщик, а бинарник из target\release, который ставится
REM игроку и который лаунчер сверяет через current_exe(). Имя exe зависит от
REM Tauri (productName или имя crate) — ищем оба варианта, затем берём самый
REM свежий *.exe из target\release как запасной вариант.
set "REL_DIR=launcher\src-tauri\target\release"
set "LAUNCHER_EXE="
if exist "%REL_DIR%\Polit Empire Launcher.exe" set "LAUNCHER_EXE=%REL_DIR%\Polit Empire Launcher.exe"
if not defined LAUNCHER_EXE if exist "%REL_DIR%\polit-empire-launcher.exe" set "LAUNCHER_EXE=%REL_DIR%\polit-empire-launcher.exe"
if not defined LAUNCHER_EXE (
  for /f "usebackq delims=" %%f in (`dir /b /a-d /o-d "%REL_DIR%\*.exe" 2^>nul`) do (
    if not defined LAUNCHER_EXE set "LAUNCHER_EXE=%REL_DIR%\%%f"
  )
)

if defined SKIP_HASH (
  echo(
  echo === [3/4] Регистрация хеша ПРОПУЩЕНА (--no-hash) ===
) else if not defined LAUNCHER_EXE (
  echo(
  echo === [3/4] Регистрация хеша ===
  echo [ПРЕДУПРЕЖДЕНИЕ] Не найден бинарник лаунчера в %REL_DIR%.
  echo Пропускаю регистрацию хеша. Соберите проект или укажите --no-hash.
) else (
  echo(
  echo === [3/4] Регистрация хеша (self-integrity) ===
  echo Бинарник: !LAUNCHER_EXE!
  node scripts\register-launcher-hash.mjs "!LAUNCHER_EXE!" %VERSION% %HASH_ONLY%
  if errorlevel 1 (
    echo [ОШИБКА] Не удалось зарегистрировать хеш лаунчера.
    exit /b 1
  )
)

REM --- поиск готового установщика --------------------------------------------
set "NSIS_DIR=launcher\src-tauri\target\release\bundle\nsis"
set "EXE=%NSIS_DIR%\Polit Empire Launcher_%VERSION%_x64-setup.exe"

if not exist "%EXE%" (
  echo Ожидаемый файл не найден, беру самый свежий *setup.exe из папки...
  set "EXE="
  for /f "usebackq delims=" %%f in (`dir /b /a-d /o-d "%NSIS_DIR%\*setup.exe" 2^>nul`) do (
    if not defined EXE set "EXE=%NSIS_DIR%\%%f"
  )
)

if not defined EXE (
  echo [ОШИБКА] Не найден установщик в %NSIS_DIR%
  exit /b 1
)
if not exist "%EXE%" (
  echo [ОШИБКА] Файл не найден: %EXE%
  exit /b 1
)
echo Установщик: %EXE%

REM --- загрузка на сервер -----------------------------------------------------
echo(
echo === [4/4] Загрузка на сервер ===
node scripts\upload-launcher.mjs "%EXE%" %VERSION% "%CHANGELOG%"
if errorlevel 1 (
  echo [ОШИБКА] Не удалось загрузить на сервер.
  exit /b 1
)

echo(
echo === ГОТОВО! Версия %VERSION% собрана, захеширована и опубликована. ===
endlocal
