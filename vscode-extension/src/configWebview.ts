import * as vscode from 'vscode';
import { getConfig, updateConfig, syncConfigYaml, ProxyConfig } from './configManager';
import { validateAll, ValidationResult, detectAntigravityPath } from './validator';
import { collectDiagnostics } from './diagnostics';
import { preparePrivilegedEnvironment } from './proxyManager';
import { installSudoHelper } from './installHelper';
import { log, logSuccess, logError } from './logger';

let panel: vscode.WebviewPanel | undefined;

export function openConfigWebview(context: vscode.ExtensionContext): void {
    if (panel) {
        panel.reveal();
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityProxyConfig',
        '⚙️ Antigravity Proxy 配置',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    const config = getConfig();
    panel.webview.html = getWebviewContent(config);

    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'validate': {
                    const cfg = message.config as ProxyConfig;
                    log('🔍 执行配置校验...');
                    const results = await validateAll(cfg);
                    panel?.webview.postMessage({ command: 'validationResults', results });
                    break;
                }
                case 'save': {
                    const cfg = message.config as ProxyConfig;
                    log('💾 保存配置...');

                    // 先校验
                    const results = await validateAll(cfg);
                    const failures = results.filter((r: ValidationResult) => !r.valid);

                    if (failures.length > 0) {
                        panel?.webview.postMessage({
                            command: 'saveResult',
                            success: false,
                            message: `校验失败: ${failures.map((f: ValidationResult) => f.message).join('; ')}`,
                            results,
                        });
                        logError('配置校验失败，未保存');
                        return;
                    }

                    // 校验通过，保存
                    await updateConfig(cfg);
                    syncConfigYaml(cfg);

                    panel?.webview.postMessage({
                        command: 'saveResult',
                        success: true,
                        message: '配置已保存成功！',
                        results,
                    });
                    logSuccess('配置保存成功');
                    vscode.window.showInformationMessage('✅ Antigravity Proxy 配置保存成功！');
                    break;
                }
                case 'detectAntigravity': {
                    const detected = detectAntigravityPath();
                    panel?.webview.postMessage({
                        command: 'detectedPath',
                        field: 'antigravityAppPath',
                        path: detected || '',
                    });
                    break;
                }
                case 'browseFolder': {
                    const field = message.field;
                    const options: vscode.OpenDialogOptions = { canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: '选择 Antigravity.app', filters: {} };

                    const uri = await vscode.window.showOpenDialog(options);
                    if (uri && uri[0]) {
                        panel?.webview.postMessage({
                            command: 'browsedPath',
                            field,
                            path: uri[0].fsPath,
                        });
                    }
                    break;
                }
                case 'diagnoseEnvironment': {
                    const cfg = message.config as ProxyConfig;
                    log('🔍 配置页：检测 hosts / 中继 / 内置组件…');
                    try {
                        const items = await collectDiagnostics(context.extensionPath, cfg);
                        panel?.webview.postMessage({ command: 'environmentResults', items });
                    } catch (e: any) {
                        logError(`环境检测失败: ${e?.message || e}`);
                        panel?.webview.postMessage({
                            command: 'environmentResults',
                            items: [],
                            error: e?.message || String(e),
                        });
                    }
                    break;
                }
                case 'runPrepareEnvironment': {
                    const cfg = message.config as ProxyConfig;
                    await preparePrivilegedEnvironment(cfg);
                    break;
                }
                case 'installSudoHelper':
                    installSudoHelper(context);
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

function getWebviewContent(config: ProxyConfig): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Antigravity Proxy 配置</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 24px;
            line-height: 1.6;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-widget-border, #333);
        }
        .header h1 {
            font-size: 20px;
            font-weight: 600;
        }
        .header .subtitle {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }

        /* 状态横幅 */
        .banner {
            padding: 10px 16px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 13px;
            display: none;
            align-items: center;
            gap: 8px;
        }
        .banner.success {
            display: flex;
            background: var(--vscode-testing-iconPassed, #2ea04320);
            border: 1px solid var(--vscode-testing-iconPassed, #2ea043);
            color: var(--vscode-testing-iconPassed, #2ea043);
        }
        .banner.error {
            display: flex;
            background: var(--vscode-testing-iconFailed, #f8514920);
            border: 1px solid var(--vscode-testing-iconFailed, #f85149);
            color: var(--vscode-testing-iconFailed, #f85149);
        }

        /* 分组 */
        .section {
            margin-bottom: 24px;
        }
        .section-title {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 1px solid var(--vscode-widget-border, #333);
            color: var(--vscode-foreground);
        }

        /* 表单行 */
        .form-row {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            margin-bottom: 14px;
        }
        .form-label {
            width: 120px;
            flex-shrink: 0;
            font-size: 13px;
            padding-top: 6px;
            color: var(--vscode-foreground);
        }
        .form-input-group {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .form-input-row {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        input, select {
            flex: 1;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-editor-font-family, monospace);
            outline: none;
        }
        input:focus, select:focus {
            border-color: var(--vscode-focusBorder);
        }
        input.valid {
            border-color: var(--vscode-testing-iconPassed, #2ea043);
        }
        input.invalid {
            border-color: var(--vscode-testing-iconFailed, #f85149);
        }

        /* 校验状态指示 */
        .validation-status {
            font-size: 12px;
            min-height: 16px;
        }
        .validation-status.success {
            color: var(--vscode-testing-iconPassed, #2ea043);
        }
        .validation-status.error {
            color: var(--vscode-testing-iconFailed, #f85149);
        }

        /* 按钮 */
        button {
            padding: 6px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
            white-space: nowrap;
        }
        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .button-bar {
            display: flex;
            gap: 10px;
            margin-top: 24px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-widget-border, #333);
        }

        .browse-btn {
            padding: 6px 12px;
            font-size: 12px;
        }

        /* checkbox */
        .checkbox-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .checkbox-row input[type="checkbox"] {
            flex: unset;
            width: 16px;
            height: 16px;
        }

        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        /* 加载动画 */
        .spinner {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            vertical-align: middle;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .env-block { margin-top: 8px; }
        .env-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            margin-bottom: 10px;
        }
        .env-diagnostics-wrap {
            display: none;
            margin-top: 10px;
            border: 1px solid var(--vscode-widget-border, #333);
            border-radius: 6px;
            overflow: hidden;
        }
        .env-diagnostics-toolbar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
            padding: 8px 10px;
            background: var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.12));
            border-bottom: 1px solid var(--vscode-widget-border, #333);
        }
        .env-diagnostics-toolbar button {
            flex-shrink: 0;
        }
        .env-diagnostics-summary {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
        }
        .env-results {
            display: flex;
            flex-direction: column;
            gap: 8px;
            max-height: 320px;
            overflow-y: auto;
            padding: 10px 10px 12px;
        }
        .env-results.collapsed {
            display: none !important;
        }
        .env-item {
            border: 1px solid var(--vscode-widget-border, #333);
            border-radius: 6px;
            padding: 10px 12px;
            font-size: 12px;
        }
        .env-item.ok { border-left: 3px solid var(--vscode-testing-iconPassed, #3fb950); }
        .env-item.bad { border-left: 3px solid var(--vscode-testing-iconFailed, #f85149); }
        .env-title { font-weight: 600; margin-bottom: 4px; }
        .env-detail { color: var(--vscode-descriptionForeground); }
        .env-hint { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 6px; }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>🛰 Antigravity Proxy 配置</h1>
            <div class="subtitle">配置代理参数，校验后保存即可一键启动</div>
        </div>
    </div>

    <div id="banner" class="banner"></div>

    <!-- 代理设置 -->
    <div class="section">
        <div class="section-title">🌐 代理设置</div>

        <div class="form-row">
            <div class="form-label">代理地址</div>
            <div class="form-input-group">
                <input type="text" id="host" value="${config.host}" placeholder="127.0.0.1" />
                <div id="status-host" class="validation-status"></div>
            </div>
        </div>

        <div class="form-row">
            <div class="form-label">代理端口</div>
            <div class="form-input-group">
                <input type="number" id="port" value="${config.port}" min="1" max="65535" placeholder="10808" />
                <div id="status-port" class="validation-status"></div>
            </div>
        </div>

        <div class="form-row">
            <div class="form-label">代理类型</div>
            <div class="form-input-group">
                <select id="type">
                    <option value="socks5" ${config.type === 'socks5' ? 'selected' : ''}>SOCKS5</option>
                    <option value="http" ${config.type === 'http' ? 'selected' : ''}>HTTP</option>
                </select>
            </div>
        </div>

        <div class="form-row">
            <div class="form-label">连接超时</div>
            <div class="form-input-group">
                <div class="form-input-row">
                    <input type="number" id="timeout" value="${config.timeout}" min="1000" max="30000" />
                    <span class="hint">毫秒</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 路径设置 -->
    <div class="section">
        <div class="section-title">📁 路径设置</div>



        <div class="form-row">
            <div class="form-label">Antigravity 路径</div>
            <div class="form-input-group">
                <div class="form-input-row">
                    <input type="text" id="antigravityAppPath" value="${config.antigravityAppPath}" placeholder="留空自动检测" />
                    <button class="secondary browse-btn" onclick="browse('antigravityAppPath')">浏览...</button>
                    <button class="secondary browse-btn" onclick="detectAntigravity()">自动检测</button>
                </div>
                <div class="hint">Antigravity.app 的安装路径（留空将自动检测 /Applications）</div>
                <div id="status-antigravityAppPath" class="validation-status"></div>
            </div>
        </div>
    </div>

    <!-- 高级设置 -->
    <div class="section">
        <div class="section-title">⚡ 高级设置</div>
        <div class="form-row">
            <div class="form-label">自动启动</div>
            <div class="form-input-group">
                <div class="checkbox-row">
                    <input type="checkbox" id="autoStart" ${config.autoStart ? 'checked' : ''} />
                    <span class="hint">打开编辑器时自动启动代理（脚本内已含 hosts + 中继，无需再勾下方项）</span>
                </div>
            </div>
        </div>
        <div class="form-row">
            <div class="form-label">自动准备 hosts/中继</div>
            <div class="form-input-group">
                <div class="checkbox-row">
                    <input type="checkbox" id="autoPrepareHostsRelay" ${config.autoPrepareHostsRelay !== false ? 'checked' : ''} />
                    <span class="hint">已安装免密 sudo helper、且未开「自动启动」时：启动编辑器后若 hosts 或 SNI 中继未就绪，自动执行「准备特权环境」。免密只省去密码，不会单独完成写 hosts。</span>
                </div>
            </div>
        </div>
    </div>

    <!-- 环境与流程（hosts / 中继） -->
    <div class="section">
        <div class="section-title">🖥 环境与流程状态</div>
        <p class="hint">检测使用<strong>当前表单</strong>（与是否点「保存」无关）。<strong>SNI 中继</strong> 成功启动后才会生成 <code>/tmp/antigravity-relay.pid</code>；仅点「检测」不会启动任何进程。</p>
        <p class="hint">若尚未执行过第 4 步：先点 <strong>「准备特权环境」</strong>。厌烦每次输密码：点下方 <strong>「安装免密 sudo」</strong>，或在命令面板搜索 <strong>「一次性安装免密 sudo」</strong>（仅首次要密码）。完成后再点「检测」。</p>
        <div class="env-block">
            <div class="env-actions">
                <button class="secondary" id="btnPrepareEnv" onclick="runPrepareEnv()">🔧 准备特权环境（hosts + relay）</button>
                <button class="secondary" id="btnInstallSudoEnv" onclick="runInstallSudoHelper()">🔐 安装免密 sudo（首次需密码）</button>
                <button class="secondary" id="btnEnvCheck" onclick="checkEnvironment()">🔎 检测 hosts / 中继与流程</button>
            </div>
            <div id="env-diagnostics-wrap" class="env-diagnostics-wrap">
                <div class="env-diagnostics-toolbar">
                    <button type="button" class="secondary" id="btnToggleEnvResults" onclick="toggleEnvResultsPanel()">▼ 收起检测结果</button>
                    <span id="env-diagnostics-summary" class="env-diagnostics-summary"></span>
                </div>
                <div id="env-results" class="env-results"></div>
            </div>
        </div>
    </div>

    <!-- 操作按钮 -->
    <div class="button-bar">
        <button class="primary" id="btnValidate" onclick="validate()">🔍 校验配置</button>
        <button class="primary" id="btnSave" onclick="save()">💾 保存配置</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function getFormValues() {
            return {
                host: document.getElementById('host').value,
                port: parseInt(document.getElementById('port').value) || 0,
                type: document.getElementById('type').value,
                timeout: parseInt(document.getElementById('timeout').value) || 5000,

                antigravityAppPath: document.getElementById('antigravityAppPath').value,
                autoStart: document.getElementById('autoStart').checked,
                autoPrepareHostsRelay: document.getElementById('autoPrepareHostsRelay').checked,
            };
        }

        function validate() {
            const btn = document.getElementById('btnValidate');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 校验中...';
            clearStatuses();
            hideBanner();
            vscode.postMessage({ command: 'validate', config: getFormValues() });
        }

        function save() {
            const btn = document.getElementById('btnSave');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 保存中...';
            clearStatuses();
            hideBanner();
            vscode.postMessage({ command: 'save', config: getFormValues() });
        }

        function browse(field) {
            vscode.postMessage({ command: 'browseFolder', field });
        }

        function detectAntigravity() {
            vscode.postMessage({ command: 'detectAntigravity' });
        }

        function runPrepareEnv() {
            vscode.postMessage({ command: 'runPrepareEnvironment', config: getFormValues() });
        }

        function runInstallSudoHelper() {
            vscode.postMessage({ command: 'installSudoHelper' });
        }

        function showEnvDiagnosticsShell(expanded) {
            const shell = document.getElementById('env-diagnostics-wrap');
            const results = document.getElementById('env-results');
            const toggle = document.getElementById('btnToggleEnvResults');
            shell.style.display = 'block';
            if (expanded) {
                results.classList.remove('collapsed');
                toggle.textContent = '▼ 收起检测结果';
            } else {
                results.classList.add('collapsed');
                toggle.textContent = '▶ 展开检测结果';
            }
        }

        function toggleEnvResultsPanel() {
            const results = document.getElementById('env-results');
            const toggle = document.getElementById('btnToggleEnvResults');
            const collapsed = results.classList.toggle('collapsed');
            toggle.textContent = collapsed ? '▶ 展开检测结果' : '▼ 收起检测结果';
        }

        function updateEnvDiagnosticsSummary(items, errorText) {
            const el = document.getElementById('env-diagnostics-summary');
            if (errorText) {
                el.textContent = '检测出错';
                return;
            }
            const list = items || [];
            const bad = list.filter(function(i) { return !i.ok; }).length;
            el.textContent = list.length
                ? ('共 ' + list.length + ' 项' + (bad ? '，' + bad + ' 项需关注' : '，均正常'))
                : '';
        }

        function checkEnvironment() {
            const btn = document.getElementById('btnEnvCheck');
            btn.disabled = true;
            btn.textContent = '检测中…';
            showEnvDiagnosticsShell(true);
            const wrap = document.getElementById('env-results');
            wrap.innerHTML = '<span class="hint">正在读取本机状态…</span>';
            document.getElementById('env-diagnostics-summary').textContent = '检测中…';
            vscode.postMessage({ command: 'diagnoseEnvironment', config: getFormValues() });
        }

        function renderEnvResults(items, errorText) {
            const wrap = document.getElementById('env-results');
            wrap.innerHTML = '';
            updateEnvDiagnosticsSummary(items, errorText);
            if (errorText) {
                const err = document.createElement('div');
                err.className = 'env-item bad';
                err.textContent = errorText;
                wrap.appendChild(err);
                showEnvDiagnosticsShell(true);
                return;
            }
            (items || []).forEach(function(it) {
                const div = document.createElement('div');
                div.className = 'env-item ' + (it.ok ? 'ok' : 'bad');
                const t = document.createElement('div');
                t.className = 'env-title';
                t.textContent = it.title + (it.ok ? ' ✓' : ' ✗');
                const d = document.createElement('div');
                d.className = 'env-detail';
                d.textContent = it.detail;
                div.appendChild(t);
                div.appendChild(d);
                if (it.hint) {
                    const h = document.createElement('div');
                    h.className = 'env-hint';
                    h.textContent = it.hint;
                    div.appendChild(h);
                }
                if (it.key === 'sudo_helper' && !it.ok) {
                    const b = document.createElement('button');
                    b.className = 'secondary';
                    b.style.marginTop = '10px';
                    b.textContent = '🔐 立即安装免密 sudo';
                    b.onclick = function() { vscode.postMessage({ command: 'installSudoHelper' }); };
                    div.appendChild(b);
                }
                wrap.appendChild(div);
            });
            showEnvDiagnosticsShell(true);
        }

        function showBanner(type, msg) {
            const banner = document.getElementById('banner');
            banner.className = 'banner ' + type;
            banner.textContent = msg;
            banner.style.display = 'flex';
        }

        function hideBanner() {
            document.getElementById('banner').style.display = 'none';
        }

        function clearStatuses() {
            document.querySelectorAll('.validation-status').forEach(el => {
                el.textContent = '';
                el.className = 'validation-status';
            });
            document.querySelectorAll('input').forEach(el => {
                el.classList.remove('valid', 'invalid');
            });
        }

        function applyValidationResults(results) {
            const fieldMap = {
                'host': 'host',
                'port': 'port',

                'antigravityAppPath': 'antigravityAppPath',
                'proxy': 'host',
            };

            results.forEach(r => {
                const field = fieldMap[r.field] || r.field;
                const statusEl = document.getElementById('status-' + field);
                const inputEl = document.getElementById(field);

                if (statusEl) {
                    statusEl.textContent = r.message;
                    statusEl.className = 'validation-status ' + (r.valid ? 'success' : 'error');
                }
                if (inputEl && inputEl.tagName === 'INPUT') {
                    inputEl.classList.remove('valid', 'invalid');
                    inputEl.classList.add(r.valid ? 'valid' : 'invalid');
                }
            });
        }

        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'validationResults': {
                    document.getElementById('btnValidate').disabled = false;
                    document.getElementById('btnValidate').textContent = '🔍 校验配置';
                    applyValidationResults(msg.results);
                    const failures = msg.results.filter(r => !r.valid);
                    if (failures.length === 0) {
                        showBanner('success', '✅ 所有配置校验通过！');
                    } else {
                        showBanner('error', '❌ 部分配置校验失败，请检查红色标记项');
                    }
                    break;
                }
                case 'saveResult': {
                    document.getElementById('btnSave').disabled = false;
                    document.getElementById('btnSave').textContent = '💾 保存配置';
                    if (msg.results) {
                        applyValidationResults(msg.results);
                    }
                    showBanner(msg.success ? 'success' : 'error', msg.message);
                    break;
                }
                case 'detectedPath': {
                    const input = document.getElementById(msg.field);
                    if (input && msg.path) {
                        input.value = msg.path;
                        showBanner('success', '✅ 已检测到 Antigravity: ' + msg.path);
                    } else {
                        showBanner('error', '❌ 未能自动检测到 Antigravity.app');
                    }
                    break;
                }
                case 'browsedPath': {
                    const input = document.getElementById(msg.field);
                    if (input && msg.path) {
                        input.value = msg.path;
                    }
                    break;
                }
                case 'environmentResults': {
                    const btn = document.getElementById('btnEnvCheck');
                    btn.disabled = false;
                    btn.textContent = '🔎 检测 hosts / 中继与流程';
                    renderEnvResults(msg.items, msg.error || '');
                    break;
                }
            }
        });
    </script>
</body>
</html>`;
}
