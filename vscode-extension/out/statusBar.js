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
exports.createStatusBar = createStatusBar;
exports.updateStatus = updateStatus;
exports.dispose = dispose;
const vscode = __importStar(require("vscode"));
let statusBarItem;
const STATUS_MAP = {
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
function createStatusBar() {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.show();
    }
    updateStatus('stopped');
    return statusBarItem;
}
function updateStatus(status) {
    if (!statusBarItem) {
        return;
    }
    const info = STATUS_MAP[status];
    statusBarItem.text = info.text;
    statusBarItem.tooltip = info.tooltip;
    statusBarItem.command = info.command || undefined;
}
function dispose() {
    statusBarItem?.dispose();
    statusBarItem = undefined;
}
//# sourceMappingURL=statusBar.js.map