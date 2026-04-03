# Antigravity-Proxy for macOS 🚀

<p align="center">
  <a href="./README.md"><b>English</b></a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md"><b>简体中文</b></a>
</p>

<p align="center">
  <img src="vscode-extension/icon.png" width="128" alt="Antigravity Proxy Icon"/>
</p>

> 基于 `DYLD_INSERT_LIBRARIES` 的透明代理注入工具，让 Antigravity（AI 编程助手）等进程走 SOCKS5/HTTP 代理，**无需** TUN/TAP 虚拟网卡。

---

## 项目介绍

`Antigravity-Proxy` 用于解决 **Antigravity AI 编程助手无法走系统代理** 的问题。其 language server 使用 Go 原生 DNS，绕过了 macOS 系统代理与常见 Hook。本项目通过 **`/etc/hosts`**、**SNI 中继（:443）** 与 **`DYLD_INSERT_LIBRARIES` 注入** 组合处理流量。

| 层次 | 技术 | 作用 |
|------|------|------|
| DNS | `/etc/hosts` → `127.0.0.1` | Go DNS 优先读 hosts |
| 连接 | `antigravity-relay` :443 | TLS SNI → SOCKS5 |
| 注入 | `libantigravity.dylib` | Hook `connect` / `getaddrinfo` |

**痛点：** language server 不走系统代理；不想开全局 VPN；希望对单条命令临时走代理。

---

## 功能特性

- 透明劫持，注入即生效  
- dylib + SNI 中继  
- FakeIP，减轻 DNS 泄露  
- 路径检测与签名自动化  
- [VS Code 扩展](vscode-extension/README.md#readme-lang-zh) 图形界面  

> 当前脚本在关闭 Antigravity 后，**hosts / 中继可保留**（已避免「应用一退出就 cleanup 掉 hosts」的旧逻辑）。

---

## 快速开始

### VS Code 插件（推荐）

安装 `vscode-extension/antigravity-proxy-*.vsix`。扩展说明（同一文档）：[简体中文](vscode-extension/README.md#readme-lang-zh) · [English](vscode-extension/README.md#readme-lang-en)

### 命令行

**1. 环境准备**

```bash
xcode-select --install
```

**2. 配置** — 编辑 `config.yaml`：

```yaml
proxy:
  host: "127.0.0.1"
  port: 10808
  type: "socks5"   # 或 http
```

**3. 一键**

```bash
make          # 编译 → 签名 → 注入启动 Antigravity
make build
make sign
make run
```

**4. 常用**

```bash
make resign   # Antigravity 更新后
make kill
make clean
make help
```

**5. 单命令临时代理**

```bash
DYLD_INSERT_LIBRARIES=bin/libantigravity.dylib \
  ANTIGRAVITY_CONFIG=config.yaml \
  curl -v https://example.com
```

---

## 工作原理

`make run`：写入 hosts → 启动 :443 中继（读 SNI，转 SOCKS5）→ 注入 dylib 启动 Antigravity。

---

## 限制与注意事项

- **SIP：** 对受 SIP 保护的系统二进制无法注入；请使用用户目录或 Homebrew 下的副本。  
- **sudo：** 写 hosts、绑定 443、签名需要管理员权限。  
- **应用更新：** Antigravity 更新后需重新签名（`make resign` 或扩展「强制重签名」）。

---

## 项目结构

```
Antigravity-Proxy/
├── src/
├── bin/
├── config.yaml
├── Makefile
└── vscode-extension/
```

---

## 许可证

MIT — 概念参考 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy) 的 Windows 实现。
