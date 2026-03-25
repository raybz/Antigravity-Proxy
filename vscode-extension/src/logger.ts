import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Antigravity Proxy');
    }
    return channel;
}

export function log(msg: string): void {
    const ts = new Date().toLocaleTimeString();
    getLogger().appendLine(`[${ts}] ${msg}`);
}

export function logError(msg: string): void {
    const ts = new Date().toLocaleTimeString();
    getLogger().appendLine(`[${ts}] ❌ ${msg}`);
}

export function logSuccess(msg: string): void {
    const ts = new Date().toLocaleTimeString();
    getLogger().appendLine(`[${ts}] ✅ ${msg}`);
}

export function showLog(): void {
    getLogger().show(true);
}

export function dispose(): void {
    channel?.dispose();
    channel = undefined;
}
