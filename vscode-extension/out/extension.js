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
/** 完全停用扩展对网络与 Antigravity 的改动（与「未使用本扩展代理」时一致；扩展仍安装在编辑器中） */
async function runRestoreNoProxyFlow(runAfterConfirm) {
    const pick = await vscode.window.showWarningMessage([
        '将完全停用本扩展的代理能力：退出 Antigravity，清理 hosts 与 SNI 中继，从 Info.plist 移除 LSEnvironment（含 DYLD/代理变量）后重签名。',
        '',
        '开始前请确认：',
        '· 配置中的 Antigravity.app 路径与您在访达打开的为同一份（多副本需对常用那份分别处理）；',
        '· 曾用仓库 Makefile 注入的，必须针对当时改过的同一 .app。',
        '',
        '完成后：请从访达启动 App；勿在已设置 HTTP_PROXY 等变量的终端里启动（可先 env | grep -i proxy）。',
        '更全的排查项（系统网络代理、DNS、mDNS、LSEnvironment 等）会在结束后写入输出日志。',
        '',
        '将可能弹出 macOS 管理员密码，或在已装免密 helper 时自动执行。',
    ].join('\n'), { modal: true }, '确定');
    if (pick !== '确定') {
        return;
    }
    runAfterConfirm(() => (0, proxyManager_1.restoreStockBehavior)(), e => (0, logger_1.log)(`恢复默认异常: ${e instanceof Error ? e.message : String(e)}`));
}
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
    (0, proxyManager_1.initGlobalState)(context.globalState);
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
        runAfterUiYield(() => (0, proxyManager_1.stop)(), e => {
            const msg = e instanceof Error ? e.message : String(e);
            (0, logger_1.log)(`停止异常: ${msg}`);
            void vscode.window.showErrorMessage(`停止代理失败: ${msg}`);
        });
    }), vscode.commands.registerCommand('antigravity-proxy.resign', () => {
        runAfterUiYield(() => (0, proxyManager_1.resign)(), e => {
            const msg = e instanceof Error ? e.message : String(e);
            (0, logger_1.log)(`重签名异常: ${msg}`);
            void vscode.window.showErrorMessage(`重签名失败: ${msg}`);
        });
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
            vscode.window.showInformationMessage('已清理 hosts 与中继');
        }
        catch {
            vscode.window.showErrorMessage('清理失败，请查看输出日志');
        }
    }), vscode.commands.registerCommand('antigravity-proxy.restoreStock', () => void runRestoreNoProxyFlow(runAfterUiYield)), vscode.commands.registerCommand('antigravity-proxy.restoreNoProxy', () => void runRestoreNoProxyFlow(runAfterUiYield)));
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
        void (0, proxyManager_1.start)().catch(e => {
            const msg = e instanceof Error ? e.message : String(e);
            (0, logger_1.log)(`自动启动失败: ${msg}`);
            void vscode.window.showErrorMessage(`自动启动失败: ${msg}`);
        });
    }
    else {
        void (0, proxyManager_1.recoverStatus)();
    }
    // 检测 helper 是否过期（扩展升级后 /usr/local/bin/ 里的脚本不会自动更新）
    if ((0, sudoHelper_1.isSudoHelperInstalled)() && (0, sudoHelper_1.isHelperOutdated)(context.extensionPath)) {
        void vscode.window
            .showWarningMessage('⚠️ 免密 sudo helper 版本已过期（扩展已更新但 /usr/local/bin/ 未同步）。' +
            '准备环境、完全停用等特权操作可能失败，请重新点「安装免密 sudo」更新。', '立即重装 helper', '稍后')
            .then(choice => {
            if (choice === '立即重装 helper') {
                (0, installHelper_1.installSudoHelper)(context);
            }
        });
    }
    /** 免密 helper 装好后仍需执行「准备环境」；默认自动执行（可关：antigravity-proxy.autoPrepareHostsRelay） */
    if (config.autoPrepareHostsRelay && (0, configManager_1.isConfigComplete)(config) && !config.autoStart) {
        if (!(0, sudoHelper_1.isSudoHelperInstalled)()) {
            (0, logger_1.log)('已开启「自动准备 hosts/中继」但未检测到 /usr/local/bin/antigravity-proxy-helper，跳过自动执行（请先安装免密 sudo）');
        }
        else if ((0, proxyManager_1.isProxyManuallyDisabled)()) {
            (0, logger_1.log)('检测到「完全停用代理」全局标志已置位，跳过自动准备 hosts/中继（如需重新启用，请点「准备特权环境」或「一键启动」）');
        }
        else {
            let cancelled = false;
            const timer = setTimeout(() => {
                if (cancelled) {
                    return;
                }
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
            context.subscriptions.push({ dispose: () => { cancelled = true; clearTimeout(timer); } });
        }
    }
}
function deactivate() {
    (0, logger_1.log)('Antigravity Proxy 扩展已停用');
    (0, proxyManager_1.stopStatusPoller)();
    (0, logger_1.dispose)();
}
//# sourceMappingURL=extension.js.map