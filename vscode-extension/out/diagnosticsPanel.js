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
exports.openDiagnosticsPanel = openDiagnosticsPanel;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const configManager_1 = require("./configManager");
const logger_1 = require("./logger");
const proxyManager_1 = require("./proxyManager");
const installHelper_1 = require("./installHelper");
let panel;
function openDiagnosticsPanel(context) {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        void postRefresh(context.extensionPath);
        return;
    }
    panel = vscode.window.createWebviewPanel('antigravityProxyDiagnostics', '📊 Antigravity Proxy 环境诊断', vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = getHtml();
    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case 'refresh':
                await postRefresh(context.extensionPath);
                break;
            case 'prepareEnv':
                await (0, proxyManager_1.preparePrivilegedEnvironment)();
                break;
            case 'cleanupEnv': {
                showConfirm('将移除本扩展写入的 hosts 行并停止 SNI 中继，不会退出 Antigravity。是否继续？').then(async (ok) => {
                    if (ok) {
                        try {
                            await (0, proxyManager_1.cleanupPrivilegedEnvironment)();
                            vscode.window.showInformationMessage('已清理 hosts 与 relay');
                        }
                        catch {
                            vscode.window.showErrorMessage('清理失败，请查看输出日志');
                        }
                        await postRefresh(context.extensionPath);
                    }
                });
                break;
            }
            case 'openSettings':
                await vscode.commands.executeCommand('antigravity-proxy.openSettings');
                break;
            case 'resign':
                await vscode.commands.executeCommand('antigravity-proxy.resign');
                break;
            case 'showLog':
                await vscode.commands.executeCommand('antigravity-proxy.showLog');
                break;
            case 'installSudoHelper':
                (0, installHelper_1.installSudoHelper)(context);
                break;
            default:
                break;
        }
    }, undefined, context.subscriptions);
    panel.onDidDispose(() => {
        panel = undefined;
    });
}
function showConfirm(text) {
    return vscode.window.showWarningMessage(text, { modal: true }, '确定').then(c => c === '确定');
}
async function postRefresh(extensionPath) {
    if (!panel) {
        return;
    }
    const config = (0, configManager_1.getConfig)();
    (0, logger_1.log)('🔍 刷新环境诊断...');
    const items = await (0, diagnostics_1.collectDiagnostics)(extensionPath, config);
    panel.webview.postMessage({ command: 'state', items, configSummary: summarize(config) });
}
function summarize(cfg) {
    return `${cfg.type}://${cfg.host}:${cfg.port} · Antigravity: ${cfg.antigravityAppPath || '(自动检测)'}`;
}
function getHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      line-height: 1.5;
      font-size: 13px;
    }
    h1 { font-size: 18px; margin: 0 0 8px; font-weight: 600; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center; }
    button {
      padding: 6px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    ul { list-style: none; padding: 0; margin: 0; }
    li {
      border: 1px solid var(--vscode-widget-border);
      border-radius: 6px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    li.ok { border-left: 3px solid var(--vscode-testing-iconPassed, #3fb950); }
    li.bad { border-left: 3px solid var(--vscode-testing-iconFailed, #f85149); }
    .title { font-weight: 600; margin-bottom: 4px; }
    .detail { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
    .badge { font-size: 11px; margin-left: 8px; opacity: 0.85; }
    .loading { color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <h1>环境诊断</h1>
  <div class="sub" id="summary"></div>
  <div class="toolbar">
    <button id="btnRefresh">🔄 重新检测</button>
    <button id="btnPrepare" class="secondary">🔧 准备特权环境（hosts + relay）</button>
    <button id="btnInstallSudo" class="secondary">🔐 安装免密 sudo（首次需密码）</button>
    <button id="btnCleanup" class="secondary">🧹 仅清理 hosts + relay</button>
    <button id="btnResign" class="secondary">🔑 强制重签名</button>
    <button id="btnConfig" class="secondary">⚙️ 打开配置</button>
    <button id="btnLog" class="secondary">📋 日志</button>
  </div>
  <div id="loading" class="loading" style="display:none">检测中…</div>
  <ul id="list"></ul>
  <script>
    const vscode = acquireVsCodeApi();

    function render(items) {
      const list = document.getElementById('list');
      list.innerHTML = '';
      (items || []).forEach(it => {
        const li = document.createElement('li');
        li.className = it.ok ? 'ok' : 'bad';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = it.title;
        const st = document.createElement('span');
        st.className = 'badge';
        st.textContent = it.ok ? '正常' : '需关注';
        title.appendChild(st);
        const detail = document.createElement('div');
        detail.className = 'detail';
        detail.textContent = it.detail;
        li.appendChild(title);
        li.appendChild(detail);
        if (it.hint) {
          const hint = document.createElement('div');
          hint.className = 'hint';
          hint.textContent = it.hint;
          li.appendChild(hint);
        }
        if (it.key === 'sudo_helper' && !it.ok) {
          const row = document.createElement('div');
          row.style.marginTop = '8px';
          const go = document.createElement('button');
          go.textContent = '🔐 立即安装免密 sudo';
          go.onclick = () => vscode.postMessage({ command: 'installSudoHelper' });
          row.appendChild(go);
          li.appendChild(row);
        }
        list.appendChild(li);
      });
    }

    document.getElementById('btnRefresh').onclick = () => {
      document.getElementById('loading').style.display = 'block';
      vscode.postMessage({ command: 'refresh' });
    };
    document.getElementById('btnPrepare').onclick = () => vscode.postMessage({ command: 'prepareEnv' });
    document.getElementById('btnInstallSudo').onclick = () => vscode.postMessage({ command: 'installSudoHelper' });
    document.getElementById('btnCleanup').onclick = () => vscode.postMessage({ command: 'cleanupEnv' });
    document.getElementById('btnResign').onclick = () => vscode.postMessage({ command: 'resign' });
    document.getElementById('btnConfig').onclick = () => vscode.postMessage({ command: 'openSettings' });
    document.getElementById('btnLog').onclick = () => vscode.postMessage({ command: 'showLog' });

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if (msg.command === 'state') {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('summary').textContent = msg.configSummary || '';
        render(msg.items);
      }
    });

    vscode.postMessage({ command: 'refresh' });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=diagnosticsPanel.js.map