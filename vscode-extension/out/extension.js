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
const statusBar_1 = require("./statusBar");
const proxyManager_1 = require("./proxyManager");
const configManager_1 = require("./configManager");
const configWebview_1 = require("./configWebview");
const logger_1 = require("./logger");
function activate(context) {
    (0, logger_1.log)('Antigravity Proxy 扩展已激活');
    // 创建状态栏
    const statusBar = (0, statusBar_1.createStatusBar)();
    context.subscriptions.push(statusBar);
    // 检查配置完整性
    const config = (0, configManager_1.getConfig)();
    if (!(0, configManager_1.isConfigComplete)(config)) {
        (0, statusBar_1.updateStatus)('not-configured');
    }
    // 注册命令
    context.subscriptions.push(vscode.commands.registerCommand('antigravity-proxy.start', () => (0, proxyManager_1.start)()), vscode.commands.registerCommand('antigravity-proxy.stop', () => (0, proxyManager_1.stop)()), vscode.commands.registerCommand('antigravity-proxy.resign', () => (0, proxyManager_1.resign)()), vscode.commands.registerCommand('antigravity-proxy.showLog', () => (0, logger_1.showLog)()), vscode.commands.registerCommand('antigravity-proxy.openSettings', () => (0, configWebview_1.openConfigWebview)(context)));
    // 监听配置变更
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('antigravity-proxy')) {
            const newConfig = (0, configManager_1.getConfig)();
            if ((0, configManager_1.isConfigComplete)(newConfig)) {
                (0, logger_1.log)('配置已变更');
            }
            else {
                (0, statusBar_1.updateStatus)('not-configured');
            }
        }
    }));
    // 自动启动
    if (config.autoStart && (0, configManager_1.isConfigComplete)(config)) {
        (0, logger_1.log)('自动启动已开启，正在启动代理...');
        (0, proxyManager_1.start)();
    }
}
function deactivate() {
    (0, logger_1.log)('Antigravity Proxy 扩展已停用');
    (0, statusBar_1.dispose)();
    (0, logger_1.dispose)();
}
//# sourceMappingURL=extension.js.map