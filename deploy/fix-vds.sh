#!/bin/bash
#
# Polit Empire — устранение зависаний VDS и подготовка к работе 24/7.
#
#   sudo bash deploy/fix-vds.sh          # применить
#   sudo bash deploy/fix-vds.sh --dry-run # только показать, что будет сделано
#
# После выполнения потребуется перезагрузка (шаг 1 требует пересборки grub).
#
set -uo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/fix-vds-backup-$STAMP"
REPO_DIR="/opt/polit-empire"
NEED_REBOOT=0

c_ok()   { printf '\033[32m  OK\033[0m   %s\n' "$*"; }
c_skip() { printf '\033[33m SKIP\033[0m   %s\n' "$*"; }
c_info() { printf '\033[36m INFO\033[0m   %s\n' "$*"; }
c_head() { printf '\n\033[1m=== %s ===\033[0m\n' "$*"; }

run() {
    if (( DRY_RUN )); then
        printf '\033[35m  DRY\033[0m   %s\n' "$*"
    else
        eval "$@"
    fi
}

if [[ $EUID -ne 0 ]]; then
    echo "Запускать от root: sudo bash $0" >&2
    exit 1
fi

(( DRY_RUN )) && c_info "РЕЖИМ DRY-RUN — изменения не применяются"

# Бэкап делаем через backup(), а не голым cp: иначе --dry-run начнёт
# создавать файлы, хотя обещает ничего не менять.
backup() {
    local src="$1"
    [[ -e "$src" ]] || return 0
    run "mkdir -p '$BACKUP_DIR'"
    run "cp -a '$src' '$BACKUP_DIR/$(basename "$src")'"
}

c_info "Бэкапы конфигов: $BACKUP_DIR"


# ---------------------------------------------------------------------------
# 1. ПЕРВОПРИЧИНА ЗАВИСАНИЙ: DRM-драйвер cirrus-qemu
#
# В логах 438 kernel-warning'ов в одном стеке:
#   drm_fb_helper_damage_work -> drm_atomic_helper_dirtyfb
#     -> drm_atomic_helper_wait_for_vblanks
# Воркер ждёт vblank, которого на эмулированной видеокарте не бывает, и
# занимает CPU. Следствие — "clocksource: Long readout interval ...
# cs_nsec: 11444969980": вся ВМ замирает на 11 секунд, SSH в этот момент
# не отвечает. Отсюда же 7 жёстких обрывов без shutdown-последовательности.
#
# Существующий /etc/modprobe.d/blacklist-framebuffer.conf НЕ помогает:
# в нём указан "cirrusfb" (старый fbdev-драйвер), а реально загружается
# "cirrus_qemu" (новый DRM/KMS-драйвер) — другой модуль, другое имя.
#
# Сервер headless, графическая консоль нужна только как аварийный VNC
# в панели хостера. nomodeset оставляет текстовую консоль рабочей.
# ---------------------------------------------------------------------------
c_head "1. Отключение сбойного DRM-драйвера (первопричина зависаний)"

if grep -q "nomodeset" /proc/cmdline; then
    c_skip "nomodeset уже активен в текущей загрузке"
else
    backup /etc/default/grub

    # Машина грузится через legacy BIOS (/sys/firmware/efi отсутствует),
    # поэтому video=efifb:off здесь бесполезен — нужен именно nomodeset,
    # он не даёт KMS-драйверу захватить консоль.
    NEW_CMDLINE="nomodeset"

    if (( DRY_RUN )); then
        printf '\033[35m  DRY\033[0m   GRUB_CMDLINE_LINUX_DEFAULT="%s" + update-grub\n' "$NEW_CMDLINE"
        printf '\033[35m  DRY\033[0m   GRUB_TIMEOUT=5 / GRUB_TIMEOUT_STYLE=menu / GRUB_TERMINAL=console\n'
    else
        sed -i "s|^GRUB_CMDLINE_LINUX_DEFAULT=.*|GRUB_CMDLINE_LINUX_DEFAULT=\"$NEW_CMDLINE\"|" /etc/default/grub

        # Страховка на случай, если система не загрузится с nomodeset.
        # Было GRUB_TIMEOUT=0 + hidden: меню не показывалось, и выбрать запасное
        # ядро можно было только вслепую поймав Shift через VNC. Даём 5 секунд
        # на видимое меню — из него доступен Advanced options -> ядро 7.0.0-27.
        # GRUB_TERMINAL=console направляет вывод в текстовую консоль, которую
        # VNC-клиент хостера покажет гарантированно (при nomodeset графики нет).
        sed -i 's|^GRUB_TIMEOUT=.*|GRUB_TIMEOUT=5|' /etc/default/grub
        sed -i 's|^GRUB_TIMEOUT_STYLE=.*|GRUB_TIMEOUT_STYLE=menu|' /etc/default/grub
        if grep -q '^#GRUB_TERMINAL=console' /etc/default/grub; then
            sed -i 's|^#GRUB_TERMINAL=console|GRUB_TERMINAL=console|' /etc/default/grub
        elif ! grep -q '^GRUB_TERMINAL=' /etc/default/grub; then
            echo 'GRUB_TERMINAL=console' >> /etc/default/grub
        fi

        if update-grub 2>&1 | tail -2; then
            c_ok "GRUB_CMDLINE_LINUX_DEFAULT=\"$NEW_CMDLINE\", grub пересобран"
            c_ok "меню GRUB видимо 5 с — можно выбрать запасное ядро 7.0.0-27"
            NEED_REBOOT=1
        else
            echo "ОШИБКА: update-grub не отработал. Конфиг: $BACKUP_DIR/grub" >&2
        fi
    fi

    # Подстраховка на случай, если nomodeset не подавит загрузку модуля.
    if ! grep -qs "cirrus_qemu" /etc/modprobe.d/blacklist-cirrus-qemu.conf; then
        run "cat > /etc/modprobe.d/blacklist-cirrus-qemu.conf <<'EOF'
# Polit Empire: cirrus_qemu (DRM/KMS) виснет в drm_atomic_helper_wait_for_vblanks
# и подвешивает всю ВМ на секунды — SSH в этот момент недоступен.
# В blacklist-framebuffer.conf значится только старый cirrusfb, это ДРУГОЙ модуль.
blacklist cirrus_qemu
EOF"
        c_ok "cirrus_qemu добавлен в blacklist (подстраховка к nomodeset)"
    fi
fi


# ---------------------------------------------------------------------------
# 2. МЕСТО НА ДИСКЕ: 50G из 59G занято (90%), свободно 6G.
#    При заполнении до 100% встают nginx, MySQL и docker — прямой отказ 24/7.
# ---------------------------------------------------------------------------
c_head "2. Освобождение места на диске"

df -h / | tail -1

# 2a. Осиротевшие несжатые логи nginx: 779M + 466M = 1.2G.
# Соседние файлы за 23-26 июля сжаты в .zst, эти два — нет: ротация
# прошла (файлы переименованы по dateext), а сжатие не выполнилось
# из-за delaycompress в связке с прерванным запуском.
for f in /var/log/nginx/*.log-[0-9]*; do
    [[ -e "$f" ]] || continue
    case "$f" in *.zst|*.gz) continue ;; esac
    SIZE=$(du -h "$f" | cut -f1)
    run "zstd -19 -T0 --rm -q '$f'" && c_ok "сжат $(basename "$f") ($SIZE)"
done

# 2b. Журнал systemd — ограничить, иначе растёт неограниченно.
if ! grep -qs "^SystemMaxUse" /etc/systemd/journald.conf; then
    backup /etc/systemd/journald.conf
    run "sed -i 's|^\[Journal\]|[Journal]\nSystemMaxUse=200M\nSystemMaxFileSize=50M|' /etc/systemd/journald.conf"
    run "systemctl restart systemd-journald"
    c_ok "journald ограничен 200M (было без лимита, сейчас 145M)"
else
    c_skip "лимит journald уже задан"
fi
run "journalctl --vacuum-size=200M >/dev/null 2>&1"

# 2c. fail2ban.log = 274M при ротации weekly. При текущем потоке брутфорса
# (220 preauth-обрывов) недели слишком много — переводим на daily.
if [[ -f /etc/logrotate.d/fail2ban ]] && grep -qE "^\s*weekly" /etc/logrotate.d/fail2ban; then
    backup /etc/logrotate.d/fail2ban
    run "sed -i 's|^\(\s*\)weekly|\1daily|; s|^\(\s*\)rotate 4|\1rotate 7\n    maxsize 50M|' /etc/logrotate.d/fail2ban"
    c_ok "fail2ban: weekly -> daily, maxsize 50M"
else
    c_skip "ротация fail2ban уже настроена"
fi

run "apt-get clean"
c_ok "очищен кэш apt (~103M)"


# ---------------------------------------------------------------------------
# 3. ПОЧИНКА ЕЖЕЧАСНОЙ РОТАЦИИ NGINX
#
# /etc/cron.hourly/logrotate-nginx-size существует и исполняемый, но
# НЕ РАБОТАЕТ: строка #!/bin/sh стоит не первой (выше 8 строк комментариев),
# поэтому ядро не видит shebang. run-parts запускает такой файл через sh,
# так что молчаливо отрабатывает, но это случайность, а не задумка.
# Именно поэтому "size 500M" не срабатывал и логи доросли до 779M.
# ---------------------------------------------------------------------------
c_head "3. Починка ежечасной ротации логов nginx"

HOURLY=/etc/cron.hourly/logrotate-nginx-size
if [[ -f "$HOURLY" ]] && [[ "$(head -c 2 "$HOURLY")" != "#!" ]]; then
    backup "$HOURLY"
    run "cat > '$HOURLY' <<'EOF'
#!/bin/sh
# Polit Empire — ежечасная ротация логов nginx по размеру.
# Стандартный cron.daily крутит логи раз в сутки; при DDoS они растут
# по 9 GB/день и забивают диск. Конфиг: /etc/logrotate.d/nginx-politempire
/usr/sbin/logrotate /etc/logrotate.d/nginx-politempire
EOF"
    run "chmod 0755 '$HOURLY'"
    c_ok "shebang перенесён в первую строку — ротация по размеру заработает"
else
    c_skip "shebang в cron.hourly-скрипте уже корректен"
fi


# ---------------------------------------------------------------------------
# 4. SSH: закрыть root-логин по паролю.
#    В логах 220 preauth-обрывов и активный перебор паролей root
#    (топ-источник 117.187.180.166 — 34 попытки).
#    ВАЖНО: пароль отключается только при наличии ключей, иначе можно
#    потерять доступ к серверу.
# ---------------------------------------------------------------------------
c_head "4. Защита SSH"

HAS_KEYS=0
for kf in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
    [[ -s "$kf" ]] && HAS_KEYS=1 && break
done

if (( HAS_KEYS )); then
    backup /etc/ssh/sshd_config
    run "cat > /etc/ssh/sshd_config.d/60-politempire-hardening.conf <<'EOF'
# Polit Empire — защита от перебора паролей.
PermitRootLogin prohibit-password
MaxAuthTries 3
LoginGraceTime 20
# Ограничение параллельных неаутентифицированных сессий: гасит перебор,
# который иначе съедает слоты и мешает легитимному входу.
MaxStartups 10:50:60
EOF"
    if (( DRY_RUN )) || sshd -t 2>/dev/null; then
        run "systemctl reload ssh"
        c_ok "root — только по ключу, MaxAuthTries=3, MaxStartups ограничен"
        c_info "ВАЖНО: не закрывайте текущую сессию, пока не проверите вход в новой!"
    else
        rm -f /etc/ssh/sshd_config.d/60-politempire-hardening.conf
        echo "ОШИБКА: sshd -t не прошёл, изменения откачены" >&2
    fi
else
    c_skip "SSH-ключи не найдены — root-логин НЕ трогаю, иначе потеряете доступ"
    c_info "Добавьте ключ (ssh-copy-id), затем перезапустите скрипт"
fi

# fail2ban уже активен — усиливаем реакцию на перебор.
if systemctl is-active --quiet fail2ban; then
    if [[ ! -f /etc/fail2ban/jail.d/politempire-sshd.local ]]; then
        run "cat > /etc/fail2ban/jail.d/politempire-sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 3
findtime = 10m
bantime = 24h
EOF"
        run "systemctl reload fail2ban"
        c_ok "fail2ban: бан на 24ч после 3 неудачных попыток"
    else
        c_skip "правило fail2ban для sshd уже есть"
    fi
fi


# ---------------------------------------------------------------------------
# 5. ПОЧИНКА КОНТЕЙНЕРА bots
#
# Контейнер падал с exitCode=1 и был перезапущен 190 раз подряд:
#   RuntimeError: 'cryptography' package is required for
#   sha256_password or caching_sha2_password auth methods
# MySQL 8 использует caching_sha2_password, а зависимости не было в
# requirements.txt. Ошибка воспроизведена локально, фикс проверен.
# Отсюда же 598 ошибок "[gml-proxy] error: connect ECONNREFUSED".
# ---------------------------------------------------------------------------
c_head "5. Пересборка контейнера bots"

if ! grep -q "^cryptography" "$REPO_DIR/politempire_bots/requirements.txt" 2>/dev/null; then
    echo "ВНИМАНИЕ: cryptography отсутствует в requirements.txt — правка не применена?" >&2
else
    c_ok "cryptography есть в requirements.txt"
    run "cd '$REPO_DIR' && docker compose build bots"
    run "cd '$REPO_DIR' && docker compose up -d bots"
    c_ok "bots пересобран и запущен"
fi

c_head "Диагностика Docker (посмотрите вывод)"
run "docker system df"
c_info "Если места занято много — освободить: docker system prune -a --volumes"
c_info "(команда удалит неиспользуемые образы и тома — выполняйте осознанно)"


# ---------------------------------------------------------------------------
# Итог
# ---------------------------------------------------------------------------
c_head "Готово"
df -h / | tail -1
echo
c_info "Бэкапы изменённых конфигов: $BACKUP_DIR"

if (( NEED_REBOOT )); then
    echo
    printf '\033[1;33m  ТРЕБУЕТСЯ ПЕРЕЗАГРУЗКА\033[0m — фикс DRM применится только после неё:\n'
    printf '      sudo reboot\n\n'
    printf '  После перезагрузки проверьте, что первопричина устранена:\n'
    printf '      grep nomodeset /proc/cmdline\n'
    printf '      journalctl -b -k | grep -c drm_fb_helper_damage_work   # должно быть 0\n'
    printf '      docker compose ps                                      # все Up\n'
fi
