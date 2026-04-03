import * as vscode from 'vscode';

/** 仅展示状态；点击一律打开配置（不绑定启动/停止，降低宿主崩溃风险） */
export type IndicatorState = 'ok' | 'bad' | 'starting';

let item: vscode.StatusBarItem | undefined;

export function createRuntimeIndicator(): vscode.Disposable {
    if (!item) {
        item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 48);
        item.command = 'antigravity-proxy.openSettings';
        item.show();
    }
    setRuntimeIndicator('bad');
    return new vscode.Disposable(() => {
        item?.dispose();
        item = undefined;
    });
}

export function setRuntimeIndicator(state: IndicatorState): void {
    if (!item) {
        return;
    }
    if (state === 'ok') {
        item.text = '🟢 AG-Proxy';
        item.tooltip = '运行正常（hosts / 中继 / 应用 / 上游检测均已通过）· 点击打开配置';
    } else if (state === 'starting') {
        item.text = '🟡 AG-Proxy';
        item.tooltip = '等待检测通过（hosts / 中继 / 应用 / 上游等）· 点击打开配置';
    } else {
        item.text = '🔴 AG-Proxy';
        item.tooltip = '未运行或未就绪 · 点击打开配置';
    }
}
