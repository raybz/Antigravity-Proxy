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
exports.start = start;
exports.stop = stop;
exports.resign = resign;
exports.getProxyRunning = getProxyRunning;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const configManager_1 = require("./configManager");
const statusBar_1 = require("./statusBar");
const logger_1 = require("./logger");
let isProxyRunning = false;
/**
 * 确保二进制文件具有执行权限
 */
function ensureExecutable(filePath) {
    try {
        const stats = fs.statSync(filePath);
        // 检查所有者是否有执行权限 (0100)
        if (!(stats.mode & fs.constants.S_IXUSR)) {
            (0, logger_1.log)(`正在修复执行权限: ${path.basename(filePath)}`);
            fs.chmodSync(filePath, 0o755);
        }
    }
    catch (err) {
        (0, logger_1.log)(`权限检查跳过: ${err.message}`);
    }
}
/**
 * 获取二进制文件路径
 */
function getBinaryPath(name) {
    const config = (0, configManager_1.getConfig)();
    // 2. 否则使用插件内置的 bin
    // 优先通过 vscode.extensions 获取，如果获取不到则尝试相对路径
    let extensionPath;
    const extension = vscode.extensions.getExtension('antigravity.antigravity-proxy');
    if (extension) {
        extensionPath = extension.extensionPath;
    }
    else {
        // 兜底方案：如果是直接从源码运行或 ID 不匹配，尝试从当前文件所在目录向上推
        extensionPath = path.join(__dirname, '..');
    }
    const bundledPath = path.join(extensionPath, 'bin', name);
    if (fs.existsSync(bundledPath)) {
        ensureExecutable(bundledPath);
        return bundledPath;
    }
    const msg = `未找到二进制文件: ${name}。请确保插件安装完整，或手动配置项目路径。`;
    (0, logger_1.logError)(msg);
    throw new Error(msg);
}
/**
 * 执行 Shell 命令并记录日志
 */
function runShell(cmd, cwd = '/tmp') {
    return new Promise((resolve, reject) => {
        (0, logger_1.log)(`执行命令: ${cmd}`);
        cp.exec(cmd, { cwd, timeout: 60000 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            }
            else {
                resolve(stdout);
            }
        });
    });
}
/**
 * 启动代理流程
 */
async function start() {
    const config = (0, configManager_1.getConfig)();
    if (!(0, configManager_1.isConfigComplete)(config)) {
        vscode.window.showWarningMessage('请先完成配置', '打开配置').then(choice => {
            if (choice === '打开配置') {
                vscode.commands.executeCommand('antigravity-proxy.openSettings');
            }
        });
        (0, statusBar_1.updateStatus)('not-configured');
        return;
    }
    (0, statusBar_1.updateStatus)('starting');
    (0, logger_1.showLog)();
    try {
        // 1. 准备配置文件
        const configYamlPath = (0, configManager_1.syncConfigYaml)(config);
        // 2. 获取组件路径
        const dylibPath = getBinaryPath('libantigravity.dylib');
        const relayPath = getBinaryPath('antigravity-relay');
        const appPath = config.antigravityAppPath;
        (0, logger_1.log)(`📍 组件路径: 
  Dylib: ${dylibPath}
  Relay: ${relayPath}
  App: ${appPath}`);
        // 3. 构造启动命令集 (模仿 Makefile)
        const domains = [
            'daily-cloudcode-pa.googleapis.com',
            'cloudcode-pa.googleapis.com',
            'oauth2.googleapis.com',
            'accounts.google.com',
            'www.googleapis.com',
            'generativelanguage.googleapis.com',
            'content-cloudcode-pa.googleapis.com'
        ];
        const terminal = vscode.window.createTerminal({
            name: 'Antigravity Proxy',
            cwd: '/tmp'
        });
        terminal.show();
        (0, logger_1.log)('🔑 正在准备环境（需要 sudo 权限）...');
        // 写入清理逻辑的 shell 函数
        const cleanupCmd = `
cleanup() {
    echo "停止中继..."
    [ -f /tmp/antigravity-relay.pid ] && sudo kill $(cat /tmp/antigravity-relay.pid) 2>/dev/null
    rm -f /tmp/antigravity-relay.pid
    echo "恢复 /etc/hosts..."
    sudo sed -i '' '/# antigravity-proxy$/d' /etc/hosts 2>/dev/null
    sudo dscacheutil -flushcache 2>/dev/null
    sudo killall -HUP mDNSResponder 2>/dev/null
}
trap cleanup EXIT INT TERM
`;
        // 写入 hosts 逻辑
        let hostsCmd = '';
        for (const domain of domains) {
            hostsCmd += `grep -qF "${domain}" /etc/hosts || printf "127.0.0.1 ${domain} # antigravity-proxy\\n" | sudo tee -a /etc/hosts > /dev/null\n`;
        }
        // 构造完整的启动脚本
        const fullScript = `
${cleanupCmd}

echo "[1/3] 正在写入 /etc/hosts 并刷新 DNS..."
${hostsCmd}
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder

echo "[2/3] 启动 SNI 中继 (端口 443)..."
sudo "${relayPath}" 443 "${config.host}" "${config.port}" > /tmp/antigravity-relay.log 2>&1 &
echo $! > /tmp/antigravity-relay.pid
sleep 1

echo "[3/3] 注入并启动 Antigravity..."
DYLD_INSERT_LIBRARIES="${dylibPath}" \\
ANTIGRAVITY_CONFIG="${configYamlPath}" \\
ALL_PROXY="${config.type}://${config.host}:${config.port}" \\
HTTPS_PROXY="${config.type}://${config.host}:${config.port}" \\
HTTP_PROXY="${config.type}://${config.host}:${config.port}" \\
"${appPath}/Contents/MacOS/Electron"
`;
        terminal.sendText(fullScript);
        isProxyRunning = true;
        (0, statusBar_1.updateStatus)('running');
        (0, logger_1.logSuccess)('启动指令已发送');
    }
    catch (err) {
        (0, logger_1.logError)(`启动失败: ${err.message}`);
        (0, statusBar_1.updateStatus)('stopped');
        vscode.window.showErrorMessage(`启动失败: ${err.message}`);
    }
}
/**
 * 停止代理
 */
async function stop() {
    (0, logger_1.log)('⏹ 正在停止代理...');
    try {
        // 1. 杀掉 App
        await runShell('pkill -f "Antigravity.app"').catch(() => { });
        // 2. 杀掉 Relay
        try {
            if (fs.existsSync('/tmp/antigravity-relay.pid')) {
                const pid = fs.readFileSync('/tmp/antigravity-relay.pid', 'utf-8').trim();
                await runShell(`sudo kill ${pid}`);
                fs.unlinkSync('/tmp/antigravity-relay.pid');
            }
        }
        catch { }
        // 3. 清理 hosts
        await runShell("sudo sed -i '' '/# antigravity-proxy$/d' /etc/hosts").catch(() => { });
        await runShell("sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder").catch(() => { });
        isProxyRunning = false;
        (0, statusBar_1.updateStatus)('stopped');
        (0, logger_1.logSuccess)('代理已停止');
    }
    catch (err) {
        (0, logger_1.logError)(`停止失败: ${err.message}`);
    }
}
/**
 * 强制重签名
 */
async function resign() {
    const config = (0, configManager_1.getConfig)();
    const appPath = config.antigravityAppPath;
    if (!appPath) {
        vscode.window.showErrorMessage('未找到 Antigravity.app，请先配置');
        return;
    }
    (0, logger_1.log)('🔑 正在执行重签名...');
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
    terminal.show();
    const targets = [
        `"${appPath}/Contents/MacOS/Electron"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper (GPU).app/Contents/MacOS/Antigravity Helper (GPU)"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper (Renderer).app/Contents/MacOS/Antigravity Helper (Renderer)"`,
        `"${appPath}/Contents/Frameworks/Antigravity Helper (Plugin).app/Contents/MacOS/Antigravity Helper (Plugin)"`,
        `"${appPath}/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm"`
    ];
    const configYamlPath = (0, configManager_1.syncConfigYaml)(config);
    let signCmd = `echo "正在写入 LSEnvironment 并重签名..."\n`;
    signCmd += `PLIST="${appPath}/Contents/Info.plist"\n`;
    signCmd += `sudo /usr/libexec/PlistBuddy -c "Delete :LSEnvironment" "$PLIST" 2>/dev/null || true\n`;
    signCmd += `sudo /usr/libexec/PlistBuddy -c "Add :LSEnvironment dict" "$PLIST"\n`;
    signCmd += `sudo /usr/libexec/PlistBuddy -c "Add :LSEnvironment:ANTIGRAVITY_CONFIG string ${configYamlPath}" "$PLIST"\n`;
    for (const target of targets) {
        signCmd += `if [ -f ${target} ]; then echo "签名: ${target}"; sudo codesign -f -s - --entitlements ${entitlementsPath} ${target}; fi\n`;
    }
    terminal.sendText(signCmd);
    (0, logger_1.logSuccess)('重签名指令已发送');
}
function getProxyRunning() {
    return isProxyRunning;
}
//# sourceMappingURL=proxyManager.js.map