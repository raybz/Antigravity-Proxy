# Antigravity-Proxy for macOS 🚀

> 基于 `DYLD_INSERT_LIBRARIES` 的透明代理注入工具，强制让 Antigravity（AI 编程助手）及其他进程走 SOCKS5/HTTP 代理——无需 TUN/TAP 虚拟网卡。

<p align="center">
  <img src="vscode-extension/icon.png" width="128" alt="Antigravity Proxy Icon"/>
</p>

---

## 📖 项目介绍

`Antigravity-Proxy` 专为解决 **Antigravity AI 编程助手无法走系统代理** 的问题而生。

Antigravity 的 language server 使用 Go 原生 DNS 解析，绕过了 macOS 系统代理和 `getaddrinfo` Hook，导致常规代理方案失效。本项目通过以下双重机制彻底解决这一问题：

| 层次 | 技术 | 解决的问题 |
|------|------|------------|
| **DNS 层** | 写入 `/etc/hosts`，将 googleapis 域名指向 `127.0.0.1` | Go DNS 解析器优先读 `/etc/hosts`，绕过 getaddrinfo hook 的限制 |
| **连接层** | 启动 SNI 中继（`antigravity-relay`）监听 `:443` | 识别 TLS SNI → 转发至 SOCKS5 代理 |
| **注入层** | `DYLD_INSERT_LIBRARIES` 注入 `libantigravity.dylib` | 拦截其他进程的 `connect`/`getaddrinfo` 调用，实现透明代理 |

### 解决的痛点

- 🤖 Antigravity language server 不走系统代理，无法访问 Google AI 服务
- 🧩 某些程序忽略系统代理设置，但又不想开全局 VPN/TUN 模式
- ⚡ 需要对特定进程（`curl`、`git`、Homebrew 等）即时开启透明代理

---

## ✨ 功能特性

- **透明劫持** — 无需修改目标程序，注入即生效
- **双重代理方案** — dylib Hook + SNI 中继，应对不同类型的网络请求
- **FakeIP 机制** — 记录域名→IP映射，防止 DNS 泄露
- **全自动签名** — 自动检测 Antigravity 路径，写入权限并重签名
- **自动清理** — 退出时自动清理 `/etc/hosts`、刷新 DNS 缓存、关闭中继
- **VS Code 插件** — 图形化配置与一键控制，无需敲命令行

---

## ⚡ 快速开始

### 方式一：VS Code 插件（推荐）

安装 `vscode-extension/antigravity-proxy-*.vsix`，通过图形界面一键操作。详见 → [插件 README](vscode-extension/README.md)

### 方式二：命令行

#### 1. 环境准备

```bash
# 需要 Xcode Command Line Tools
xcode-select --install
```

#### 2. 配置代理

编辑 `config.yaml`：

```yaml
proxy:
  host: "127.0.0.1"
  port: 10808        # 改为你的代理端口
  type: "socks5"     # socks5 或 http
```

#### 3. 一键启动

```bash
# 完整流程：编译 → 签名 → 注入启动 Antigravity
make

# 或分步执行：
make build   # 仅编译 dylib 和 relay
make sign    # 仅签名（已签则自动跳过）
make run     # 启动代理并注入
```

#### 4. 常用命令

```bash
make resign  # Antigravity 更新后强制重签名
make kill    # 关闭当前运行的 Antigravity
make clean   # 删除编译产物
make help    # 查看所有命令说明
```

#### 5. 临时代理任意进程

```bash
# 不启动 Antigravity，只对单个命令生效
DYLD_INSERT_LIBRARIES=bin/libantigravity.dylib \
  ANTIGRAVITY_CONFIG=config.yaml \
  curl -v https://example.com
```

---

## 🔧 工作原理

```
Antigravity 启动流程：

  [make run]
     │
     ├─① 写入 /etc/hosts → googleapis.com → 127.0.0.1
     │   （Go DNS 解析器优先读 /etc/hosts）
     │
     ├─② sudo 启动 antigravity-relay（监听 :443）
     │     接收到连接 → 读 TLS ClientHello 提取 SNI
     │     → 连接 SOCKS5 代理 → 建立隧道
     │
     └─③ 注入 libantigravity.dylib 启动 Antigravity
           ┌─ getaddrinfo Hook → 返回 FakeIP（198.18.x.x）
           └─ connect Hook → 检测 FakeIP → 转发至 SOCKS5 代理
```

---

## ⚠️ 限制与注意事项

### SIP 保护限制

`DYLD_INSERT_LIBRARIES` 对受 SIP 保护的系统二进制（`/bin/ls`、`/usr/bin/curl` 等）无效。

**解决方案**：将需要代理的系统工具拷贝到非系统路径（如 `~/bin/`）后运行，或使用 Homebrew 版本。

### 签名需要 sudo

写入 `/etc/hosts`、绑定 `:443` 端口、重签名 Antigravity 均需要 `sudo` 权限。

### Antigravity 更新后需重签

每次 Antigravity 自动更新后，签名会被覆盖，需执行 `make resign`（或点击插件中的"强制重签名"）。

---

## 📁 项目结构

```
Antigravity-Proxy/
├── src/
│   ├── libantigravity.c   # 核心注入库（Hook connect/getaddrinfo）
│   ├── relay.c            # SNI 中继（端口 443 → SOCKS5）
│   ├── fakeip.h           # FakeIP 映射表
│   ├── socks5.h           # SOCKS5 握手协议实现
│   └── config.h           # 配置文件解析（YAML）
├── bin/                   # 编译产物
│   ├── libantigravity.dylib
│   └── antigravity-relay
├── config.yaml            # 代理配置文件
├── Makefile               # 构建与运行脚本
└── vscode-extension/      # VS Code 插件
```

---

## 📄 许可证

MIT License — 参考自 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy) 的 Windows 实现。
