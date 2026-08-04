#!/bin/bash
# ============================================================================
# Polit Empire — firewall против прямых DDoS на ВДС (144.31.0.116).
# ----------------------------------------------------------------------------
# Проблема: бот-сеть (16k+ IP/мин) била напрямую по IP ВДС мимо фронта и CF —
# per-IP лимиты nginx бесполезны (каждый IP шлёт 1-5 запросов), глобальный
# лимит выедался флудом и резал легитимку (429 везде).
#
# Решение: на уровне ядра принимаем на :80/:443 ТОЛЬКО:
#   • 127.0.0.1 (локально, docker healthchecks)
#   • 85.192.56.40 — фронт (через него идёт весь трафик politempire.ru/gml)
#   • диапазоны Cloudflare (через них идёт politempire.org и любой CF-прокси)
# Всё остальное на :80/:443 — DROP до nginx.
#
# SSH (:22) не трогаем — остаётся открытым.
# Правила переживают перезагрузку через netfilter-persistent:
#   netfilter-persistent save
# ============================================================================

set -e

CF_V4="173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22"
CF_V6="2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32"

FRONT_IP="85.192.56.40"

# Ранее забаненные IP (существовали до этого скрипта).
BANNED="103.160.205.208 131.222.249.40 185.220.101.174 153.80.240.37 91.200.161.250 212.112.121.130 194.127.199.17 209.50.186.14 185.239.50.122 2.78.60.10"

# --- IPv4 ---------------------------------------------------------------
iptables -F INPUT
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports 80,443 -s "$FRONT_IP" -j ACCEPT
# Docker-сеть: контейнеры (GmlBackend, bots) ходят на сайт напрямую по IP
# (в /etc/hosts контейнера politempire.org → 144.31.0.116) для /api/gml/auth.
iptables -A INPUT -p tcp -m multiport --dports 80,443 -s 172.16.0.0/12 -j ACCEPT
for r in $CF_V4; do
    iptables -A INPUT -p tcp -m multiport --dports 80,443 -s "$r" -j ACCEPT
done
iptables -A INPUT -p tcp -m multiport --dports 80,443 -j DROP
for ip in $BANNED; do
    iptables -A INPUT -s "$ip" -j DROP
done

# --- IPv6 ---------------------------------------------------------------
ip6tables -F INPUT
ip6tables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A INPUT -s ::1 -j ACCEPT
# Docker-сеть IPv6 (если используется)
ip6tables -A INPUT -p tcp -m multiport --dports 80,443 -s fd00::/8 -j ACCEPT
for r in $CF_V6; do
    ip6tables -A INPUT -p tcp -m multiport --dports 80,443 -s "$r" -j ACCEPT
done
ip6tables -A INPUT -p tcp -m multiport --dports 80,443 -j DROP

echo "OK: :80/:443 принимаются только с $FRONT_IP и Cloudflare; остальное DROP."
echo "Сохранить на перезагрузку: netfilter-persistent save"
