<p align="center">
  <img src="icon.png" width="96" alt="Antigravity Proxy"/>
</p>

<h1 align="center">Antigravity Proxy</h1>
<p align="center">macOS 透明代理注入工具 — 让 Antigravity 无感走代理，一键操作，无需命令行</p>

---

## 为什么需要这个插件？

Antigravity AI 编程助手的 language server 使用 Go 原生 DNS，**绕过了系统代理设置**，导致无法访问 Google AI 服务。本插件将整套注入流程（编译 dylib → 签名 → 写 `/etc/hosts` → 启动 SNI 中继 → 注入启动 Antigravity）封装进 VS Code，提供图形化界面和一键控制。

---

## ✨ 功能一览

| 功能 | 说明 |
|------|------|
| 🚀 **一键启动** | 自动完成编译、签名、中继启动、注入全流程 |
| ⚙️ **可视化配置** | Webview 页面填写代理参数，实时校验连通性 |
| 🔍 **配置校验** | 代理连通性检测 + 路径有效性验证 |
| 📊 **状态栏** | 实时显示代理运行状态（运行中 / 已停止） |
| 📋 **日志面板** | 查看详细运行日志，快速定位问题 |
| 🔑 **重签名** | Antigravity 更新后一键重签，无需手动操作 |

---

## 🚀 快速开始

### 1. 安装插件

在 VS Code 中安装 `.vsix` 文件：

```
Cmd+Shift+P → Extensions: Install from VSIX...
```

选择 `antigravity-proxy-*.vsix` 完成安装。

### 2. 配置代理

打开命令面板（`Cmd+Shift+P`），搜索并执行：

```
Antigravity Proxy: ⚙️ 打开配置页面
```

在配置界面填写：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 代理地址 | `127.0.0.1` | SOCKS5/HTTP 代理服务器地址 |
| 代理端口 | `10808` | 代理端口（Clash 默认 7890，V2Ray 默认 10808） |
| 代理类型 | `socks5` | 支持 `socks5` / `http` |
| Antigravity 路径 | 自动检测 | 留空自动在 `/Applications` 和 `~/Applications` 查找 |
| 超时时间 | `5000ms` | 连接超时（毫秒） |

点击 **校验配置** 确认代理可达，再点击 **保存配置**。

### 3. 启动代理

```
Cmd+Shift+P → Antigravity Proxy: 🚀 启动代理
```

> ⚠️ 启动过程中会弹出 sudo 密码提示（用于写入 `/etc/hosts`、绑定 `:443` 端口、重签名）。这是一次性操作，签名后除非 Antigravity 更新否则不再需要。

启动成功后，状态栏会显示 `$(rocket) 代理运行中`，Antigravity 的所有网络请求将自动走代理。

---

## 📋 命令列表

| 命令 | 说明 |
|------|------|
| `Antigravity Proxy: 🚀 启动代理` | 完整启动流程（编译→签名→注入） |
| `Antigravity Proxy: ⏹ 停止代理` | 停止代理，清理 hosts 和中继 |
| `Antigravity Proxy: 🔑 强制重签名` | Antigravity 更新后执行此命令 |
| `Antigravity Proxy: 📋 查看日志` | 打开输出日志面板 |
| `Antigravity Proxy: ⚙️ 打开配置页面` | 可视化配置界面 |

---

## ⚙️ VS Code 设置

也可以直接在 VS Code 设置（`settings.json`）中配置：

```jsonc
{
  "antigravity-proxy.proxyHost": "127.0.0.1",
  "antigravity-proxy.proxyPort": 10808,
  "antigravity-proxy.proxyType": "socks5",        // "socks5" 或 "http"
  "antigravity-proxy.timeout": 5000,               // 毫秒
  "antigravity-proxy.antigravityAppPath": "",      // 留空自动检测
  "antigravity-proxy.autoStart": false             // 是否随 VS Code 启动自动开启代理
}
```

---

## ❓ 常见问题

**Q：启动后 Antigravity 还是连不上？**

执行 `Antigravity Proxy: 🔑 强制重签名` 后重试。若 Antigravity 刚更新过，签名会被覆盖，需重新签名。

**Q：提示找不到 Antigravity？**

在配置页面手动填写 Antigravity 的安装路径（如 `/Applications/Antigravity.app`）。

**Q：停止代理后 DNS 解析异常？**

停止时会自动清理 `/etc/hosts` 并刷新 DNS 缓存。如有异常可手动执行：`sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`

**Q：每次都要输 sudo 密码？**

只有**首次签名**需要。签名完成后，后续启动无需再次签名（除非 Antigravity 更新）。

---

## 系统要求

- macOS（Apple Silicon 或 Intel）
- Xcode Command Line Tools（提供 `clang`、`codesign`）
- 可用的 SOCKS5 或 HTTP 代理服务（如 Clash、V2Ray、Singbox 等）
- 已安装 Antigravity AI 编程助手

---

## 许可证

MIT
