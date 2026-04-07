import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    getConfig,
    isConfigComplete,
    syncConfigYaml,
    ProxyConfig,
    disableAutoLaunchInAllConfigScopes,
} from './configManager';
import { log, logError, logSuccess, showLog } from './logger';
import { validateAntigravityPath, detectAntigravityPath } from './validator';
import { RELAY_DOMAINS, HOSTS_MARKER } from './relayDomains';
import { RELAY_EXECUTABLE, RELAY_LOG_PATH, RELAY_PID_PATH } from './runtimeConstants';
import { isSudoHelperInstalled, isHelperOutdated, SUDO_HELPER_PATH } from './sudoHelper';
import { setRuntimeIndicator } from './statusIndicator';
import { isProxyFullyHealthy, checkSystemProxyForWarning } from './diagnostics';

let isProxyRunning = false;
let statusInterval: NodeJS.Timeout | undefined;
let extensionPathOverride: string | undefined;
let startBusy = false;
let statusPollInFlight = false;
/** 一键启动后若在暖机期内未通过全量检测，保持黄色而非立刻红色 */
let warmUpUntilMs = 0;

/** ExtensionContext.globalState 存储键：用户主动执行「完全停用代理」后置 true，阻止 auto-prepare 跨工作区重建 hosts/relay */
export const GLOBAL_STATE_PROXY_DISABLED = 'proxyManuallyDisabled';
let _globalState: vscode.Memento | undefined;

export function initGlobalState(state: vscode.Memento): void {
    _globalState = state;
}

export function isProxyManuallyDisabled(): boolean {
    return _globalState?.get<boolean>(GLOBAL_STATE_PROXY_DISABLED, false) ?? false;
}

export async function setProxyManuallyDisabled(disabled: boolean): Promise<void> {
    if (_globalState) {
        await _globalState.update(GLOBAL_STATE_PROXY_DISABLED, disabled);
        log(`proxyManuallyDisabled 全局状态已设为: ${disabled}`);
    }
}

type RestoreStockListener = () => void;
const restoreStockListeners: RestoreStockListener[] = [];

/** 注册一个在 restoreStockBehavior 完成时触发的回调（用于 webview 自动刷新诊断） */
export function onRestoreStockDone(listener: RestoreStockListener): { dispose(): void } {
    restoreStockListeners.push(listener);
    return {
        dispose() {
            const idx = restoreStockListeners.indexOf(listener);
            if (idx >= 0) { restoreStockListeners.splice(idx, 1); }
        },
    };
}

const ANTIGRAVITY_ENTITLEMENTS_PATH = '/tmp/antigravity_entitlements.plist';

function writeAntigravityEntitlementsFile(): void {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.automation.apple-events</key><true/>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.device.camera</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>`;
    fs.writeFileSync(ANTIGRAVITY_ENTITLEMENTS_PATH, xml);
}

/** 需重签名的可执行文件（含任意架构 language_server_macos_*） */
function bundleExecutableSignPaths(appPath: string): string[] {
    const paths: string[] = [
        path.join(appPath, 'Contents/MacOS/Electron'),
        path.join(appPath, 'Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper'),
        path.join(appPath, 'Contents/Frameworks/Antigravity Helper (GPU).app/Contents/MacOS/Antigravity Helper (GPU)'),
        path.join(
            appPath,
            'Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)'
        ),
        path.join(
            appPath,
            'Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)'
        ),
    ];
    const binDir = path.join(appPath, 'Contents/Resources/app/extensions/antigravity/bin');
    try {
        if (fs.existsSync(binDir)) {
            for (const name of fs.readdirSync(binDir)) {
                if (name.startsWith('language_server_macos_')) {
                    paths.push(path.join(binDir, name));
                }
            }
        }
    } catch {
        /* ignore */
    }
    return paths;
}

function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

/** 完全停用后的统一说明（写入输出通道，供用户对照多副本/终端代理/系统等） */
function logRestoreNoProxyFollowUp(context: 'full' | 'terminal_pending' | 'no_app_path'): void {
    const lines = [
        '━━━━ 完全停用代理 · 后续建议 ━━━━',
        '• 启动：优先从访达打开 Antigravity；若在终端启动，先执行 env | grep -i proxy，避免继承 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY。',
        '• 路径：配置中的 .app 须与日常打开的为同一份；机器上有多份副本时，未执行 strip 的那份仍可能带 LSEnvironment。',
        '• Makefile：曾用仓库 make 写入注入的，必须对当时修改的同一 bundle 再执行本流程。',
        '• 系统代理：系统设置 → 网络 → 当前网络 → 详细信息 → 代理；若自行开启过，需要直连时可关闭。',
        '• DNS：若解析仍异常，可执行：sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder',
        '• 仍异常：在配置页执行「检测 hosts / 中继」查看 LSEnvironment；免密 helper 过旧请先「一次性安装免密 sudo」更新 /usr/local/bin。',
        '• 说明：编辑器里可保留本扩展与代理设置项；未再次「启动代理」则不会劫持流量。',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ];
    if (context === 'terminal_pending') {
        lines.splice(1, 0, '（当前：请先在系统「终端」窗口内跑完 sudo 脚本，再执行下列建议。）');
    } else if (context === 'no_app_path') {
        lines.splice(
            1,
            0,
            '（当前：未能解析到 .app 路径，仅完成 hosts/中继清理；请在配置中填写 Antigravity 路径后再次点「完全停用代理」，才能移除 Info.plist 注入。）'
        );
    }
    log(lines.join('\n'));
}

function showRestoreNoProxyToast(message: string): void {
    void vscode.window
        .showInformationMessage(message, '查看日志')
        .then(choice => {
            if (choice === '查看日志') {
                showLog();
            }
        });
}

/**
 * 通过 macOS「输入密码以运行此任务…」对话框提权；使用绝对路径 osascript，避免 Cursor 环境下 PATH 找不到命令。
 */
function runWithAdminPrivileges(bashScriptPath: string, timeoutMs: number = 180000): Promise<string> {
    return new Promise((resolve, reject) => {
        const run = `/bin/bash ${bashScriptPath}`;
        const appleScript = `do shell script ${JSON.stringify(run)} with administrator privileges`;
        log('将通过系统密码框提权执行恢复/签名脚本（非集成终端）');
        const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' };
        cp.execFile(
            '/usr/bin/osascript',
            ['-e', appleScript],
            { timeout: timeoutMs, env },
            (err, stdout, stderr) => {
                const out = (stdout || '').trim();
                const errTxt = (stderr || '').trim();
                if (err) {
                    const combined = [errTxt, out].filter(Boolean).join('\n').trim();
                    logError(`osascript 提权失败: ${combined || err.message || String(err)}`);
                    reject(new Error(combined || err.message || String(err)));
                } else {
                    resolve(out);
                }
            }
        );
    });
}

/**
 * 生成 .command：由「终端.app」执行，在集成宿主外的真实 TTY 里 sudo（osascript 被拦或密码框不弹时的兜底）。
 */
function writeTerminalSudoLauncher(scriptPath: string, title: string): string {
    const launcher = `/tmp/antigravity-proxy-launcher-${Date.now()}.command`;
    const body = `#!/bin/bash
clear
printf '%s\\n' ${JSON.stringify(title)}
echo "路径: ${scriptPath}"
echo "——————————————————————————————"
sudo /bin/bash ${JSON.stringify(scriptPath)}
EC=$?
echo "——————————————————————————————"
if [ "$EC" -eq 0 ]; then echo "✓ 脚本已执行完毕"; else echo "✗ 退出码: $EC（请把上方输出复制到反馈）"; fi
read -p "按回车关闭…"
exit "$EC"
`;
    fs.writeFileSync(launcher, body, { mode: 0o755 });
    log(`已写入终端启动器: ${launcher}`);
    return launcher;
}

/** 用访达/系统默认方式打开 .command → 始终进「终端」 */
async function openLauncherInTerminalApp(launcherPath: string): Promise<void> {
    await runShell(`open ${JSON.stringify(launcherPath)}`, '/tmp', false, 30000);
}

function appendRootCodesignBlock(body: string, appPath: string): string {
    let b = body;
    b += `ENT=${JSON.stringify(ANTIGRAVITY_ENTITLEMENTS_PATH)}\n`;
    for (const p of bundleExecutableSignPaths(appPath)) {
        b += `if [ -f ${JSON.stringify(p)} ]; then echo "codesign: ${p}"; codesign -f -s - --entitlements "$ENT" ${JSON.stringify(
            p
        )}; fi\n`;
    }
    return b;
}

function writeRootStripStockScript(appPath: string): string {
    writeAntigravityEntitlementsFile();
    const scriptPath = `/tmp/antigravity-restore-stock-${Date.now()}.sh`;
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    let body = '#!/bin/bash\nset -e\n';
    body += `echo "[Antigravity Proxy] 移除 Antigravity 注入键并重签名（root）"\n`;
    body += `PLIST=${JSON.stringify(plist)}\n`;
    for (const key of LSENVIRONMENT_STRIP_KEYS) {
        body += `/usr/libexec/PlistBuddy -c "Delete :LSEnvironment:${key}" "$PLIST" 2>/dev/null || true\n`;
    }
    // 删完注入键后检查 dict 是否已变空：空则删整个 dict，非空则保留（避免误删 MallocNanoZone 等系统/第三方键）
    body += `_remaining=$(/usr/libexec/PlistBuddy -c "Print :LSEnvironment" "$PLIST" 2>/dev/null || true)\n`;
    body += `if [ -z "$_remaining" ] || echo "$_remaining" | grep -qE '^Dict\\s*\\{\\s*\\}\\s*$'; then\n`;
    body += `  /usr/libexec/PlistBuddy -c "Delete :LSEnvironment" "$PLIST" 2>/dev/null || true\n`;
    body += `  echo "[Antigravity Proxy] LSEnvironment dict 已清空并移除"\n`;
    body += `else\n`;
    body += `  echo "[Antigravity Proxy] LSEnvironment 仍含非代理键，保留 dict：$_remaining"\n`;
    body += `fi\n`;
    body = appendRootCodesignBlock(body, appPath);
    body += `echo "[Antigravity Proxy] 恢复原生签名完成"\n`;
    fs.writeFileSync(scriptPath, body, { mode: 0o755 });
    return scriptPath;
}

function writeRootResignScript(appPath: string, configYamlPath: string): string {
    writeAntigravityEntitlementsFile();
    const scriptPath = `/tmp/antigravity-resign-${Date.now()}.sh`;
    const plist = path.join(appPath, 'Contents', 'Info.plist');
    let body = '#!/bin/bash\nset -e\n';
    body += `echo "[Antigravity Proxy] 写入 LSEnvironment 并重签名（root）"\n`;
    body += `PLIST=${JSON.stringify(plist)}\n`;
    body += `/usr/libexec/PlistBuddy -c "Delete :LSEnvironment" "$PLIST" 2>/dev/null || true\n`;
    body += `/usr/libexec/PlistBuddy -c ${JSON.stringify('Add :LSEnvironment dict')} "$PLIST"\n`;
    const addCfg = `Add :LSEnvironment:ANTIGRAVITY_CONFIG string ${configYamlPath}`;
    body += `/usr/libexec/PlistBuddy -c ${JSON.stringify(addCfg)} "$PLIST"\n`;
    body = appendRootCodesignBlock(body, appPath);
    body += `echo "[Antigravity Proxy] 重签名完成"\n`;
    fs.writeFileSync(scriptPath, body, { mode: 0o755 });
    return scriptPath;
}

/** 解析主应用 .app 路径（配置优先，否则自动探测） */
export function resolveAntigravityBundlePath(): string {
    const cfg = getConfig();
    const manual = (cfg.antigravityAppPath && cfg.antigravityAppPath.trim()) || '';
    return manual || detectAntigravityPath() || '';
}

/**
 * Makefile / 旧版注入可能写入的 LSEnvironment 键。
 * strip 时逐项删除这些键；若删完后 dict 为空则一并删除整个 dict，
 * 否则保留 dict（以免删掉 MallocNanoZone 等与代理无关的系统/第三方键）。
 */
const LSENVIRONMENT_STRIP_KEYS = [
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'ALL_PROXY',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'ANTIGRAVITY_CONFIG',
    'NO_PROXY',
    'FTP_PROXY',
] as const;

export function initProxyManager(extensionPath: string): void {
    extensionPathOverride = extensionPath;
}

function getExtensionRoot(): string {
    if (extensionPathOverride) {
        return extensionPathOverride;
    }
    const extension = vscode.extensions.getExtension('raybz.antigravity-proxy');
    if (extension) {
        return extension.extensionPath;
    }
    return path.join(__dirname, '..');
}

/**
 * 确保二进制文件具有执行权限
 */
function ensureExecutable(filePath: string): void {
    try {
        const stats = fs.statSync(filePath);
        // 检查所有者是否有执行权限 (0100)
        if (!(stats.mode & fs.constants.S_IXUSR)) {
            log(`正在修复执行权限: ${path.basename(filePath)}`);
            fs.chmodSync(filePath, 0o755);
        }
    } catch (err: any) {
        log(`权限检查跳过: ${err.message}`);
    }
}

/**
 * 获取二进制文件路径
 */
function getBinaryPath(name: string): string {
    const bundledPath = path.join(getExtensionRoot(), 'bin', name);
    if (fs.existsSync(bundledPath)) {
        ensureExecutable(bundledPath);
        return bundledPath;
    }

    const msg = `未找到二进制文件: ${name}。请确保插件安装完整，或手动配置项目路径。`;
    logError(msg);
    throw new Error(msg);
}

/**
 * 已装免密 helper 时后台建终端，避免每次激活/自动准备抢焦点弹终端；否则需可见终端输入 sudo 密码。
 */
function createPrivilegeTerminal(name: string): vscode.Terminal {
    const background = isSudoHelperInstalled();
    return vscode.window.createTerminal({
        name,
        cwd: '/tmp',
        hideFromUser: background,
    });
}

/** `show(true)` 在 API 里表示 preserveFocus=真 → 终端不抢焦点，会导致无法输入 sudo。必须为 false 才会聚焦终端。 */
function showPrivilegeTerminalIfNeeded(terminal: vscode.Terminal): void {
    if (!isSudoHelperInstalled()) {
        terminal.show(false);
    }
}

/** @param silent 为 true 时不写入输出通道（用于定时状态探测，避免刷屏） */
function runShell(
    cmd: string,
    cwd: string = '/tmp',
    silent = false,
    timeoutMs: number = 60000
): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!silent) {
            log(`执行命令: ${cmd}`);
        }
        cp.exec(cmd, { cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            } else {
                resolve(stdout);
            }
        });
    });
}

/** 全量健康探测（hosts、relay、Electron、内置文件、上游 TCP/SOCKS5）— 全部通过才为 true */
async function checkActualStatus(): Promise<boolean> {
    const config = getConfig();
    if (!isConfigComplete(config)) {
        return false;
    }
    return isProxyFullyHealthy(getExtensionRoot(), config);
}

function applyHealthProbeResult(ok: boolean): void {
    isProxyRunning = ok;
    if (ok) {
        warmUpUntilMs = 0;
        setRuntimeIndicator('ok');
    } else if (Date.now() < warmUpUntilMs) {
        setRuntimeIndicator('starting');
    } else {
        setRuntimeIndicator('bad');
    }
}

function schedulePostStartHealthChecks(): void {
    for (const ms of [2000, 5000, 9000, 15000]) {
        setTimeout(() => {
            void syncIndicatorToProcessState();
        }, ms);
    }
}

/**
 * 停止状态轮询
 */
export function stopStatusPoller() {
    if (statusInterval) {
        clearInterval(statusInterval);
        statusInterval = undefined;
    }
}

/**
 * 启动状态轮询
 */
export function startStatusPoller() {
    stopStatusPoller();
    statusInterval = setInterval(async () => {
        if (!isConfigComplete(getConfig())) {
            warmUpUntilMs = 0;
            setRuntimeIndicator('bad');
            return;
        }
        if (statusPollInFlight) {
            return;
        }
        statusPollInFlight = true;
        try {
            const actualRunning = await checkActualStatus();
            const prev = isProxyRunning;
            if (prev !== actualRunning && !actualRunning) {
                log('检测到代理链未完全就绪或已中断，内部运行标记已重置');
            }
            applyHealthProbeResult(actualRunning);
        } finally {
            statusPollInFlight = false;
        }
    }, 5000);
}

/** 根据当前配置与进程刷新状态栏圆点（不启动轮询） */
export async function syncIndicatorToProcessState(): Promise<void> {
    if (!isConfigComplete(getConfig())) {
        warmUpUntilMs = 0;
        setRuntimeIndicator('bad');
        return;
    }
    const ok = await checkActualStatus();
    applyHealthProbeResult(ok);
}



/**
 * 启动代理流程
 */
export async function start(): Promise<void> {
    const config = getConfig();

    if (!isConfigComplete(config)) {
        setRuntimeIndicator('bad');
        vscode.window.showWarningMessage('请先完成配置', '打开配置').then(choice => {
            if (choice === '打开配置') {
                vscode.commands.executeCommand('antigravity-proxy.openSettings');
            }
        });
        return;
    }

    const agPathCheck = validateAntigravityPath(config.antigravityAppPath);
    if (!agPathCheck.valid) {
        setRuntimeIndicator('bad');
        vscode.window.showWarningMessage(agPathCheck.message.replace(/^❌\s*/, ''), '打开配置').then(choice => {
            if (choice === '打开配置') {
                vscode.commands.executeCommand('antigravity-proxy.openSettings');
            }
        });
        return;
    }

    if (startBusy) {
        vscode.window.showInformationMessage('启动已在进行中，请稍候。');
        return;
    }

    // 用户主动启动代理，清除「手动禁用」全局标志
    await setProxyManuallyDisabled(false);

    startBusy = true;
    setRuntimeIndicator('starting');
    /* 不自动 showLog：状态栏点按时与 Output/终端抢焦点易触发部分宿主不稳；需要时用户可命令面板「查看日志」 */
    log('启动流程已开始（日志仅追加到输出通道，不自动弹出）');

    try {
        /* 让出 UI 线程，避免在「状态栏命令」同步栈里立刻 createTerminal */
        await new Promise<void>(resolve => setTimeout(resolve, 0));

        // 1. 准备配置文件
        const configYamlPath = syncConfigYaml(config);
        
        // 2. 获取组件路径
        const dylibPath = getBinaryPath('libantigravity.dylib');
        const relayPath = getBinaryPath(RELAY_EXECUTABLE);
        const appPath = config.antigravityAppPath;

        log(`📍 组件路径: 
  Dylib: ${dylibPath}
  Relay: ${relayPath}
  App: ${appPath}`);

        const useHelp = isSudoHelperInstalled();
        const terminal = createPrivilegeTerminal('Antigravity Proxy');
        showPrivilegeTerminalIfNeeded(terminal);

        log(useHelp ? '🔑 使用免密 helper 准备环境…' : '🔑 正在准备环境（需要 sudo 权限）…');

        /* 勿对 EXIT 挂 trap：否则 Electron 正常退出后 shell 结束会误跑 cleanup，把 hosts/中继清掉。
         * 仅在中断安装流程时清理；要还原请用扩展「清理 hosts 与中继」。最后用 exec 驻留进程，避免多余父 shell。 */
        const cleanupCmd = useHelp
            ? `
cleanup() {
  sudo ${SUDO_HELPER_PATH} cleanup-all 2>/dev/null || true
}
trap cleanup INT TERM
`
            : `
cleanup() {
    echo "停止中继..."
    [ -f ${RELAY_PID_PATH} ] && sudo kill $(cat ${RELAY_PID_PATH}) 2>/dev/null
    rm -f ${RELAY_PID_PATH}
    echo "恢复 /etc/hosts..."
    sudo sed -i '' '/# antigravity-proxy$/d' /etc/hosts 2>/dev/null
    sudo dscacheutil -flushcache 2>/dev/null
    sudo killall -HUP mDNSResponder 2>/dev/null
}
trap cleanup INT TERM
`;

        let hostsRelayBlock: string;
        if (useHelp) {
            hostsRelayBlock = `echo "[1/3] 正在写入 /etc/hosts 并刷新 DNS..."
sudo ${SUDO_HELPER_PATH} write-hosts
sudo ${SUDO_HELPER_PATH} flush-dns

echo "[2/3] 启动 SNI 中继 (端口 443)..."
sudo ${SUDO_HELPER_PATH} start-relay ${JSON.stringify(relayPath)} ${JSON.stringify(config.host)} ${JSON.stringify(String(config.port))}
sleep 1
`;
        } else {
            let hostsCmd = '';
            for (const domain of RELAY_DOMAINS) {
                hostsCmd += `grep -qF "${domain}" /etc/hosts || printf "127.0.0.1 ${domain} # antigravity-proxy\\n" | sudo tee -a /etc/hosts > /dev/null\n`;
            }
            hostsRelayBlock = `echo "[1/3] 正在写入 /etc/hosts 并刷新 DNS..."
${hostsCmd}
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

echo "[2/3] 启动 SNI 中继 (端口 443)..."
sudo "${relayPath}" 443 "${config.host}" "${config.port}" > ${RELAY_LOG_PATH} 2>&1 &
echo $! > ${RELAY_PID_PATH}
sleep 1
`;
        }

        const fullScript = `
${cleanupCmd}

${hostsRelayBlock}

echo "[3/3] 注入并启动 Antigravity..."
DYLD_INSERT_LIBRARIES="${dylibPath}" \\
ANTIGRAVITY_CONFIG="${configYamlPath}" \\
ALL_PROXY="${config.type}://${config.host}:${config.port}" \\
HTTPS_PROXY="${config.type}://${config.host}:${config.port}" \\
HTTP_PROXY="${config.type}://${config.host}:${config.port}" \\
exec "${appPath}/Contents/MacOS/Electron"
`;

        const scriptPath = `/tmp/antigravity-start-${Date.now()}.sh`;
        fs.writeFileSync(scriptPath, fullScript, { mode: 0o755 });
        terminal.sendText(`bash ${scriptPath}`);
        isProxyRunning = false;
        warmUpUntilMs = Date.now() + 120_000;
        startStatusPoller();
        setRuntimeIndicator('starting');
        logSuccess('启动指令已发送（全项检测通过后状态栏变绿）');
        schedulePostStartHealthChecks();

    } catch (err: any) {
        logError(`启动失败: ${err.message}`);
        setRuntimeIndicator('bad');
        vscode.window.showErrorMessage(`启动失败: ${err.message}`);
    } finally {
        startBusy = false;
    }
}

/**
 * 仅清理 hosts + SNI 中继（不结束 Antigravity）
 */
export async function cleanupPrivilegedEnvironment(): Promise<void> {
    log('🧹 清理 hosts / 中继...');
    let cleanupError: Error | undefined;
    if (isSudoHelperInstalled()) {
        try {
            const out = await runShell(`/usr/bin/sudo ${SUDO_HELPER_PATH} cleanup-all`);
            if (out?.trim()) { log(`cleanup-all 输出: ${out.trim()}`); }
        } catch (err: any) {
            cleanupError = err instanceof Error ? err : new Error(String(err));
            logError(`helper cleanup-all 失败: ${cleanupError.message}`);
        }
    } else {
        try {
            if (fs.existsSync(RELAY_PID_PATH)) {
                const pid = fs.readFileSync(RELAY_PID_PATH, 'utf-8').trim();
                if (/^\d+$/.test(pid)) {
                    await runShell(`/usr/bin/sudo kill ${pid}`).catch(() => {});
                }
                fs.unlinkSync(RELAY_PID_PATH);
            }
        } catch {
            /* relay pid 读取失败，忽略 */
        }
        try {
            await runShell("/usr/bin/sudo /usr/bin/sed -i '' '/# antigravity-proxy$/d' /etc/hosts");
        } catch (err: any) {
            cleanupError = err instanceof Error ? err : new Error(String(err));
            logError(`清理 hosts 失败: ${cleanupError.message}`);
        }
        await runShell('/usr/bin/sudo dscacheutil -flushcache; /usr/bin/sudo killall -HUP mDNSResponder').catch(() => {});
    }

    // ── 验证 + 回退：helper 脚本用了 || true，exit 0 不代表真正清理成功 ──
    if (!cleanupError) {
        // 验证中继是否已停止
        if (fs.existsSync(RELAY_PID_PATH)) {
            const pid = fs.readFileSync(RELAY_PID_PATH, 'utf-8').trim();
            if (/^\d+$/.test(pid)) {
                const still = await runShell(`ps -p ${pid} -o pid=`, '/tmp', true).catch(() => '');
                if ((still as string).trim()) {
                    log(`⚠️ cleanup-all 后中继 PID ${pid} 仍存活，回退 kill -9`);
                    await runShell(`/usr/bin/sudo kill -9 ${pid}`).catch(() => {});
                    await delay(500);
                }
            }
            try { fs.unlinkSync(RELAY_PID_PATH); } catch {}
        }
        // 验证 /etc/hosts 是否仍含标记行
        try {
            const hosts = fs.readFileSync('/etc/hosts', 'utf-8');
            if (hosts.includes(HOSTS_MARKER)) {
                log('⚠️ cleanup-all 后 /etc/hosts 仍含标记行，回退直接 sed');
                await runShell(
                    `/usr/bin/sudo /usr/bin/sed -i '' '/${HOSTS_MARKER.replace(/[/\\]/g, '\\$&')}/d' /etc/hosts`
                ).catch(e => {
                    logError(`回退 sed 清理 hosts 失败: ${e instanceof Error ? e.message : e}`);
                });
                await runShell('/usr/bin/sudo dscacheutil -flushcache; /usr/bin/sudo killall -HUP mDNSResponder').catch(() => {});
            }
        } catch {}
        // 最终验证
        try {
            const hostsAfter = fs.readFileSync('/etc/hosts', 'utf-8');
            if (hostsAfter.includes(HOSTS_MARKER)) {
                cleanupError = new Error('/etc/hosts 仍含 antigravity-proxy 行，可能缺少 sudo 权限');
            }
        } catch {}
    }

    if (cleanupError) {
        const helperInstalled = isSudoHelperInstalled();
        const hint = helperInstalled
            ? `免密 helper 已装但执行失败，请重新点「安装免密 sudo」更新 /usr/local/bin/ 后重试。` +
              `或在终端手动执行：sudo sed -i '' '/# antigravity-proxy$/d' /etc/hosts`
            : `请先点「安装免密 sudo」（仅需输入一次密码），再重试。` +
              `或在终端手动执行：sudo sed -i '' '/# antigravity-proxy$/d' /etc/hosts`;
        void vscode.window.showErrorMessage(
            `⚠️ hosts / 中继清理失败：${cleanupError.message}。${hint}`,
            '安装 / 重装 helper'
        ).then(choice => {
            if (choice === '安装 / 重装 helper') {
                void vscode.commands.executeCommand('antigravity-proxy.installSudoHelper');
            }
        });
        throw cleanupError;
    }
    logSuccess('特权环境已清理（hosts + relay）');
}

/**
 * 手动执行「第 4 步」：写入 hosts、刷新 DNS、启动 SNI 中继（不启动 Antigravity）
 * @param configOverride 传入时使用该配置（如配置页未保存的表单），否则用已写入的设置
 */
export async function preparePrivilegedEnvironment(configOverride?: ProxyConfig): Promise<void> {
    const config = configOverride ?? getConfig();
    if (!isConfigComplete(config)) {
        vscode.window.showWarningMessage('请先完成代理配置', '打开配置').then(c => {
            if (c === '打开配置') {
                vscode.commands.executeCommand('antigravity-proxy.openSettings');
            }
        });
        return;
    }

    const needVisibleTerminal = !isSudoHelperInstalled();
    if (needVisibleTerminal) {
        showLog();
    }
    try {
        syncConfigYaml(config);
        const relayPath = getBinaryPath(RELAY_EXECUTABLE);

        const script = isSudoHelperInstalled()
            ? `set -e
HELP="${SUDO_HELPER_PATH}"
echo "[准备环境] 使用已安装的免密 helper"
sudo "$HELP" stop-relay || true
echo "[1/2] hosts + DNS"
sudo "$HELP" write-hosts
sudo "$HELP" flush-dns
echo "[2/2] SNI 中继 (443 → ${config.host}:${config.port})…"
sudo "$HELP" start-relay ${JSON.stringify(relayPath)} ${JSON.stringify(config.host)} ${JSON.stringify(String(config.port))}
sleep 1
echo "完成。日志: ${RELAY_LOG_PATH}"
`
            : (() => {
                  let hostsCmd = '';
                  for (const domain of RELAY_DOMAINS) {
                      hostsCmd += `grep -qF "${domain}" /etc/hosts || printf "127.0.0.1 ${domain} # antigravity-proxy\\n" | sudo tee -a /etc/hosts > /dev/null\n`;
                  }
                  return `set -e
echo "[准备环境] 若已有 relay，先停止旧进程..."
if [ -f ${RELAY_PID_PATH} ]; then
  OLD="$(cat ${RELAY_PID_PATH})"
  sudo kill "$OLD" 2>/dev/null || true
  rm -f ${RELAY_PID_PATH}
fi
echo "[1/2] 写入 /etc/hosts 并刷新 DNS..."
${hostsCmd}
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
echo "[2/2] 启动 SNI 中继 (端口 443)..."
sudo "${relayPath}" 443 "${config.host}" "${config.port}" > ${RELAY_LOG_PATH} 2>&1 &
echo $! > ${RELAY_PID_PATH}
sleep 1
echo "完成。日志: ${RELAY_LOG_PATH}"
`;
              })();

        const scriptPath = `/tmp/antigravity-prepare-${Date.now()}.sh`;
        fs.writeFileSync(scriptPath, script, { mode: 0o755 });
        const terminal = createPrivilegeTerminal('Antigravity Prepare');
        showPrivilegeTerminalIfNeeded(terminal);
        terminal.sendText(`bash ${scriptPath}`);
        const hint = isSudoHelperInstalled()
            ? '已使用免密 helper，一般不应再提示密码。若仍提示请检查 /etc/sudoers.d/antigravity-proxy。'
            : '请在终端输入 sudo 密码。可命令面板「一次性安装免密 sudo」以避免日后重复输入。';
        logSuccess('已发送「准备特权环境」脚本');
        if (needVisibleTerminal) {
            vscode.window.showInformationMessage(hint);
        }
    } catch (err: any) {
        logError(`准备环境失败: ${err.message}`);
        vscode.window.showErrorMessage(err.message);
    }
}

/**
 * 停止代理
 */
export async function stop(): Promise<void> {
    log('⏹ 正在停止代理...');
    try {
        warmUpUntilMs = 0;
        await runShell('pkill -f "Antigravity.app/Contents/MacOS/Electron"').catch(() => {});
        await cleanupPrivilegedEnvironment();

        isProxyRunning = false;
        stopStatusPoller();
        setRuntimeIndicator('bad');
        logSuccess('代理已停止');
    } catch (err: any) {
        logError(`停止失败: ${err.message}`);
    }
}

function formatAdminPrivilegeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (/User canceled|user canceled|用户取消|取消了|-128|\(-128\)/i.test(raw)) {
        return '已取消系统密码框，未完成操作。';
    }
    if (/not authorized|Not authorized|不允许|automation|Operation not permitted|EPERM/i.test(raw)) {
        return '系统未允许当前应用弹出提权对话框。请改用已打开的「终端」窗口完成，或在 系统设置 → 隐私与安全性 中检查 Cursor 相关权限。';
    }
    return raw || '提权执行失败';
}

/**
 * 强制重签名
 */
export async function resign(): Promise<void> {
    const config = getConfig();
    const appPath = resolveAntigravityBundlePath();
    if (!appPath) {
        vscode.window.showErrorMessage('未找到 Antigravity.app，请先配置或安装到 /Applications');
        return;
    }

    log('🔑 正在执行重签名（系统密码框提权）…');
    const configYamlPath = syncConfigYaml(config);
    const scriptPath = writeRootResignScript(appPath, configYamlPath);
    try {
        const out = await runWithAdminPrivileges(scriptPath);
        if (out) {
            log(out);
        }
        logSuccess('重签名已完成');
        vscode.window.showInformationMessage('重签名已完成（已使用 macOS 管理员密码框提权）');
    } catch (e: unknown) {
        logError(`重签名（系统对话框）: ${e instanceof Error ? e.message : String(e)}`);
        try {
            const launcher = writeTerminalSudoLauncher(scriptPath, 'Antigravity Proxy · 强制重签名（终端 sudo）');
            await openLauncherInTerminalApp(launcher);
            void vscode.window.showInformationMessage(
                '系统提权对话框未成功。已在独立「终端」窗口打开脚本，请在该窗口输入管理员密码直至结束。'
            );
        } catch (e2: unknown) {
            const msg = formatAdminPrivilegeError(e);
            const extra = e2 instanceof Error ? e2.message : String(e2);
            logError(`重签名兜底失败: ${extra}`);
            void vscode.window.showErrorMessage(`重签名失败：${msg}`);
        }
    }
}

/**
 * 关闭代理并尽量恢复默认：结束 Antigravity、清理 hosts/SNI 中继、移除 Info.plist 中的 LSEnvironment（含 DYLD / 代理变量）并重签名，之后可从访达正常启动、不再注入。
 */
export async function restoreStockBehavior(): Promise<void> {
    log('🔄 正在关闭代理并恢复默认启动方式…');
    warmUpUntilMs = 0;

    // ── 前置检查：helper 已装但版本过期时，先拦截并要求重装 ──
    if (isSudoHelperInstalled() && isHelperOutdated(getExtensionRoot())) {
        const choice = await vscode.window.showWarningMessage(
            '⚠️ 免密 sudo helper 版本已过期（扩展已更新，/usr/local/bin/ 未同步）。' +
            '继续执行将无法清理 hosts / 中继，请先重装 helper 后再点「完全停用代理」。',
            { modal: true },
            '立即重装 helper'
        );
        if (choice === '立即重装 helper') {
            void vscode.commands.executeCommand('antigravity-proxy.installSudoHelper');
        }
        return;
    }

    // 先写全局禁用标志（不依赖 settings 作用域），阻止 auto-prepare 在重启后跨工作区重建
    await setProxyManuallyDisabled(true);
    try {
        await disableAutoLaunchInAllConfigScopes();
    } catch (e: any) {
        logError(`写入设置失败（自动启动/自动准备）: ${e?.message || e}`);
    }
    log('已在所有配置作用域关闭「自动启动」与「自动准备 hosts/中继」（含工作区 settings）。');
    try {
        await runShell('pkill -f "Antigravity.app/Contents/MacOS/Electron"').catch(() => {});
        // 等待进程实际退出（最多 8 秒，每秒检查一次），避免 codesign 时报 resource busy
        let waited = 0;
        while (waited < 8000) {
            await delay(1000);
            waited += 1000;
            const still = await runShell('pgrep -f "Antigravity.app/Contents/MacOS/Electron"').catch(() => '');
            if (!still || !(still as string).trim()) {
                break;
            }
        }
        await cleanupPrivilegedEnvironment();
    } catch (err: any) {
        logError(`清理环境时出错: ${err.message}`);
        // cleanupPrivilegedEnvironment 抛出说明 hosts 未清干净，停止后续流程
        // 错误弹窗已在 cleanupPrivilegedEnvironment 内部弹出，此处不再重复
        isProxyRunning = false;
        stopStatusPoller();
        setRuntimeIndicator('bad');
        return;
    }

    const appPath = resolveAntigravityBundlePath();
    let stripOk = false;
    let stripDeferredToTerminal = false;
    if (appPath && isSudoHelperInstalled()) {
        try {
            await runShell(`/usr/bin/sudo ${SUDO_HELPER_PATH} strip-lsenvironment ${JSON.stringify(appPath)}`, '/tmp', false, 120000);
            stripOk = true;
            logSuccess('已通过免密 helper 移除 LSEnvironment 并完成重签名');
        } catch (e: any) {
            logError(
                `免密 strip-lsenvironment 失败（将改用系统密码框）：${e.message}。若脚本过旧，请重新「安装免密 sudo」更新 /usr/local/bin。`
            );
        }
    }

    if (appPath && !stripOk) {
        const scriptPath = writeRootStripStockScript(appPath);
        try {
            const out = await runWithAdminPrivileges(scriptPath);
            if (out) {
                log(out);
            }
            stripOk = true;
            logSuccess('已通过系统密码框移除 LSEnvironment 并完成重签名');
        } catch (e: unknown) {
            logError(`恢复原生（系统对话框）: ${e instanceof Error ? e.message : String(e)}`);
            try {
                const launcher = writeTerminalSudoLauncher(scriptPath, 'Antigravity Proxy · 恢复原生启动（终端 sudo）');
                await openLauncherInTerminalApp(launcher);
                stripDeferredToTerminal = true;
                logSuccess('已在「终端.app」打开恢复脚本（请在系统终端窗口输入密码）');
            } catch (e2: unknown) {
                const msg = formatAdminPrivilegeError(e);
                const extra = e2 instanceof Error ? e2.message : String(e2);
                logError(`恢复原生兜底失败: ${extra}`);
                void vscode.window.showErrorMessage(
                    `未能完成移除注入/重签名：${msg}。可查看输出通道中的脚本路径，在系统「终端」手动执行：sudo /bin/bash <路径>`
                );
            }
        }
    }

    isProxyRunning = false;
    stopStatusPoller();
    setRuntimeIndicator('bad');

    // 检测系统代理是否仍指向本地，若是则单独弹警告（最常见的「停用后断网」原因）
    const sysProxyWarn = await checkSystemProxyForWarning();
    if (sysProxyWarn) {
        log(sysProxyWarn);
        void vscode.window.showWarningMessage(sysProxyWarn, '前往系统设置 → 代理', '知道了').then(choice => {
            if (choice === '前往系统设置 → 代理') {
                void vscode.env.openExternal(vscode.Uri.parse('x-apple.systempreferences:com.apple.Network-Settings.extension'));
            }
        });
    }

    if (appPath && stripOk) {
        logRestoreNoProxyFollowUp('full');
        showRestoreNoProxyToast(
            '完全停用已完成：hosts/中继已清，LSEnvironment 已移除并重签名。请从访达启动 Antigravity。更多项（多副本、终端代理变量、系统代理、DNS）已写入输出日志。'
        );
    } else if (appPath && stripDeferredToTerminal) {
        logRestoreNoProxyFollowUp('terminal_pending');
        showRestoreNoProxyToast(
            'hosts/relay 已清理；已在「终端.app」打开恢复脚本。请在终端内输入密码直至脚本结束，再从访达启动 Antigravity。后续注意项已写入输出日志。'
        );
    } else if (!appPath) {
        log('未找到 Antigravity.app，仅完成 hosts/relay 清理；若要移除 LSEnvironment，请在配置页填写应用路径后再执行。');
        logRestoreNoProxyFollowUp('no_app_path');
        void vscode.window
            .showWarningMessage(
                '已清理 hosts 与中继并退出 Antigravity；未找到 .app 路径，未修改 Info.plist。请在配置中指定与实际访达打开路径一致的 .app 后，再次执行「完全停用代理」。详细说明已写入输出日志。',
                '查看日志'
            )
            .then(choice => {
                if (choice === '查看日志') {
                    showLog();
                }
            });
    }

    for (const fn of restoreStockListeners) {
        try { fn(); } catch {}
    }
}

/**
 * 尝试恢复运行状态（用于扩展激活时）
 */
export async function recoverStatus(): Promise<void> {
    if (!isConfigComplete(getConfig())) {
        warmUpUntilMs = 0;
        setRuntimeIndicator('bad');
        return;
    }
    startStatusPoller();
    const running = await checkActualStatus();
    if (running) {
        log('正在恢复运行状态（全项检测已通过）…');
    }
    applyHealthProbeResult(running);
}
