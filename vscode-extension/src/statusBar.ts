import * as vscode from 'vscode';

export type ProxyStatus = 'running' | 'stopped' | 'starting' | 'not-configured';

let statusBarItem: vscode.StatusBarItem | undefined;

const STATUS_MAP: Record<ProxyStatus, { text: string; tooltip: string; command: string }> = {
    'running': {
        text: '$(check) AG-Proxy: Running',
        tooltip: '代理运行中，点击停止',
        command: 'antigravity-proxy.stop',
    },
    'stopped': {
        text: '$(circle-slash) AG-Proxy: Stopped',
        tooltip: '代理已停止，点击启动',
        command: 'antigravity-proxy.start',
    },
    'starting': {
        text: '$(sync~spin) AG-Proxy: Starting...',
        tooltip: '正在启动代理...',
        command: '',
    },
    'not-configured': {
        text: '$(warning) AG-Proxy: 未配置',
        tooltip: '点击打开配置页面',
        command: 'antigravity-proxy.openSettings',
    },
};

export function createStatusBar(): vscode.StatusBarItem {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.show();
    }
    updateStatus('stopped');
    return statusBarItem;
}

export function updateStatus(status: ProxyStatus): void {
    if (!statusBarItem) { return; }
    const info = STATUS_MAP[status];
    statusBarItem.text = info.text;
    statusBarItem.tooltip = info.tooltip;
    statusBarItem.command = info.command || undefined;
}

export function dispose(): void {
    statusBarItem?.dispose();
    statusBarItem = undefined;
}
