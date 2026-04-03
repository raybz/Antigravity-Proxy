import * as vscode from 'vscode';
import {
    initProxyManager,
    start,
    stop,
    resign,
    recoverStatus,
    stopStatusPoller,
    preparePrivilegedEnvironment,
    cleanupPrivilegedEnvironment,
    syncIndicatorToProcessState,
} from './proxyManager';
import { createRuntimeIndicator, setRuntimeIndicator } from './statusIndicator';
import { getConfig, isConfigComplete } from './configManager';
import { openConfigWebview } from './configWebview';
import { openDiagnosticsPanel } from './diagnosticsPanel';
import { installSudoHelper } from './installHelper';
import { showLog, log, dispose as disposeLogger } from './logger';
import { validateProxyConnection, validateSocks5Handshake } from './validator';
import { needsPrepareEnvironmentSetup } from './diagnostics';
import { isSudoHelperInstalled } from './sudoHelper';

/** 状态栏点按会在宿主同步路径上执行命令；推迟到下一轮事件循环再创建终端/Webview，降低崩溃概率 */
function runAfterUiYield(run: () => void | Promise<void>, onError?: (e: unknown) => void): void {
    setTimeout(() => {
        void Promise.resolve(run()).catch(e => {
            if (onError) {
                onError(e);
            } else {
                log(`命令异常: ${e instanceof Error ? e.message : String(e)}`);
            }
        });
    }, 0);
}

export function activate(context: vscode.ExtensionContext) {
    initProxyManager(context.extensionPath);
    log('Antigravity Proxy 扩展已激活');

    context.subscriptions.push(createRuntimeIndicator());

    const config = getConfig();

    async function runUpstreamTest(): Promise<void> {
        const cfg = getConfig();
        if (!isConfigComplete(cfg)) {
            vscode.window.showWarningMessage('请先配置代理主机与端口');
            return;
        }
        const timeout = Math.min(Math.max(cfg.timeout || 5000, 1000), 30000);
        showLog();
        log('🔍 正在检测上游代理…');
        const tcp = await validateProxyConnection(cfg.host, cfg.port, timeout);
        if (!tcp.valid) {
            vscode.window.showErrorMessage(tcp.message.replace(/^❌\s*/, ''));
            return;
        }
        if (cfg.type === 'socks5') {
            const s = await validateSocks5Handshake(cfg.host, cfg.port, timeout);
            const text = s.message.replace(/^[✅❌]\s*/, '');
            if (s.valid) {
                vscode.window.showInformationMessage(text);
            } else {
                vscode.window.showErrorMessage(text);
            }
        } else {
            vscode.window.showInformationMessage(
                `${tcp.message.replace(/^[✅❌]\s*/, '')}（HTTP 类型：中继仍按 SOCKS5 连接该端口，请确认上游协议）`
            );
        }
    }

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-proxy.start', () => {
            runAfterUiYield(
                () => start(),
                e => {
                    const msg = e instanceof Error ? e.message : String(e);
                    log(`启动异常: ${msg}`);
                    void vscode.window.showErrorMessage(`启动异常: ${msg}`);
                }
            );
        }),
        vscode.commands.registerCommand('antigravity-proxy.stop', () => {
            runAfterUiYield(
                () => stop(),
                e => log(`停止异常: ${e instanceof Error ? e.message : String(e)}`)
            );
        }),
        vscode.commands.registerCommand('antigravity-proxy.resign', () => {
            runAfterUiYield(() => resign());
        }),
        vscode.commands.registerCommand('antigravity-proxy.showLog', () => showLog()),
        vscode.commands.registerCommand('antigravity-proxy.openSettings', () => {
            runAfterUiYield(() => openConfigWebview(context));
        }),
        vscode.commands.registerCommand('antigravity-proxy.openDiagnostics', () => {
            runAfterUiYield(() => openDiagnosticsPanel(context));
        }),
        vscode.commands.registerCommand('antigravity-proxy.testUpstreamProxy', () => runUpstreamTest()),
        vscode.commands.registerCommand('antigravity-proxy.prepareEnvironment', () => {
            runAfterUiYield(() => preparePrivilegedEnvironment());
        }),
        vscode.commands.registerCommand('antigravity-proxy.installSudoHelper', () => {
            installSudoHelper(context);
        }),
        vscode.commands.registerCommand('antigravity-proxy.cleanupEnvironment', async () => {
            const pick = await vscode.window.showWarningMessage(
                '将移除扩展写入的 hosts 行并停止 SNI 中继，不退出 Antigravity。',
                { modal: true },
                '确定'
            );
            if (pick !== '确定') {
                return;
            }
            try {
                await cleanupPrivilegedEnvironment();
                vscode.window.showInformationMessage('已清理 hosts 与 relay');
            } catch {
                vscode.window.showErrorMessage('清理失败，请查看输出日志');
            }
        })
    );

    // 监听配置变更
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity-proxy')) {
                const newConfig = getConfig();
                if (isConfigComplete(newConfig)) {
                    log('配置已变更');
                    void syncIndicatorToProcessState();
                } else {
                    setRuntimeIndicator('bad');
                }
            }
        })
    );

    if (!isConfigComplete(config)) {
        setRuntimeIndicator('bad');
    } else if (config.autoStart) {
        log('自动启动已开启，正在启动代理...');
        void syncIndicatorToProcessState();
        start();
    } else {
        void recoverStatus();
    }

    /** 免密 helper 装好后仍需执行「准备环境」；默认自动执行（可关：antigravity-proxy.autoPrepareHostsRelay） */
    if (config.autoPrepareHostsRelay && isConfigComplete(config) && !config.autoStart) {
        if (!isSudoHelperInstalled()) {
            log('已开启「自动准备 hosts/中继」但未检测到 /usr/local/bin/antigravity-proxy-helper，跳过自动执行（请先安装免密 sudo）');
        } else {
            setTimeout(() => {
                void (async () => {
                    try {
                        if (!(await needsPrepareEnvironmentSetup())) {
                            return;
                        }
                        log('自动准备 hosts/中继：检测到未就绪，正在打开终端执行免密 helper…');
                        await preparePrivilegedEnvironment(getConfig());
                    } catch (e) {
                        log(`自动准备环境未执行: ${e instanceof Error ? e.message : String(e)}`);
                    }
                })();
            }, 2000);
        }
    }
}

export function deactivate() {
    log('Antigravity Proxy 扩展已停用');
    stopStatusPoller();
    disposeLogger();
}
