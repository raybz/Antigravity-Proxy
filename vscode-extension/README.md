<p align="center">
  <a href="#readme-lang-en"><b>English</b></a>
  &nbsp;·&nbsp;
  <a href="#readme-lang-zh"><b>简体中文</b></a>
</p>

<p align="center"><sub>VS Code / Cursor 扩展详情只会渲染本文件；跳转「另一个 .md」无效，请用上方锚点在本页内切换。<br/>
The Extensions panel only previews this file; links to <code>README.zh-CN.md</code> don’t open — use the anchors above.</sub></p>

<h1 align="center">Antigravity Proxy</h1>

---

<a id="readme-lang-en"></a>

## English

<p align="center">macOS transparent proxy injection — UI configuration & one-click launch for Antigravity behind your proxy</p>

### Why this exists

Antigravity’s language server uses Go’s DNS stack and **does not follow the system proxy**. This extension automates `/etc/hosts`, the SNI relay, `DYLD_INSERT_LIBRARIES` injection, and codesigning inside VS Code / Cursor.

### Features

| Feature | Description |
|--------|-------------|
| Start / stop | Full proxy + Antigravity flow |
| Webview | Settings, validation, collapsible diagnostics |
| Status bar | Green only when full health check passes |
| Passwordless helper | Optional sudo helper under `/usr/local/bin` |
| Quiet UI | Hidden terminal when helper is installed |
| Auto prepare | Optional auto “Prepare hosts/relay” on activation |

### Quick start

**1. Install** — `Cmd+Shift+P` → **Extensions: Install from VSIX...** → choose `antigravity-proxy-*.vsix`.

**2. Configure** — Command palette → **Antigravity Proxy: ⚙️ 打开配置页面** → set proxy (and optional app path) → **Validate** → **Save**. Use **Diagnostics** (collapsible) on that page.

| Key | Default | Notes |
|-----|---------|------|
| Host | `127.0.0.1` | |
| Port | `10808` | Clash often `7890` |
| Type | `socks5` | or `http` |
| App path | auto | Empty searches `/Applications` |

**3. Launch** — **Antigravity Proxy: 🚀 启动代理**. Without the helper you’ll type `sudo` in the terminal; with the helper, privileged steps can run in a **hidden** terminal.

> Passwordless mode **only skips passwords**; use **Auto prepare hosts/relay** (needs helper) or **Prepare privileged environment**.

### Commands

| Palette title | What it does |
|----------------|--------------|
| 🚀 启动代理 | Start flow |
| ⏹ 停止代理 | Stop, clean hosts + relay |
| 🔑 强制重签名 | After app update |
| 📋 查看日志 | Output channel |
| ⚙️ 打开配置页面 | Webview |
| 📊 环境诊断与状态 | Diagnostics |
| 🔧 准备特权环境 | hosts + relay |
| 🔐 安装免密 sudo | Install helper |

### Settings (`settings.json`)

```jsonc
{
  "antigravity-proxy.proxyHost": "127.0.0.1",
  "antigravity-proxy.proxyPort": 10808,
  "antigravity-proxy.proxyType": "socks5",
  "antigravity-proxy.timeout": 5000,
  "antigravity-proxy.antigravityAppPath": "",
  "antigravity-proxy.autoStart": false,
  "antigravity-proxy.autoPrepareHostsRelay": true
}
```

`autoPrepareHostsRelay`: if the helper is installed and **`autoStart` is off`, the extension runs **Prepare privileged environment** ~2s after activation when hosts/relay are missing.

### FAQ

- **Still can’t connect?** Run **Re-sign**; Antigravity updates break the signature.  
- **App not found?** Set the `.app` path in settings.  
- **DNS odd after stop?** Extension cleans hosts + flushes DNS; you can run `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`.  
- **Password every time?** Install the one-shot passwordless helper; you still need the prepare step (can be automatic).  

### Requirements

macOS · Xcode Command Line Tools · local SOCKS5/HTTP proxy · Antigravity installed.

<p align="center"><a href="#readme-lang-zh"><b>→ 简体中文</b></a></p>

---

<a id="readme-lang-zh"></a>

## 简体中文

<p align="center">macOS 透明代理注入 — 图形化配置与一键启动 Antigravity 走代理</p>

### 为什么需要

Antigravity 的 language server 使用 Go 原生 DNS，**不会遵循系统代理**。本扩展把写 `/etc/hosts`、启动 SNI 中继、`DYLD_INSERT_LIBRARIES` 注入与签名集中进 VS Code / Cursor。

### 功能一览

| 功能 | 说明 |
|------|------|
| 一键启动 / 停止 | 完整代理与 Antigravity 流程 |
| Webview 配置 | 校验、保存、可折叠环境诊断 |
| 状态栏 | 全项检测通过才显示绿色 |
| 免密 sudo（可选） | 固定路径 helper，减少输密码 |
| 后台终端 | 已装 helper 时不抢焦点弹终端 |
| 自动准备 hosts/中继 | 可关，依赖免密 helper |

### 快速开始

**1. 安装** — `Cmd+Shift+P` → **Extensions: Install from VSIX...** → 选择 `antigravity-proxy-*.vsix`。

**2. 配置** — 命令面板 → **Antigravity Proxy: ⚙️ 打开配置页面** → 填写代理与（可选）App 路径 → **校验配置** → **保存配置**。在「环境与流程」可 **检测** 诊断，并用 **收起/展开** 控制长列表。

| 参数 | 默认 | 说明 |
|------|------|------|
| 代理地址 | `127.0.0.1` | |
| 端口 | `10808` | Clash 常见 7890 |
| 类型 | `socks5` | 或 `http` |
| App 路径 | 自动检测 | 留空搜 `/Applications` |

**3. 启动** — **Antigravity Proxy: 🚀 启动代理**。未装免密 helper 时需在终端输入 `sudo`；装好后多为**后台终端**，少打扰。

> 免密 **只省略密码**，不会自动写 hosts；可开 **自动准备 hosts/中继**（须先装 helper），或手动 **准备特权环境**。

### 命令列表

| 命令（命令面板显示） | 作用 |
|----------------------|------|
| 🚀 启动代理 | 完整启动 |
| ⏹ 停止代理 | 停止并清理 hosts / 中继 |
| 🔑 强制重签名 | 应用更新后 |
| 📋 查看日志 | 输出通道 |
| ⚙️ 打开配置页面 | 配置 Webview |
| 📊 环境诊断与状态 | 诊断面板 |
| 🔧 准备特权环境 | 写 hosts + 起中继 |
| 🔐 安装免密 sudo | 安装 helper |

### VS Code 设置（`settings.json`）

```jsonc
{
  "antigravity-proxy.proxyHost": "127.0.0.1",
  "antigravity-proxy.proxyPort": 10808,
  "antigravity-proxy.proxyType": "socks5",
  "antigravity-proxy.timeout": 5000,
  "antigravity-proxy.antigravityAppPath": "",
  "antigravity-proxy.autoStart": false,
  "antigravity-proxy.autoPrepareHostsRelay": true
}
```

`autoPrepareHostsRelay`：**已装免密 helper** 且 **未** 开启 `autoStart` 时，若 hosts/中继未就绪，扩展激活后约 2 秒自动执行「准备特权环境」（后台终端）。

### 常见问题

- **启动后仍连不上？** 执行「强制重签名」；Antigravity 更新会覆盖签名。  
- **找不到 Antigravity？** 在配置里填写 `.app` 路径。  
- **停止后 DNS 异常？** 扩展会清理 hosts 并刷新 DNS；可手动 `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`。  
- **每次都要 sudo？** 安装「一次性安装免密 sudo」；写 hosts / 起中继仍要走准备流程（可自动）。  

### 系统要求

macOS · Xcode Command Line Tools · 本地 SOCKS5/HTTP 代理 · 已安装 Antigravity。

<p align="center"><a href="#readme-lang-en"><b>→ English</b></a></p>

---

## License / 许可证

MIT
