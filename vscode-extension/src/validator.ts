import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { log, logError, logSuccess } from './logger';
import { ProxyConfig } from './configManager';

export interface ValidationResult {
    field: string;
    valid: boolean;
    message: string;
}

/**
 * 校验代理连通性：尝试 TCP 连接 host:port
 */
export async function validateProxyConnection(
    host: string,
    port: number,
    timeoutMs: number = 3000
): Promise<ValidationResult> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = Math.min(Math.max(timeoutMs, 500), 60000);

        socket.setTimeout(timeout);

        socket.on('connect', () => {
            socket.destroy();
            logSuccess(`代理连通性检测通过: ${host}:${port}`);
            resolve({ field: 'proxy', valid: true, message: `✅ 代理 ${host}:${port} TCP 连通` });
        });

        socket.on('timeout', () => {
            socket.destroy();
            logError(`代理连接超时: ${host}:${port}`);
            resolve({ field: 'proxy', valid: false, message: `❌ 连接超时 (${timeout}ms)` });
        });

        socket.on('error', (err) => {
            socket.destroy();
            logError(`代理连接失败: ${err.message}`);
            resolve({ field: 'proxy', valid: false, message: `❌ 连接失败: ${err.message}` });
        });

        socket.connect(port, host);
    });
}

/**
 * SOCKS5 无认证握手：发送 VER/NMETHODS，期望 0x05 0x00
 */
export async function validateSocks5Handshake(
    host: string,
    port: number,
    timeoutMs: number = 3000
): Promise<ValidationResult> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = Math.min(Math.max(timeoutMs, 500), 60000);
        let settled = false;

        const finish = (valid: boolean, message: string) => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                socket.destroy();
            } catch {
                /* ignore */
            }
            resolve({ field: 'proxy_socks5', valid, message });
        };

        socket.setTimeout(timeout);

        socket.once('connect', () => {
            socket.write(Buffer.from([0x05, 0x01, 0x00]));
        });

        socket.once('timeout', () => {
            logError(`SOCKS5 握手超时: ${host}:${port}`);
            finish(false, `❌ SOCKS5 握手超时 (${timeout}ms)`);
        });

        socket.once('error', (err) => {
            logError(`SOCKS5 握手失败: ${err.message}`);
            finish(false, `❌ SOCKS5 握手失败: ${err.message}`);
        });

        socket.once('data', (data: Buffer) => {
            if (data.length >= 2 && data[0] === 0x05 && data[1] === 0x00) {
                logSuccess(`SOCKS5 握手成功: ${host}:${port}`);
                finish(true, `✅ SOCKS5 无认证协商成功`);
            } else {
                const preview = data.slice(0, 8).toString('hex');
                finish(false, `❌ 非法 SOCKS5 应答: ${preview}`);
            }
        });

        socket.connect(port, host);
    });
}

/**
 * 校验端口合法性
 */
export function validatePort(port: number): ValidationResult {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { field: 'port', valid: false, message: '❌ 端口应为 1-65535 的整数' };
    }
    return { field: 'port', valid: true, message: '✅ 端口格式正确' };
}

/**
 * 校验 IP 或域名格式
 */
export function validateHost(host: string): ValidationResult {
    if (!host || host.trim().length === 0) {
        return { field: 'host', valid: false, message: '❌ 代理地址不能为空' };
    }
    // IPv4
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    // 域名
    const domain = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/;

    if (ipv4.test(host)) {
        const parts = host.split('.').map(Number);
        if (parts.every(p => p >= 0 && p <= 255)) {
            return { field: 'host', valid: true, message: '✅ IP 地址格式正确' };
        }
        return { field: 'host', valid: false, message: '❌ IP 地址各段应为 0-255' };
    }

    if (domain.test(host)) {
        return { field: 'host', valid: true, message: '✅ 域名格式正确' };
    }

    if (host === 'localhost') {
        return { field: 'host', valid: true, message: '✅ localhost' };
    }

    return { field: 'host', valid: false, message: '❌ 地址格式不正确' };
}

/**
 * 校验项目目录（需要包含 Makefile 和 src/）
 */


/**
 * 自动检测 Antigravity.app 路径
 */
export function detectAntigravityPath(): string | null {
    const candidates = [
        '/Applications/Antigravity.app',
        `${process.env.HOME}/Applications/Antigravity.app`,
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            log(`自动检测到 Antigravity: ${p}`);
            return p;
        }
    }
    return null;
}

/**
 * 校验 Antigravity.app 路径
 */
export function validateAntigravityPath(appPath: string): ValidationResult {
    if (!appPath || appPath.trim().length === 0) {
        const detected = detectAntigravityPath();
        if (detected) {
            return { field: 'antigravityAppPath', valid: true, message: `✅ 自动检测到: ${detected}` };
        }
        return { field: 'antigravityAppPath', valid: false, message: '❌ 未找到 Antigravity.app，请手动指定路径' };
    }

    if (!fs.existsSync(appPath)) {
        return { field: 'antigravityAppPath', valid: false, message: `❌ 路径不存在: ${appPath}` };
    }

    const electron = path.join(appPath, 'Contents', 'MacOS', 'Electron');
    if (!fs.existsSync(electron)) {
        return { field: 'antigravityAppPath', valid: false, message: '❌ 该路径不是有效的 Antigravity.app' };
    }

    return { field: 'antigravityAppPath', valid: true, message: '✅ Antigravity.app 路径有效' };
}

/**
 * 执行全量校验
 */
export async function validateAll(config: ProxyConfig): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    results.push(validateHost(config.host));
    results.push(validatePort(config.port));

    results.push(validateAntigravityPath(config.antigravityAppPath));

    // 代理连通性检测最后做（可能耗时）
    const proxyResult = await validateProxyConnection(config.host, config.port);
    results.push(proxyResult);

    return results;
}
