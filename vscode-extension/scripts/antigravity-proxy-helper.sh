#!/bin/bash
# 特权操作聚合脚本：由 sudo 以 root 执行。域名列表须与 src/relayDomains.ts / Makefile 一致。
set -e
MARKER='# antigravity-proxy'
DOMAINS=(
  daily-cloudcode-pa.googleapis.com
  cloudcode-pa.googleapis.com
  oauth2.googleapis.com
  accounts.google.com
  www.googleapis.com
  generativelanguage.googleapis.com
  content-cloudcode-pa.googleapis.com
)
PIDF=/tmp/antigravity-relay.pid
LOGF=/tmp/antigravity-relay.log

stop_relay() {
  if [ -f "$PIDF" ]; then
    OLD="$(cat "$PIDF" 2>/dev/null || true)"
    if [ -n "$OLD" ]; then kill "$OLD" 2>/dev/null || true; fi
    rm -f "$PIDF"
  fi
}

cmd_write_hosts() {
  for d in "${DOMAINS[@]}"; do
    if ! grep -qF "$d" /etc/hosts; then
      printf '127.0.0.1 %s %s\n' "$d" "$MARKER" >> /etc/hosts
    fi
  done
}

cmd_flush_dns() {
  dscacheutil -flushcache 2>/dev/null || true
  killall -HUP mDNSResponder 2>/dev/null || true
}

cmd_start_relay() {
  relay_bin="$1"
  host="$2"
  port="$3"
  if [ ! -x "$relay_bin" ]; then
    echo "relay 不可执行: $relay_bin" >&2
    exit 1
  fi
  stop_relay
  nohup "$relay_bin" 443 "$host" "$port" >>"$LOGF" 2>&1 &
  echo $! >"$PIDF"
}

cmd_cleanup_all() {
  stop_relay
  sed -i '' '/# antigravity-proxy$/d' /etc/hosts 2>/dev/null || true
  cmd_flush_dns
}

case "${1:-}" in
  write-hosts) cmd_write_hosts ;;
  flush-dns) cmd_flush_dns ;;
  stop-relay) stop_relay ;;
  start-relay)
    shift
    cmd_start_relay "$1" "$2" "$3"
    ;;
  cleanup-all) cmd_cleanup_all ;;
  *)
    echo "用法: $0 write-hosts|flush-dns|stop-relay|start-relay <relay> <host> <port>|cleanup-all" >&2
    exit 1
    ;;
esac
