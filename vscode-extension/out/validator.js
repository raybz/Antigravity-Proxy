"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateProxyConnection = validateProxyConnection;
exports.validatePort = validatePort;
exports.validateHost = validateHost;
exports.validatePath = validatePath;
exports.detectAntigravityPath = detectAntigravityPath;
exports.validateAntigravityPath = validateAntigravityPath;
exports.validateAll = validateAll;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
/**
 * 校验代理连通性：尝试 TCP 连接 host:port
 */
async function validateProxyConnection(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 3000;
        socket.setTimeout(timeout);
        socket.on('connect', () => {
            socket.destroy();
            (0, logger_1.logSuccess)(`代理连通性检测通过: ${host}:${port}`);
            resolve({ field: 'proxy', valid: true, message: `✅ 代理 ${host}:${port} 连接成功` });
        });
        socket.on('timeout', () => {
            socket.destroy();
            (0, logger_1.logError)(`代理连接超时: ${host}:${port}`);
            resolve({ field: 'proxy', valid: false, message: `❌ 连接超时 (${timeout}ms)` });
        });
        socket.on('error', (err) => {
            socket.destroy();
            (0, logger_1.logError)(`代理连接失败: ${err.message}`);
            resolve({ field: 'proxy', valid: false, message: `❌ 连接失败: ${err.message}` });
        });
        socket.connect(port, host);
    });
}
/**
 * 校验端口合法性
 */
function validatePort(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { field: 'port', valid: false, message: '❌ 端口应为 1-65535 的整数' };
    }
    return { field: 'port', valid: true, message: '✅ 端口格式正确' };
}
/**
 * 校验 IP 或域名格式
 */
function validateHost(host) {
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
 * 校验路径是否存在
 */
function validatePath(pathStr, label) {
    if (!pathStr || pathStr.trim().length === 0) {
        return { field: label, valid: false, message: `❌ ${label}路径不能为空` };
    }
    if (fs.existsSync(pathStr)) {
        return { field: label, valid: true, message: `✅ ${label}路径有效` };
    }
    return { field: label, valid: false, message: `❌ 路径不存在: ${pathStr}` };
}
/**
 * 校验项目目录（需要包含 Makefile 和 src/）
 */
/**
 * 自动检测 Antigravity.app 路径
 */
function detectAntigravityPath() {
    const candidates = [
        '/Applications/Antigravity.app',
        `${process.env.HOME}/Applications/Antigravity.app`,
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            (0, logger_1.log)(`自动检测到 Antigravity: ${p}`);
            return p;
        }
    }
    return null;
}
/**
 * 校验 Antigravity.app 路径
 */
function validateAntigravityPath(appPath) {
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
async function validateAll(config) {
    const results = [];
    results.push(validateHost(config.host));
    results.push(validatePort(config.port));
    results.push(validateAntigravityPath(config.antigravityAppPath));
    // 代理连通性检测最后做（可能耗时）
    const proxyResult = await validateProxyConnection(config.host, config.port);
    results.push(proxyResult);
    return results;
}
//# sourceMappingURL=validator.js.map