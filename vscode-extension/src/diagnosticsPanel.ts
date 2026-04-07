import * as vscode from 'vscode';
import { collectDiagnostics } from './diagnostics';
import { getConfig } from './configManager';
import { log } from './logger';
import { preparePrivilegedEnvironment, cleanupPrivilegedEnvironment, restoreStockBehavior } from './proxyManager';
import { installSudoHelper } from './installHelper';

let panel: vscode.WebviewPanel | undefined;

export function openDiagnosticsPanel(context: vscode.ExtensionContext): void {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        void postRefresh(context.extensionPath);
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityProxyDiagnostics',
        '📊 Antigravity Proxy 环境诊断',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = getHtml();

    panel.webview.onDidReceiveMessage(
        async message => {
            switch (message.command) {
                case 'refresh':
                    await postRefresh(context.extensionPath);
                    break;
                case 'prepareEnv':
                    await preparePrivilegedEnvironment();
                    break;
                case 'cleanupEnv': {
                    showConfirm(
                        '将移除本扩展写入的 hosts 行并停止 SNI 中继，不会退出 Antigravity。是否继续？'
                    ).then(async ok => {
                        if (ok) {
                            try {
                                await cleanupPrivilegedEnvironment();
                                vscode.window.showInformationMessage('已清理 hosts 与中继');
                            } catch (e: unknown) {
                                const msg = e instanceof Error ? e.message : String(e);
                                log(`❌ 清理失败: ${msg}`);
                                // 错误弹窗已在 cleanupPrivilegedEnvironment 内弹出，此处不重复
                            }
                            await postRefresh(context.extensionPath);
                        }
                    });
                    break;
                }
                case 'restoreStock': {
                    showConfirm(
                        '将完全停用本扩展代理：退出 Antigravity，清理 hosts/中继，移除 LSEnvironment 并重签名。开始前请确认配置里 .app 与访达打开的为同一份（多副本/Makefile 须对同一 bundle）。完成后说明会写入输出日志（终端代理变量、系统代理、DNS、LSEnvironment 等）。是否继续？'
                    ).then(async ok => {
                        if (ok) {
                            try {
                                await restoreStockBehavior();
                            } catch (e: unknown) {
                                const msg = e instanceof Error ? e.message : String(e);
                                log(`❌ 恢复原生失败: ${msg}`);
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
                    installSudoHelper(context);
                    break;
                case 'openSystemProxy':
                    await vscode.env.openExternal(
                        vscode.Uri.parse('x-apple.systempreferences:com.apple.preference.network?Proxies')
                    );
                    break;
                default:
                    break;
            }
        },
        undefined,
        context.subscriptions
    );

    panel.onDidDispose(() => {
        panel = undefined;
    });
}

function showConfirm(text: string): Thenable<boolean> {
    return vscode.window.showWarningMessage(text, { modal: true }, '确定').then(c => c === '确定');
}

async function postRefresh(extensionPath: string): Promise<void> {
    if (!panel) {
        return;
    }
    const config = getConfig();
    log('🔍 刷新环境诊断...');
    try {
        const items = await collectDiagnostics(extensionPath, config);
        panel.webview.postMessage({ command: 'state', items, configSummary: summarize(config) });
    } catch (e: any) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`❌ 诊断收集异常: ${msg}`);
        panel.webview.postMessage({ command: 'error', message: `诊断收集失败: ${msg}` });
    }
}

function summarize(cfg: ReturnType<typeof getConfig>): string {
    return `${cfg.type}://${cfg.host}:${cfg.port} · Antigravity: ${cfg.antigravityAppPath || '(自动检测)'}`;
}

function getHtml(): string {
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
    <button id="btnRestoreStock" class="secondary">🔕 完全停用代理（未使用扩展时）</button>
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
        if (it.key === 'system_proxy' && !it.ok) {
          const row = document.createElement('div');
          row.style.marginTop = '8px';
          const go = document.createElement('button');
          go.className = 'secondary';
          go.textContent = '🌐 前往系统设置 → 代理';
          go.onclick = () => vscode.postMessage({ command: 'openSystemProxy' });
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
    document.getElementById('btnRestoreStock').onclick = () => vscode.postMessage({ command: 'restoreStock' });
    document.getElementById('btnResign').onclick = () => vscode.postMessage({ command: 'resign' });
    document.getElementById('btnConfig').onclick = () => vscode.postMessage({ command: 'openSettings' });
    document.getElementById('btnLog').onclick = () => vscode.postMessage({ command: 'showLog' });

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if (msg.command === 'state') {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('summary').textContent = msg.configSummary || '';
        render(msg.items);
      } else if (msg.command === 'error') {
        document.getElementById('loading').style.display = 'none';
        const list = document.getElementById('list');
        list.innerHTML = '<li class="bad"><div class="title">诊断收集失败 <span class="badge">错误</span></div><div class="detail">' + (msg.message || '未知错误') + '</div></li>';
      }
    });

    // 初始加载时显示 loading，再发请求
    document.getElementById('loading').style.display = 'block';
    vscode.postMessage({ command: 'refresh' });
  </script>
</body>
</html>`;
}
