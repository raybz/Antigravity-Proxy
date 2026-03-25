# Antigravity Proxy

> macOS 透明代理注入工具 — 一键编译、签名、启动 SOCKS5/HTTP 代理注入

## 功能

基于 `DYLD_INSERT_LIBRARIES` 技术，强制 Antigravity 通过 SOCKS5/HTTP 代理通信，无需 TUN/TAP 虚拟网卡。

- 🚀 **一键启动** — 编译 → 签名 → 注入启动，全流程自动化
- ⚙️ **可视化配置** — Webview 配置页面，填写代理参数、路径设置
- 🔍 **配置校验** — 代理连通性检测、路径有效性验证
- 📊 **状态栏** — 实时显示代理运行状态
- 📋 **日志面板** — 查看详细运行日志

## 命令

| 命令 | 说明 |
|------|------|
| `Antigravity Proxy: 启动代理` | 编译+签名+注入启动完整流程 |
| `Antigravity Proxy: 停止代理` | 停止代理并清理 |
| `Antigravity Proxy: 重新编译` | 仅编译 dylib 和 relay |
| `Antigravity Proxy: 强制重签名` | Antigravity 更新后使用 |
| `Antigravity Proxy: 查看日志` | 打开日志输出面板 |
| `Antigravity Proxy: 打开配置页面` | 可视化配置界面 |

## 使用方法

1. 安装扩展后，打开命令面板 `Cmd+Shift+P`
2. 搜索 `Antigravity Proxy: 打开配置页面`
3. 填写代理地址、端口、项目路径等
4. 点击 **校验配置** 确认一切正常
5. 点击 **保存配置**
6. 使用 `Antigravity Proxy: 启动代理` 即可

## 系统要求

- macOS（需要 `DYLD_INSERT_LIBRARIES` 支持）
- Xcode Command Line Tools（`clang`）
- SOCKS5/HTTP 代理服务（如 Clash、V2Ray 等）
