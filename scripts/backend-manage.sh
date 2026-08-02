#!/usr/bin/env bash
# Управление docker-бэкендом.
#
# Вызывается админкой сайта (вкладка «Бэкенд»): контейнер app монтирует
# /var/run/docker.sock и репозиторий /opt/polit-empire, поэтому может
# выполнять те же команды, что и администратор на хосте.
# Может использоваться и вручную на хосте.
#
#   backend-manage.sh status
#   backend-manage.sh logs <service> [lines]
#   backend-manage.sh restart <service>
#   backend-manage.sh rebuild <service>
#   backend-manage.sh start <service>
set -u

COMPOSE_DIR="${COMPOSE_DIR:-/opt/polit-empire}"
COMPOSE=(docker compose -f "$COMPOSE_DIR/docker-compose.yml" --project-directory "$COMPOSE_DIR")

case "${1:-}" in
  status)
    "${COMPOSE[@]}" ps
    ;;
  logs)
    svc="${2:-app}"
    lines="${3:-200}"
    "${COMPOSE[@]}" logs --tail="$lines" --no-color --timestamps "$svc"
    ;;
  restart)
    if [ $# -lt 2 ]; then echo "service required" >&2; exit 2; fi
    "${COMPOSE[@]}" up -d --force-recreate --no-deps "$2"
    ;;
  rebuild)
    if [ $# -lt 2 ]; then echo "service required" >&2; exit 2; fi
    "${COMPOSE[@]}" build "$2" && "${COMPOSE[@]}" up -d --force-recreate --no-deps "$2"
    ;;
  start)
    if [ $# -lt 2 ]; then echo "service required" >&2; exit 2; fi
    "${COMPOSE[@]}" up -d "$2"
    ;;
  *)
    echo "usage: $0 {status|logs <svc> [lines]|restart <svc>|rebuild <svc>|start <svc>}" >&2
    exit 2
    ;;
esac