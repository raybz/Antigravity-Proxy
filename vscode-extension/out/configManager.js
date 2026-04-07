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
exports.normalizeProxyConfigFromUI = normalizeProxyConfigFromUI;
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
exports.applyAutoLaunchToAllScopes = applyAutoLaunchToAllScopes;
exports.disableAutoLaunchInAllConfigScopes = disableAutoLaunchInAllConfigScopes;
exports.syncConfigYaml = syncConfigYaml;
exports.isConfigComplete = isConfigComplete;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
const validator_1 = require("./validator");
const CONFIG_SECTION = 'antigravity-proxy';
/**
 * WebView postMessage 在部分环境下会把 number 序列成 string，合并为严格类型，避免写入或校验异常。
 */
function normalizeProxyConfigFromUI(raw) {
    const o = raw && typeof raw === 'object' ? raw : {};
    const portNum = Math.trunc(Number(o.port));
    const timeoutNum = Math.trunc(Number(o.timeout));
    return {
        host: String(o.host ?? '').trim(),
        port: Number.isFinite(portNum) ? portNum : 0,
        type: o.type === 'http' ? 'http' : 'socks5',
        timeout: Number.isFinite(timeoutNum) && timeoutNum >= 1000 ? timeoutNum : 5000,
        antigravityAppPath: String(o.antigravityAppPath ?? '').trim(),
        autoStart: o.autoStart === true,
        autoPrepareHostsRelay: o.autoPrepareHostsRelay !== false,
        showStatusBar: o.showStatusBar !== false,
    };
}
/**
 * 从 VS Code settings 读取完整配置
 */
function getConfig() {
    const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
    let appPath = cfg.get('antigravityAppPath', '');
    if (!appPath) {
        appPath = (0, validator_1.detectAntigravityPath)() || '';
    }
    return {
        host: cfg.get('proxyHost', '127.0.0.1'),
        port: cfg.get('proxyPort', 10808),
        type: cfg.get('proxyType', 'socks5'),
        timeout: cfg.get('timeout', 5000),
        antigravityAppPath: appPath,
        autoStart: cfg.get('autoStart', false),
        autoPrepareHostsRelay: cfg.get('autoPrepareHostsRelay', true),
        showStatusBar: cfg.get('showStatusBar', true),
    };
}
/**
 * 将若干键写入用户 / 工作区 / 各文件夹，避免 .vscode/settings.json 覆盖 Global 导致「保存不生效」
 */
async function applySettingsToAllScopes(entries) {
    const applyAt = async (target) => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        for (const [key, value] of entries) {
            try {
                await cfg.update(key, value, target);
            }
            catch (e) {
                (0, logger_1.log)(`写入 ${key} @${target} 失败: ${e?.message || e}`);
            }
        }
    };
    await applyAt(vscode.ConfigurationTarget.Global);
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
        await applyAt(vscode.ConfigurationTarget.Workspace);
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const scoped = vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri);
        for (const [key, value] of entries) {
            try {
                await scoped.update(key, value, vscode.ConfigurationTarget.WorkspaceFolder);
            }
            catch (e) {
                (0, logger_1.log)(`写入 ${key} @文件夹「${folder.name}」失败: ${e?.message || e}`);
            }
        }
    }
}
/**
 * 将配置写回 VS Code settings
 */
async function updateConfig(config) {
    if (config.host !== undefined || config.port !== undefined || config.type !== undefined || config.timeout !== undefined) {
        const cur = getConfig();
        const host = (config.host !== undefined ? config.host : cur.host).trim();
        const portRaw = config.port !== undefined ? config.port : cur.port;
        const port = Math.trunc(Number(portRaw));
        const type = config.type !== undefined ? config.type : cur.type;
        const timeoutRaw = config.timeout !== undefined ? config.timeout : cur.timeout;
        const timeout = Math.trunc(Number(timeoutRaw));
        await applySettingsToAllScopes([
            ['proxyHost', host],
            ['proxyPort', Number.isFinite(port) ? port : cur.port],
            ['proxyType', type === 'http' ? 'http' : 'socks5'],
            ['timeout', Number.isFinite(timeout) && timeout >= 1000 ? timeout : cur.timeout],
        ]);
    }
    if (config.antigravityAppPath !== undefined) {
        await applySettingsToAllScopes([['antigravityAppPath', config.antigravityAppPath]]);
    }
    if (config.autoStart !== undefined || config.autoPrepareHostsRelay !== undefined) {
        const cur = getConfig();
        await applyAutoLaunchToAllScopes(config.autoStart !== undefined ? config.autoStart : cur.autoStart, config.autoPrepareHostsRelay !== undefined ? config.autoPrepareHostsRelay : cur.autoPrepareHostsRelay);
    }
    if (config.showStatusBar !== undefined) {
        await applySettingsToAllScopes([['showStatusBar', config.showStatusBar]]);
    }
    (0, logger_1.log)('配置已更新到用户 / 工作区 / 各文件夹作用域');
}
/**
 * 将「自动启动 / 自动准备 hosts」同步到用户、工作区、各文件夹（避免仅写 Global 时被 .vscode/settings.json 覆盖）
 */
async function applyAutoLaunchToAllScopes(autoStart, autoPrepareHostsRelay) {
    const applyPairAt = async (target) => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        try {
            await cfg.update('autoStart', autoStart, target);
            await cfg.update('autoPrepareHostsRelay', autoPrepareHostsRelay, target);
        }
        catch (e) {
            (0, logger_1.log)(`applyAutoLaunch: 作用域 ${target} 写入失败: ${e?.message || e}`);
        }
    };
    await applyPairAt(vscode.ConfigurationTarget.Global);
    if ((vscode.workspace.workspaceFolders?.length ?? 0) > 0) {
        await applyPairAt(vscode.ConfigurationTarget.Workspace);
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        try {
            const scoped = vscode.workspace.getConfiguration(CONFIG_SECTION, folder.uri);
            await scoped.update('autoStart', autoStart, vscode.ConfigurationTarget.WorkspaceFolder);
            await scoped.update('autoPrepareHostsRelay', autoPrepareHostsRelay, vscode.ConfigurationTarget.WorkspaceFolder);
        }
        catch (e) {
            (0, logger_1.log)(`applyAutoLaunch: 文件夹「${folder.name}」写入失败: ${e?.message || e}`);
        }
    }
    (0, logger_1.log)(`已在各作用域同步自动启动/自动准备: autoStart=${autoStart}, autoPrepareHostsRelay=${autoPrepareHostsRelay}`);
}
/** 恢复原生时关闭自动拉起代理链 */
async function disableAutoLaunchInAllConfigScopes() {
    await applyAutoLaunchToAllScopes(false, false);
}
/**
 * 根据当前配置生成 config.yaml 文件
 */
function syncConfigYaml(config) {
    const content = `# Antigravity-Proxy Configuration (auto-generated by extension)
proxy:
  host: "${config.host}"
  port: ${config.port}
  type: "${config.type}"
  timeout: ${config.timeout}
  child_injection: true

# FakeIP range
dns:
  fakeip_range: "198.18.0.0/16"
`;
    // 固定路径保证每次启动 Antigravity 读取同一份配置，不因时间戳变化而失效
    const yamlPath = path.join('/tmp', 'antigravity-config.yaml');
    try {
        fs.writeFileSync(yamlPath, content, 'utf-8');
        (0, logger_1.log)(`config.yaml 已同步到 ${yamlPath}`);
    }
    catch (e) {
        const msg = `写入 config.yaml 失败（${yamlPath}）: ${e?.message || e}`;
        (0, logger_1.log)(`❌ ${msg}`);
        throw new Error(msg);
    }
    return yamlPath;
}
/**
 * 检查配置是否完整可用
 */
function isConfigComplete(config) {
    // 现在不再强制要求 projectPath，因为有内置二进制
    return !!(config.host && config.port);
}
//# sourceMappingURL=configManager.js.map