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

# 移除主应用 Info.plist 中的 Antigravity 注入键（DYLD / 代理变量等），并对可执行文件重签名（与扩展内 resign 目标一致）
# 若删完注入键后 dict 已空则一并移除 dict；若还有其他键（如 MallocNanoZone）则保留 dict 不删。
cmd_strip_lsenvironment() {
  bundle="${1:?用法: strip-lsenvironment /path/to/Antigravity.app}"
  pl="${bundle}/Contents/Info.plist"
  if [ ! -f "$pl" ]; then
    echo "缺少 Info.plist: $pl" >&2
    exit 1
  fi
  echo "[strip-lsenvironment] 移除 Antigravity 注入键 → $pl"
  for k in DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH ALL_PROXY HTTPS_PROXY HTTP_PROXY ANTIGRAVITY_CONFIG NO_PROXY FTP_PROXY; do
    /usr/libexec/PlistBuddy -c "Delete :LSEnvironment:$k" "$pl" 2>/dev/null || true
  done
  _remaining=$(/usr/libexec/PlistBuddy -c "Print :LSEnvironment" "$pl" 2>/dev/null || true)
  if [ -z "$_remaining" ] || echo "$_remaining" | grep -qE '^Dict[[:space:]]*\{[[:space:]]*\}[[:space:]]*$'; then
    /usr/libexec/PlistBuddy -c "Delete :LSEnvironment" "$pl" 2>/dev/null || true
    echo "[strip-lsenvironment] LSEnvironment dict 已清空并移除"
  else
    echo "[strip-lsenvironment] LSEnvironment 仍含非代理键，保留 dict：$_remaining"
  fi
  ent="/tmp/antigravity-proxy-strip-entitlements.$$"
  cat >"$ent" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.automation.apple-events</key><true/>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.device.camera</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
ENT
  sign_one() {
    local f="$1"
    if [ -f "$f" ]; then
      echo "[strip-lsenvironment] codesign: $f"
      codesign -f -s - --entitlements "$ent" "$f" || { rm -f "$ent"; exit 1; }
    fi
  }
  sign_one "${bundle}/Contents/MacOS/Electron"
  sign_one "${bundle}/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"
  sign_one "${bundle}/Contents/Frameworks/Antigravity Helper (GPU).app/Contents/MacOS/Antigravity Helper (GPU)"
  sign_one "${bundle}/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)"
  sign_one "${bundle}/Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)"
  shopt -s nullglob
  for f in "${bundle}/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_"*; do
    sign_one "$f"
  done
  shopt -u nullglob
  rm -f "$ent"
  echo "[strip-lsenvironment] 完成"
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
  strip-lsenvironment)
    shift
    cmd_strip_lsenvironment "$1"
    ;;
  *)
    echo "用法: $0 write-hosts|flush-dns|stop-relay|start-relay <relay> <host> <port>|cleanup-all|strip-lsenvironment <Antigravity.app>" >&2
    exit 1
    ;;
esac
