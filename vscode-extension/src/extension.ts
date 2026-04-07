import * as vscode from 'vscode';
import {
    initProxyManager,
    initGlobalState,
    isProxyManuallyDisabled,
    start,
    stop,
    resign,
    recoverStatus,
    stopStatusPoller,
    preparePrivilegedEnvironment,
    cleanupPrivilegedEnvironment,
    syncIndicatorToProcessState,
    restoreStockBehavior,
} from './proxyManager';
import { createRuntimeIndicator, setRuntimeIndicator } from './statusIndicator';
import { getConfig, isConfigComplete } from './configManager';
import { openConfigWebview } from './configWebview';
import { openDiagnosticsPanel } from './diagnosticsPanel';
import { installSudoHelper } from './installHelper';
import { showLog, log, dispose as disposeLogger } from './logger';
import { validateProxyConnection, validateSocks5Handshake } from './validator';
import { needsPrepareEnvironmentSetup } from './diagnostics';
import { isSudoHelperInstalled, isHelperOutdated } from './sudoHelper';

/** 完全停用扩展对网络与 Antigravity 的改动（与「未使用本扩展代理」时一致；扩展仍安装在编辑器中） */
async function runRestoreNoProxyFlow(
    runAfterConfirm: (fn: () => void | Promise<void>, onErr?: (e: unknown) => void) => void
): Promise<void> {
    const pick = await vscode.window.showWarningMessage(
        [
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
        ].join('\n'),
        { modal: true },
        '确定'
    );
    if (pick !== '确定') {
        return;
    }
    runAfterConfirm(
        () => restoreStockBehavior(),
        e => log(`恢复默认异常: ${e instanceof Error ? e.message : String(e)}`)
    );
}

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
    initGlobalState(context.globalState);
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
                e => {
                    const msg = e instanceof Error ? e.message : String(e);
                    log(`停止异常: ${msg}`);
                    void vscode.window.showErrorMessage(`停止代理失败: ${msg}`);
                }
            );
        }),
        vscode.commands.registerCommand('antigravity-proxy.resign', () => {
            runAfterUiYield(
                () => resign(),
                e => {
                    const msg = e instanceof Error ? e.message : String(e);
                    log(`重签名异常: ${msg}`);
                    void vscode.window.showErrorMessage(`重签名失败: ${msg}`);
                }
            );
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
                vscode.window.showInformationMessage('已清理 hosts 与中继');
            } catch {
                vscode.window.showErrorMessage('清理失败，请查看输出日志');
            }
        }),
        vscode.commands.registerCommand('antigravity-proxy.restoreStock', () =>
            void runRestoreNoProxyFlow(runAfterUiYield)
        ),
        vscode.commands.registerCommand('antigravity-proxy.restoreNoProxy', () =>
            void runRestoreNoProxyFlow(runAfterUiYield)
        )
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
        void start().catch(e => {
            const msg = e instanceof Error ? e.message : String(e);
            log(`自动启动失败: ${msg}`);
            void vscode.window.showErrorMessage(`自动启动失败: ${msg}`);
        });
    } else {
        void recoverStatus();
    }

    // 检测 helper 是否过期（扩展升级后 /usr/local/bin/ 里的脚本不会自动更新）
    if (isSudoHelperInstalled() && isHelperOutdated(context.extensionPath)) {
        void vscode.window
            .showWarningMessage(
                '⚠️ 免密 sudo helper 版本已过期（扩展已更新但 /usr/local/bin/ 未同步）。' +
                '准备环境、完全停用等特权操作可能失败，请重新点「安装免密 sudo」更新。',
                '立即重装 helper',
                '稍后'
            )
            .then(choice => {
                if (choice === '立即重装 helper') {
                    installSudoHelper(context);
                }
            });
    }

    /** 免密 helper 装好后仍需执行「准备环境」；默认自动执行（可关：antigravity-proxy.autoPrepareHostsRelay） */
    if (config.autoPrepareHostsRelay && isConfigComplete(config) && !config.autoStart) {
        if (!isSudoHelperInstalled()) {
            log('已开启「自动准备 hosts/中继」但未检测到 /usr/local/bin/antigravity-proxy-helper，跳过自动执行（请先安装免密 sudo）');
        } else if (isProxyManuallyDisabled()) {
            log('检测到「完全停用代理」全局标志已置位，跳过自动准备 hosts/中继（如需重新启用，请点「准备特权环境」或「一键启动」）');
        } else {
            let cancelled = false;
            const timer = setTimeout(() => {
                if (cancelled) { return; }
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
            context.subscriptions.push({ dispose: () => { cancelled = true; clearTimeout(timer); } });
        }
    }
}

export function deactivate() {
    log('Antigravity Proxy 扩展已停用');
    stopStatusPoller();
    disposeLogger();
}
