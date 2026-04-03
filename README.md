# Antigravity-Proxy for macOS 🚀

<p align="center">
  <a href="./README.md"><b>English</b></a>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md"><b>简体中文</b></a>
</p>

<p align="center">
  <img src="vscode-extension/icon.png" width="128" alt="Antigravity Proxy Icon"/>
</p>

> Transparent proxy injection for macOS using `DYLD_INSERT_LIBRARIES`, routing Antigravity (and other processes) through SOCKS5/HTTP **without** a TUN/TAP virtual NIC.

---

## Introduction

`Antigravity-Proxy` fixes **Antigravity not respecting the system proxy**. Its language server uses Go’s DNS resolver and bypasses typical macOS proxy hooks. This project combines **`/etc/hosts`**, an **SNI relay on :443**, and **`DYLD_INSERT_LIBRARIES` injection** to steer traffic through your SOCKS5/HTTP proxy.

| Layer | Technique | Role |
|------|-----------|------|
| DNS | `/etc/hosts` → `127.0.0.1` | Go resolver reads hosts first |
| Conn | `antigravity-relay` :443 | TLS SNI → SOCKS5 |
| Injection | `libantigravity.dylib` | Hook `connect` / `getaddrinfo` |

**Pain points:** language server ignores system proxy; avoid full VPN; proxy ad‑hoc commands.

---

## Features

- Transparent hijack via injection  
- Dylib hooks + SNI relay  
- FakeIP mapping  
- Path detection & signing automation  
- [VS Code extension](vscode-extension/README.md#readme-lang-en) UI  

> With the current scripts, hosts and the relay **can persist** after you quit Antigravity (legacy `EXIT` traps that wiped hosts are removed).

---

## Quick start

### VS Code extension (recommended)

Install `vscode-extension/antigravity-proxy-*.vsix`. Extension docs (same file): [English](vscode-extension/README.md#readme-lang-en) · [简体中文](vscode-extension/README.md#readme-lang-zh).

### CLI

**1. Prerequisites**

```bash
xcode-select --install
```

**2. Configure** — edit `config.yaml`:

```yaml
proxy:
  host: "127.0.0.1"
  port: 10808
  type: "socks5"   # or http
```

**3. Run**

```bash
make          # build → sign → launch Antigravity with injection
make build
make sign
make run
```

**4. Useful targets**

```bash
make resign   # after Antigravity update
make kill
make clean
make help
```

**5. One-off command**

```bash
DYLD_INSERT_LIBRARIES=bin/libantigravity.dylib \
  ANTIGRAVITY_CONFIG=config.yaml \
  curl -v https://example.com
```

---

## How it works

`make run` writes hosts → starts the :443 relay (SNI → SOCKS5) → launches Antigravity with the dylib injected.

---

## Limits & notes

- **SIP:** injection does not apply to SIP‑protected system binaries; use copies under your home directory or Homebrew builds.  
- **sudo:** editing hosts, binding :443, and codesign require admin rights.  
- **Updates:** re-run signing after each Antigravity update (`make resign` or the extension command).

---

## Repository layout

```
Antigravity-Proxy/
├── src/
├── bin/
├── config.yaml
├── Makefile
└── vscode-extension/
```

---

## License

MIT — concept inspired by [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy) (Windows).
