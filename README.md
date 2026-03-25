# Antigravity-Proxy for macOS 🚀

基于 macOS `DYLD_INSERT_LIBRARIES` 技术的透明代理注入工具。无需 TUN/TAP 网卡模式，强制特定进程通过 SOCKS5/HTTP 代理。

项目参考自 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy) 的 Windows 实现。

---

## 📖 项目介绍

`Antigravity-Proxy` 是一款专为 macOS 打造的免虚拟网卡（TUN/TAP）强制代理工具。它通过动态库注入技术拦截进程的网络系统调用（Sockets API），实现：
- **流量劫持**: 拦截 `connect` 调用并重定向至代理。
- **DNS 劫持**: 拦截 `getaddrinfo` 并返回 FakeIP（198.18.x.x），防止 DNS 泄露并支持域名代理。

### 🎯 解决的痛点
- 某些程序不遵循系统代理设置。
- 不想开启全局 VPN 或 TUN 模式，只想针对特定进程加速。
- 需要对命令行工具（如 `curl`, `git`, `homebrew`）进行即时透明代理。

---

## ✨ 功能特性

- [x] **透明劫持**: 无需修改目标程序代码或配置。
- [x] **FakeIP 机制**: 完美支持域名级代理，绕过本地 DNS 解析限制。
- [x] **SOCKS5 支持**: 核心内置标准 SOCKS5 握手协议。
- [x] **极简架构**: 纯 C 语言编写，编译后的 `.dylib` 极小且高效。

---

## ⚠️ 环境要求与限制

### SIP (System Integrity Protection) 限制
由于 macOS 的安全机制，`DYLD_INSERT_LIBRARIES` 无法注入到受 SIP 保护的系统路径程序（如 `/bin/ls`, `/usr/bin/curl`, Safari 等）。

**解决方案**:
- 代理非系统程序（如用户安装的 Chrome, VSCode, iTerm2 等）。
- 将受保护的二进制文件拷贝到用户目录（如 `~/Desktop`）后运行。
- 在开发环境下临时关闭 SIP（不建议普通用户操作）。

---

## ⚡ 快速开始

### 1. 编译
确保已安装 `clang` (Xcode Command Line Tools):
```bash
make all
```
编译产物将位于 `bin/libantigravity.dylib`。

### 2. 使用
将代理指向您的本地 SOCKS5 服务（默认配置为 `127.0.0.1:10808`，可在 `config.yaml` 中修改）：
```bash
DYLD_INSERT_LIBRARIES=bin/libantigravity.dylib curl -v http://google.com
```

---

## 🔧 工作原理

1. **注入**: `dyld` 加载器根据环境变量将 `libantigravity.dylib` 插入到目标进程。
2. **Hook**: 利用符号拦截机制，在程序调用 `getaddrinfo` 时，我们记录映射并返回一个 `198.18.x.x` 的假 IP。
3. **重定向**: 当程序尝试 `connect` 该假 IP 时，我们拦截该请求，先连接到真正的代理服务器，发送 SOCKS5 握手指令，成功后再开始数据传输。

---

## 📄 许可证
本项目采用 MIT 许可证。
