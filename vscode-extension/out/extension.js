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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const proxyManager_1 = require("./proxyManager");
const statusIndicator_1 = require("./statusIndicator");
const configManager_1 = require("./configManager");
const configWebview_1 = require("./configWebview");
const diagnosticsPanel_1 = require("./diagnosticsPanel");
const installHelper_1 = require("./installHelper");
const logger_1 = require("./logger");
const validator_1 = require("./validator");
const diagnostics_1 = require("./diagnostics");
const sudoHelper_1 = require("./sudoHelper");
/** 状态栏点按会在宿主同步路径上执行命令；推迟到下一轮事件循环再创建终端/Webview，降低崩溃概率 */
function runAfterUiYield(run, onError) {
    setTimeout(() => {
        void Promise.resolve(run()).catch(e => {
            if (onError) {
                onError(e);
            }
            else {
                (0, logger_1.log)(`命令异常: ${e instanceof Error ? e.message : String(e)}`);
            }
        });
    }, 0);
}
function activate(context) {
    (0, proxyManager_1.initProxyManager)(context.extensionPath);
    (0, logger_1.log)('Antigravity Proxy 扩展已激活');
    context.subscriptions.push((0, statusIndicator_1.createRuntimeIndicator)());
    const config = (0, configManager_1.getConfig)();
    async function runUpstreamTest() {
        const cfg = (0, configManager_1.getConfig)();
        if (!(0, configManager_1.isConfigComplete)(cfg)) {
            vscode.window.showWarningMessage('请先配置代理主机与端口');
            return;
        }
        const timeout = Math.min(Math.max(cfg.timeout || 5000, 1000), 30000);
        (0, logger_1.showLog)();
        (0, logger_1.log)('🔍 正在检测上游代理…');
        const tcp = await (0, validator_1.validateProxyConnection)(cfg.host, cfg.port, timeout);
        if (!tcp.valid) {
            vscode.window.showErrorMessage(tcp.message.replace(/^❌\s*/, ''));
            return;
        }
        if (cfg.type === 'socks5') {
            const s = await (0, validator_1.validateSocks5Handshake)(cfg.host, cfg.port, timeout);
            const text = s.message.replace(/^[✅❌]\s*/, '');
            if (s.valid) {
                vscode.window.showInformationMessage(text);
            }
            else {
                vscode.window.showErrorMessage(text);
            }
        }
        else {
            vscode.window.showInformationMessage(`${tcp.message.replace(/^[✅❌]\s*/, '')}（HTTP 类型：中继仍按 SOCKS5 连接该端口，请确认上游协议）`);
        }
    }
    // 注册命令
    context.subscriptions.push(vscode.commands.registerCommand('antigravity-proxy.start', () => {
        runAfterUiYield(() => (0, proxyManager_1.start)(), e => {
            const msg = e instanceof Error ? e.message : String(e);
            (0, logger_1.log)(`启动异常: ${msg}`);
            void vscode.window.showErrorMessage(`启动异常: ${msg}`);
        });
    }), vscode.commands.registerCommand('antigravity-proxy.stop', () => {
        runAfterUiYield(() => (0, proxyManager_1.stop)(), e => (0, logger_1.log)(`停止异常: ${e instanceof Error ? e.message : String(e)}`));
    }), vscode.commands.registerCommand('antigravity-proxy.resign', () => {
        runAfterUiYield(() => (0, proxyManager_1.resign)());
    }), vscode.commands.registerCommand('antigravity-proxy.showLog', () => (0, logger_1.showLog)()), vscode.commands.registerCommand('antigravity-proxy.openSettings', () => {
        runAfterUiYield(() => (0, configWebview_1.openConfigWebview)(context));
    }), vscode.commands.registerCommand('antigravity-proxy.openDiagnostics', () => {
        runAfterUiYield(() => (0, diagnosticsPanel_1.openDiagnosticsPanel)(context));
    }), vscode.commands.registerCommand('antigravity-proxy.testUpstreamProxy', () => runUpstreamTest()), vscode.commands.registerCommand('antigravity-proxy.prepareEnvironment', () => {
        runAfterUiYield(() => (0, proxyManager_1.preparePrivilegedEnvironment)());
    }), vscode.commands.registerCommand('antigravity-proxy.installSudoHelper', () => {
        (0, installHelper_1.installSudoHelper)(context);
    }), vscode.commands.registerCommand('antigravity-proxy.cleanupEnvironment', async () => {
        const pick = await vscode.window.showWarningMessage('将移除扩展写入的 hosts 行并停止 SNI 中继，不退出 Antigravity。', { modal: true }, '确定');
        if (pick !== '确定') {
            return;
        }
        try {
            await (0, proxyManager_1.cleanupPrivilegedEnvironment)();
            vscode.window.showInformationMessage('已清理 hosts 与 relay');
        }
        catch {
            vscode.window.showErrorMessage('清理失败，请查看输出日志');
        }
    }));
    // 监听配置变更
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('antigravity-proxy')) {
            const newConfig = (0, configManager_1.getConfig)();
            if ((0, configManager_1.isConfigComplete)(newConfig)) {
                (0, logger_1.log)('配置已变更');
                void (0, proxyManager_1.syncIndicatorToProcessState)();
            }
            else {
                (0, statusIndicator_1.setRuntimeIndicator)('bad');
            }
        }
    }));
    if (!(0, configManager_1.isConfigComplete)(config)) {
        (0, statusIndicator_1.setRuntimeIndicator)('bad');
    }
    else if (config.autoStart) {
        (0, logger_1.log)('自动启动已开启，正在启动代理...');
        void (0, proxyManager_1.syncIndicatorToProcessState)();
        (0, proxyManager_1.start)();
    }
    else {
        void (0, proxyManager_1.recoverStatus)();
    }
    /** 免密 helper 装好后仍需执行「准备环境」；默认自动执行（可关：antigravity-proxy.autoPrepareHostsRelay） */
    if (config.autoPrepareHostsRelay && (0, configManager_1.isConfigComplete)(config) && !config.autoStart) {
        if (!(0, sudoHelper_1.isSudoHelperInstalled)()) {
            (0, logger_1.log)('已开启「自动准备 hosts/中继」但未检测到 /usr/local/bin/antigravity-proxy-helper，跳过自动执行（请先安装免密 sudo）');
        }
        else {
            setTimeout(() => {
                void (async () => {
                    try {
                        if (!(await (0, diagnostics_1.needsPrepareEnvironmentSetup)())) {
                            return;
                        }
                        (0, logger_1.log)('自动准备 hosts/中继：检测到未就绪，正在打开终端执行免密 helper…');
                        await (0, proxyManager_1.preparePrivilegedEnvironment)((0, configManager_1.getConfig)());
                    }
                    catch (e) {
                        (0, logger_1.log)(`自动准备环境未执行: ${e instanceof Error ? e.message : String(e)}`);
                    }
                })();
            }, 2000);
        }
    }
}
function deactivate() {
    (0, logger_1.log)('Antigravity Proxy 扩展已停用');
    (0, proxyManager_1.stopStatusPoller)();
    (0, logger_1.dispose)();
}
//# sourceMappingURL=extension.js.map