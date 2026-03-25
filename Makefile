CC      = clang
CFLAGS  = -Wall -Wextra -O2 -fPIC
LDFLAGS = -dynamiclib -ldl -lpthread

TARGET     = bin/libantigravity.dylib
RELAY      = bin/antigravity-relay
SIGN_STAMP = bin/.sign_stamp
SRC        = src/libantigravity.c
CONFIG     = $(shell pwd)/config.yaml

RELAY_PORT  = 44300
PF_ANCHOR   = antigravity_proxy

# 需要写入 /etc/hosts 的 googleapis 域名（language_server 用 Go 原生 DNS，
# 不经过 libc getaddrinfo hook，但 Go DNS 解析器会优先读 /etc/hosts）
RELAY_DOMAINS = \
	daily-cloudcode-pa.googleapis.com \
	cloudcode-pa.googleapis.com \
	oauth2.googleapis.com \
	accounts.google.com \
	www.googleapis.com \
	generativelanguage.googleapis.com \
	content-cloudcode-pa.googleapis.com

# ── 读取代理配置 ──────────────────────────────────────────────────────
PROXY_HOST := $(shell grep -A5 'proxy:' "$(CONFIG)" | grep 'host:' | head -1 | awk '{print $$2}' | tr -d '"')
PROXY_PORT := $(shell grep -A5 'proxy:' "$(CONFIG)" | grep 'port:' | head -1 | awk '{print $$2}')
PROXY_TYPE := $(shell grep -A5 'proxy:' "$(CONFIG)" | grep 'type:' | head -1 | awk '{print $$2}' | tr -d '"')
ALL_PROXY_VAL := $(PROXY_TYPE)://$(PROXY_HOST):$(PROXY_PORT)

# ── 自动定位 Antigravity ──────────────────────────────────────────────
ANTIGRAVITY_APP ?= $(or \
	$(shell [ -f "/Applications/Antigravity.app/Contents/MacOS/Electron" ] && echo "/Applications/Antigravity.app/Contents/MacOS/Electron"), \
	$(shell [ -f "$(HOME)/Applications/Antigravity.app/Contents/MacOS/Electron" ] && echo "$(HOME)/Applications/Antigravity.app/Contents/MacOS/Electron"))

ANTIGRAVITY_BUNDLE := $(patsubst %/Contents/MacOS/Electron,%,$(ANTIGRAVITY_APP))

ENTITLEMENTS = /tmp/antigravity_inject_entitlements.plist

# 所有需要重签名的可执行文件（Helper variants + AI Go binary）
SIGN_TARGETS = \
	"$(ANTIGRAVITY_APP)" \
	"$(ANTIGRAVITY_BUNDLE)/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper" \
	"$(ANTIGRAVITY_BUNDLE)/Contents/Frameworks/Antigravity Helper (GPU).app/Contents/MacOS/Antigravity Helper (GPU)" \
	"$(ANTIGRAVITY_BUNDLE)/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)" \
	"$(ANTIGRAVITY_BUNDLE)/Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)" \
	"$(ANTIGRAVITY_BUNDLE)/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"

# ────────────────────────────────────────────────────────────────────
.PHONY: all build sign resign run kill clean help

## 默认目标：编译 + 签名 + 注入启动
all: run

# ── 编译 dylib ────────────────────────────────────────────────────────
build: $(TARGET) $(RELAY)

$(TARGET): $(SRC) src/fakeip.h src/socks5.h src/config.h
	@mkdir -p bin
	@printf '\033[34m[1/4] 编译 libantigravity.dylib ...\033[0m\n'
	@$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $<
	@codesign -f -s - $@
	@printf '\033[32m      ✓ 编译并自签完成\033[0m\n'

# ── 编译透明代理中继 ──────────────────────────────────────────────────
$(RELAY): src/relay.c
	@mkdir -p bin
	@printf '\033[34m      编译 antigravity-relay ...\033[0m\n'
	@$(CC) -Wall -Wextra -O2 -pthread -o $@ $<
	@printf '\033[32m      ✓ 中继编译完成\033[0m\n'

# ── 签名（检测到已有权限则跳过）─────────────────────────────────────
$(SIGN_STAMP): $(TARGET)
	@if [ -z "$(ANTIGRAVITY_APP)" ]; then \
		printf '\033[31m[错误] 未找到 Antigravity\033[0m\n'; exit 1; \
	fi
	@LS_BIN="$(ANTIGRAVITY_BUNDLE)/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"; \
	if codesign -d --entitlements - "$$LS_BIN" 2>/dev/null \
		| grep -q "allow-dyld-environment-variables"; then \
		printf '\033[90m[2/4] 所有签名权限已存在，跳过重签\033[0m\n'; \
		touch $@; \
	else \
		$(MAKE) _do_sign; \
	fi

_do_sign:
	@printf '\033[34m[2/4] 写入 LSEnvironment 并重签名（需要 sudo 密码）...\033[0m\n'
	@printf '<?xml version="1.0" encoding="UTF-8"?>\n\
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"\n\
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n\
<plist version="1.0"><dict>\n\
  <key>com.apple.security.automation.apple-events</key><true/>\n\
  <key>com.apple.security.cs.allow-jit</key><true/>\n\
  <key>com.apple.security.device.audio-input</key><true/>\n\
  <key>com.apple.security.device.camera</key><true/>\n\
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>\n\
  <key>com.apple.security.cs.disable-library-validation</key><true/>\n\
</dict></plist>\n' > $(ENTITLEMENTS)
	@BUNDLE="$(ANTIGRAVITY_BUNDLE)"; \
	DYLIB="$(shell pwd)/$(TARGET)"; \
	CFG="$(CONFIG)"; \
	PROXY="$(ALL_PROXY_VAL)"; \
	PLIST="$$BUNDLE/Contents/Info.plist"; \
	printf '\033[90m      写入 LSEnvironment → %s\033[0m\n' "$$PLIST"; \
	sudo /usr/libexec/PlistBuddy -c "Delete :LSEnvironment" "$$PLIST" 2>/dev/null || true; \
	sudo /usr/libexec/PlistBuddy \
	  -c "Add :LSEnvironment dict" \
	  -c "Add :LSEnvironment:DYLD_INSERT_LIBRARIES string $$DYLIB" \
	  -c "Add :LSEnvironment:ALL_PROXY string $$PROXY" \
	  -c "Add :LSEnvironment:HTTPS_PROXY string $$PROXY" \
	  -c "Add :LSEnvironment:HTTP_PROXY string $$PROXY" \
	  -c "Add :LSEnvironment:ANTIGRAVITY_CONFIG string $$CFG" \
	  "$$PLIST" || { printf '\033[31m      ✗ LSEnvironment 写入失败\033[0m\n'; exit 1; }; \
	printf '\033[32m      ✓ LSEnvironment 写入完成\033[0m\n'
	@BUNDLE="$(ANTIGRAVITY_BUNDLE)"; \
	sign_one() { \
		if [ -f "$$1" ]; then \
			printf '\033[90m      签名: %s\033[0m\n' "$$1"; \
			sudo codesign -f -s - --entitlements $(ENTITLEMENTS) "$$1" || { \
				printf '\033[31m      ✗ 签名失败: %s\033[0m\n' "$$1"; exit 1; }; \
		fi; \
	}; \
	sign_one "$$BUNDLE/Contents/MacOS/Electron"; \
	sign_one "$$BUNDLE/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"; \
	sign_one "$$BUNDLE/Contents/Frameworks/Antigravity Helper (GPU).app/Contents/MacOS/Antigravity Helper (GPU)"; \
	sign_one "$$BUNDLE/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)"; \
	sign_one "$$BUNDLE/Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)"; \
	sign_one "$$BUNDLE/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"
	@printf '\033[32m      ✓ 全部签名完成\033[0m\n'
	@mkdir -p bin && touch $(SIGN_STAMP)

sign: $(SIGN_STAMP)

## 强制重新签名（Antigravity 更新后使用）
resign:
	@rm -f $(SIGN_STAMP)
	@$(MAKE) _do_sign

# ── 关闭已运行的 Antigravity ─────────────────────────────────────────
kill:
	@if pgrep -f "Antigravity.app" > /dev/null 2>&1 || pgrep -f "language_server_macos_arm" > /dev/null 2>&1; then \
		printf '\033[33m[3/4] 正在关闭已运行的 Antigravity ...\033[0m\n'; \
		pkill -f "Antigravity.app" 2>/dev/null || true; \
		pkill -f "language_server_macos_arm" 2>/dev/null || true; \
		sleep 2; \
		pkill -9 -f "Antigravity.app" 2>/dev/null || true; \
		pkill -9 -f "language_server_macos_arm" 2>/dev/null || true; \
		sleep 1; \
		printf '\033[32m      ✓ 已关闭\033[0m\n'; \
	else \
		printf '\033[90m[3/4] Antigravity 未运行，跳过\033[0m\n'; \
	fi

# ── 启动 ─────────────────────────────────────────────────────────────
#
# 透明代理方案：
#   1. 写入 /etc/hosts：googleapis 域名 → 127.0.0.1
#      （language_server 用 Go 原生 DNS，Go DNS 解析器会先读 /etc/hosts）
#   2. 在端口 443 启动 SNI 中继（需要 sudo 绑定特权端口）
#   3. language_server 连接 127.0.0.1:443 → 中继读 TLS SNI → SOCKS5 → 10808
#   4. 退出时自动清理 /etc/hosts 并刷新 DNS 缓存
#
run: $(TARGET) $(RELAY) $(SIGN_STAMP) kill
	@printf '\033[34m[4/4] 注入启动 Antigravity ...\033[0m\n'
	@printf '\033[90m      代理: %s\033[0m\n' "$(ALL_PROXY_VAL)"
	@printf '\033[90m      DYLD: %s\033[0m\n' "$(shell pwd)/$(TARGET)"
	@printf '\033[90m      中继: sudo relay on 127.0.0.1:443 → SOCKS5\033[0m\n'
	@printf '\033[90m      日志: /tmp/antigravity-proxy.log\033[0m\n'
	@printf '\033[33m      （需要 sudo 密码以绑定端口 443）\033[0m\n\n'
	@> /tmp/antigravity-proxy.log; > /tmp/antigravity-relay.log
	@RELAY_BIN="$(shell pwd)/$(RELAY)"; \
	PROXY_HOST="$(PROXY_HOST)"; \
	PROXY_PORT="$(PROXY_PORT)"; \
	DYLIB="$(shell pwd)/$(TARGET)"; \
	CONFIG="$(CONFIG)"; \
	ALL_PROXY="$(ALL_PROXY_VAL)"; \
	ANTIGRAVITY="$(ANTIGRAVITY_APP)"; \
	DOMAINS="$(RELAY_DOMAINS)"; \
	\
	cleanup() { \
		printf '\n\033[90m      停止中继...\033[0m\n'; \
		RPID=$$(cat /tmp/antigravity-relay.pid 2>/dev/null); \
		[ -n "$$RPID" ] && sudo kill "$$RPID" 2>/dev/null; \
		rm -f /tmp/antigravity-relay.pid; \
		printf '\033[90m      恢复 /etc/hosts ...\033[0m\n'; \
		sudo sed -i '' '/# antigravity-proxy$$/d' /etc/hosts 2>/dev/null; \
		sudo dscacheutil -flushcache 2>/dev/null; \
		sudo killall -HUP mDNSResponder 2>/dev/null; \
	}; \
	trap cleanup EXIT INT TERM; \
	\
	printf '\033[90m      写入 /etc/hosts（Go DNS 解析器优先读此文件）...\033[0m\n'; \
	for DOMAIN in $$DOMAINS; do \
		grep -qF "$$DOMAIN" /etc/hosts 2>/dev/null || \
			printf '127.0.0.1 %s # antigravity-proxy\n' "$$DOMAIN" \
			| sudo tee -a /etc/hosts > /dev/null; \
	done; \
	sudo dscacheutil -flushcache 2>/dev/null; \
	sudo killall -HUP mDNSResponder 2>/dev/null; \
	printf '\033[32m      ✓ /etc/hosts 已写入，DNS 缓存已刷新\033[0m\n'; \
	\
	printf '\033[90m      启动中继（sudo，端口 443）...\033[0m\n'; \
	sudo "$$RELAY_BIN" 443 "$$PROXY_HOST" "$$PROXY_PORT" >> /tmp/antigravity-relay.log 2>&1 & \
	RELAY_PID=$$!; \
	echo $$RELAY_PID > /tmp/antigravity-relay.pid; \
	sleep 0.5; \
	if ! sudo kill -0 $$RELAY_PID 2>/dev/null; then \
		printf '\033[31m      ✗ 中继启动失败，查看 /tmp/antigravity-relay.log\033[0m\n'; \
		cat /tmp/antigravity-relay.log; \
		exit 1; \
	fi; \
	printf '\033[32m      ✓ 中继运行中 (pid=%d, port=443)\033[0m\n\n' "$$RELAY_PID"; \
	\
	DYLD_INSERT_LIBRARIES="$$DYLIB" \
	ANTIGRAVITY_CONFIG="$$CONFIG" \
	ALL_PROXY="$$ALL_PROXY" \
	HTTPS_PROXY="$$ALL_PROXY" \
	HTTP_PROXY="$$ALL_PROXY" \
	"$$ANTIGRAVITY"

# ── 清理 ─────────────────────────────────────────────────────────────
clean:
	rm -rf bin/

# ── 帮助 ─────────────────────────────────────────────────────────────
help:
	@printf '\033[1m用法：\033[0m\n'
	@printf '  make          完整流程（编译→签名→关闭旧实例→注入启动）\n'
	@printf '  make build    仅编译（dylib + relay）\n'
	@printf '  make sign     仅签名（已有权限自动跳过）\n'
	@printf '  make resign   强制重新签名（Antigravity 更新后用）\n'
	@printf '  make kill     关闭当前运行的 Antigravity\n'
	@printf '  make clean    删除编译产物\n'
	@printf '\n\033[1m检测到的路径：\033[0m\n'
	@printf '  Antigravity: %s\n' "$(ANTIGRAVITY_APP)"
	@printf '  代理:        %s\n' "$(ALL_PROXY_VAL)"
	@printf '\n\033[1m透明代理说明：\033[0m\n'
	@printf '  make run 先写 /etc/hosts（Go DNS 先读此文件），再 sudo 启动 SNI 中继 :443\n'
	@printf '  googleapis 流量: 127.0.0.1:443 → 中继读 TLS SNI → SOCKS5:10808\n'
	@printf '  退出时自动清理 /etc/hosts 并刷新 DNS 缓存\n'
