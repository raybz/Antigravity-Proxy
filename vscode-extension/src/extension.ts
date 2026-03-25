import * as vscode from 'vscode';
import { createStatusBar, updateStatus, dispose as disposeStatusBar } from './statusBar';
import { start, stop, resign } from './proxyManager';
import { getConfig, isConfigComplete } from './configManager';
import { openConfigWebview } from './configWebview';
import { showLog, log, dispose as disposeLogger } from './logger';

export function activate(context: vscode.ExtensionContext) {
    log('Antigravity Proxy 扩展已激活');

    // 创建状态栏
    const statusBar = createStatusBar();
    context.subscriptions.push(statusBar);

    // 检查配置完整性
    const config = getConfig();
    if (!isConfigComplete(config)) {
        updateStatus('not-configured');
    }

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-proxy.start', () => start()),
        vscode.commands.registerCommand('antigravity-proxy.stop', () => stop()),
        vscode.commands.registerCommand('antigravity-proxy.resign', () => resign()),
        vscode.commands.registerCommand('antigravity-proxy.showLog', () => showLog()),
        vscode.commands.registerCommand('antigravity-proxy.openSettings', () => openConfigWebview(context)),
    );

    // 监听配置变更
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('antigravity-proxy')) {
                const newConfig = getConfig();
                if (isConfigComplete(newConfig)) {
                    log('配置已变更');
                } else {
                    updateStatus('not-configured');
                }
            }
        })
    );

    // 自动启动
    if (config.autoStart && isConfigComplete(config)) {
        log('自动启动已开启，正在启动代理...');
        start();
    }
}

export function deactivate() {
    log('Antigravity Proxy 扩展已停用');
    disposeStatusBar();
    disposeLogger();
}
