import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig, isConfigComplete, syncConfigYaml, ProxyConfig } from './configManager';
import { log, logError, logSuccess, showLog } from './logger';
import { validateAntigravityPath } from './validator';
import { RELAY_DOMAINS } from './relayDomains';
import { RELAY_EXECUTABLE, RELAY_LOG_PATH, RELAY_PID_PATH } from './runtimeConstants';
import { isSudoHelperInstalled, SUDO_HELPER_PATH } from './sudoHelper';
import { setRuntimeIndicator } from './statusIndicator';
import { isProxyFullyHealthy } from './diagnostics';

let isProxyRunning = false;
let statusInterval: NodeJS.Timeout | undefined;
let extensionPathOverride: string | undefined;
let startBusy = false;
let statusPollInFlight = false;
/** 一键启动后若在暖机期内未通过全量检测，保持黄色而非立刻红色 */
let warmUpUntilMs = 0;

export function initProxyManager(extensionPath: string): void {
    extensionPathOverride = extensionPath;
}

function getExtensionRoot(): string {
    if (extensionPathOverride) {
        return extensionPathOverride;
    }
    const extension = vscode.extensions.getExtension('ray2666.antigravity-proxy');
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

function showPrivilegeTerminalIfNeeded(terminal: vscode.Terminal): void {
    if (!isSudoHelperInstalled()) {
        terminal.show(true);
    }
}

/** @param silent 为 true 时不写入输出通道（用于定时状态探测，避免刷屏） */
function runShell(cmd: string, cwd: string = '/tmp', silent = false): Promise<string> {
    return new Promise((resolve, reject) => {
        if (!silent) {
            log(`执行命令: ${cmd}`);
        }
        cp.exec(cmd, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
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

        const scriptPath = '/tmp/antigravity-start.sh';
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
    try {
        if (isSudoHelperInstalled()) {
            await runShell(`sudo ${SUDO_HELPER_PATH} cleanup-all`).catch(() => {});
        } else {
            try {
                if (fs.existsSync(RELAY_PID_PATH)) {
                    const pid = fs.readFileSync(RELAY_PID_PATH, 'utf-8').trim();
                    await runShell(`sudo kill ${pid}`).catch(() => {});
                    fs.unlinkSync(RELAY_PID_PATH);
                }
            } catch {
                /* ignore */
            }
            await runShell("sudo sed -i '' '/# antigravity-proxy$/d' /etc/hosts").catch(() => {});
            await runShell('sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder').catch(() => {});
        }
        logSuccess('特权环境已清理（hosts + relay）');
    } catch (err: any) {
        logError(`清理失败: ${err.message}`);
        throw err;
    }
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

        const scriptPath = '/tmp/antigravity-prepare.sh';
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
        await runShell('pkill -f "Antigravity.app"').catch(() => {});
        await cleanupPrivilegedEnvironment();

        isProxyRunning = false;
        stopStatusPoller();
        setRuntimeIndicator('bad');
        logSuccess('代理已停止');
    } catch (err: any) {
        logError(`停止失败: ${err.message}`);
    }
}

/**
 * 强制重签名
 */
export async function resign(): Promise<void> {
    const config = getConfig();
    const appPath = config.antigravityAppPath;
    if (!appPath) {
        vscode.window.showErrorMessage('未找到 Antigravity.app，请先配置');
        return;
    }

    log('🔑 正在执行重签名...');
    const entitlementsPath = '/tmp/antigravity_entitlements.plist';
    const entitlementsContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.automation.apple-events</key><true/>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.device.audio-input</key><true/>
  <key>com.apple.security.device.camera</key><true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>`;
    
    fs.writeFileSync(entitlementsPath, entitlementsContent);

    const terminal = vscode.window.createTerminal({ name: 'Antigravity Resign' });
    terminal.show(true);

    const targets = [
        `"${appPath}/Contents/MacOS/Electron"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper (GPU).app/Contents/MacOS/Antigravity Helper (GPU)"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)"`,
        `"${appPath}/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"`
    ];

    const configYamlPath = syncConfigYaml(config);
    let signCmd = `echo "正在写入 LSEnvironment 并重签名..."\n`;
    signCmd += `PLIST="${appPath}/Contents/Info.plist"\n`;
    signCmd += `sudo /usr/libexec/PlistBuddy -c "Delete :LSEnvironment" "$PLIST" 2>/dev/null || true\n`;
    signCmd += `sudo /usr/libexec/PlistBuddy -c "Add :LSEnvironment dict" "$PLIST"\n`;
    signCmd += `sudo /usr/libexec/PlistBuddy -c "Add :LSEnvironment:ANTIGRAVITY_CONFIG string ${configYamlPath}" "$PLIST"\n`;

    for (const target of targets) {
        signCmd += `if [ -f ${target} ]; then echo "签名: ${target}"; sudo codesign -f -s - --entitlements ${entitlementsPath} ${target}; fi\n`;
    }

    terminal.sendText(signCmd);
    logSuccess('重签名指令已发送');
}

export function getProxyRunning(): boolean {
    return isProxyRunning;
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
