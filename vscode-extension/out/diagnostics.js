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
exports.collectDiagnostics = collectDiagnostics;
exports.needsPrepareEnvironmentSetup = needsPrepareEnvironmentSetup;
exports.isProxyFullyHealthy = isProxyFullyHealthy;
const fs = __importStar(require("fs"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const validator_1 = require("./validator");
const relayDomains_1 = require("./relayDomains");
const runtimeConstants_1 = require("./runtimeConstants");
const sudoHelper_1 = require("./sudoHelper");
function execShort(cmd, timeout = 8000) {
    return new Promise((resolve, reject) => {
        cp.exec(cmd, { timeout }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error(stderr || err.message));
            }
            else {
                resolve(stdout);
            }
        });
    });
}
async function checkRelayProcess() {
    if (!fs.existsSync(runtimeConstants_1.RELAY_PID_PATH)) {
        return { ok: false, detail: `未找到 ${runtimeConstants_1.RELAY_PID_PATH}（中继可能未启动）` };
    }
    const pid = fs.readFileSync(runtimeConstants_1.RELAY_PID_PATH, 'utf-8').trim();
    if (!pid) {
        return { ok: false, detail: 'PID 文件为空' };
    }
    try {
        await execShort(`ps -p ${pid} -o pid=`);
        return { ok: true, detail: `SNI 中继进程存活 (PID ${pid})，日志: ${runtimeConstants_1.RELAY_LOG_PATH}` };
    }
    catch {
        return { ok: false, detail: `PID ${pid} 已不存在，请重新执行「准备特权环境」` };
    }
}
function readHostsStatus() {
    let content;
    try {
        content = fs.readFileSync('/etc/hosts', 'utf-8');
    }
    catch (e) {
        return {
            ok: false,
            detail: `无法读取 /etc/hosts: ${e.message}`,
            missing: [...relayDomains_1.RELAY_DOMAINS],
        };
    }
    const lines = content.split('\n');
    const lineOk = (domain) => lines.some(line => {
        const t = line.trim();
        return t.includes('127.0.0.1') && t.includes(domain) && t.includes(relayDomains_1.HOSTS_MARKER);
    });
    const missing = [];
    for (const domain of relayDomains_1.RELAY_DOMAINS) {
        if (!lineOk(domain)) {
            missing.push(domain);
        }
    }
    if (missing.length === 0) {
        return {
            ok: true,
            detail: `已写入 ${relayDomains_1.RELAY_DOMAINS.length} 个域名 → 127.0.0.1（${relayDomains_1.HOSTS_MARKER}）`,
            missing: [],
        };
    }
    return {
        ok: false,
        detail: `缺少或未完整写入: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
        missing,
    };
}
function bundledBin(extensionRoot, name) {
    const p = path.join(extensionRoot, 'bin', name);
    return { ok: fs.existsSync(p), path: p };
}
/**
 * 收集环境诊断（不修改系统）
 */
async function collectDiagnostics(extensionRoot, config) {
    const items = [];
    const timeout = Math.min(Math.max(config.timeout || 5000, 1000), 30000);
    const h = (0, validator_1.validateHost)(config.host);
    const p = (0, validator_1.validatePort)(config.port);
    if (!h.valid || !p.valid) {
        items.push({
            key: 'upstream',
            title: '上游代理地址',
            ok: false,
            detail: [h.message, p.message].filter(m => m.includes('❌')).join(' '),
            hint: '在配置页修正代理地址与端口',
        });
    }
    else {
        const tcp = await (0, validator_1.validateProxyConnection)(config.host, config.port, timeout);
        items.push({
            key: 'upstream_tcp',
            title: '上游代理（TCP 连通）',
            ok: tcp.valid,
            detail: tcp.message,
            hint: tcp.valid ? undefined : '请确认 Clash / V2Ray 等本地代理已开启且端口正确',
        });
        if (config.type === 'socks5') {
            const socks = await (0, validator_1.validateSocks5Handshake)(config.host, config.port, timeout);
            items.push({
                key: 'upstream_socks5',
                title: '上游代理（SOCKS5 握手）',
                ok: socks.valid,
                detail: socks.message,
                hint: socks.valid
                    ? undefined
                    : '中继与注入库目前按 SOCKS5 连接上游；HTTP 类型仅部分生效',
            });
        }
        else {
            items.push({
                key: 'upstream_http',
                title: '上游代理类型',
                ok: true,
                detail: `当前为 HTTP；SNI 中继 (${runtimeConstants_1.RELAY_EXECUTABLE}) 仍按 SOCKS5 连接上述端口`,
                hint: '若连接失败，请将本地混合端口改为 SOCKS5 或在配置中选 socks5',
            });
        }
    }
    const ag = (0, validator_1.validateAntigravityPath)(config.antigravityAppPath);
    items.push({
        key: 'antigravity',
        title: 'Antigravity.app',
        ok: ag.valid,
        detail: ag.message,
        hint: ag.valid ? undefined : '安装 Antigravity 或在配置中指定 .app 路径',
    });
    const dylib = bundledBin(extensionRoot, 'libantigravity.dylib');
    const relay = bundledBin(extensionRoot, runtimeConstants_1.RELAY_EXECUTABLE);
    items.push({
        key: 'bin_dylib',
        title: '内置 libantigravity.dylib',
        ok: dylib.ok,
        detail: dylib.ok ? dylib.path : `缺失: ${dylib.path}`,
        hint: dylib.ok ? undefined : '请使用完整打包的 VSIX 或从源码编译后放入 extension/bin',
    });
    items.push({
        key: 'bin_relay',
        title: `内置 ${runtimeConstants_1.RELAY_EXECUTABLE}`,
        ok: relay.ok,
        detail: relay.ok ? relay.path : `缺失: ${relay.path}`,
        hint: relay.ok ? undefined : '同上',
    });
    const sudoHint = (0, sudoHelper_1.isSudoHelperInstalled)()
        ? `已安装免密 sudo helper：${sudoHelper_1.SUDO_HELPER_PATH}（准备/启动不应再反复要密码）`
        : `未安装免密安装：命令面板「一次性安装免密 sudo」，仅需密码一次，之后走 ${sudoHelper_1.SUDO_HELPER_PATH}`;
    items.push({
        key: 'sudo_helper',
        title: '免密 sudo（可选）',
        ok: (0, sudoHelper_1.isSudoHelperInstalled)(),
        detail: sudoHint,
        hint: (0, sudoHelper_1.isSudoHelperInstalled)()
            ? undefined
            : '诊断页顶部或本条下方的「立即安装」；或在命令面板搜索「一次性安装免密 sudo」',
    });
    const prepareWhere = '免密 sudo 只省略密码，不会自动写 hosts。请点「准备特权环境」或开启设置「自动准备 hosts/中继」（需已装免密 helper）。亦可①配置页②诊断页顶部③命令面板。';
    const hosts = readHostsStatus();
    items.push({
        key: 'hosts',
        title: '/etc/hosts（第 4 步：域名指向本机）',
        ok: hosts.ok,
        detail: hosts.detail,
        hint: hosts.ok
            ? undefined
            : `未写入或未完整：${prepareWhere}。未执行过则不会出现 relay 的 PID 文件。`,
    });
    const relayProc = await checkRelayProcess();
    items.push({
        key: 'relay',
        title: 'SNI 中继（第 4 步：本机 :443）',
        ok: relayProc.ok,
        detail: relayProc.detail,
        hint: relayProc.ok
            ? undefined
            : `无 PID 文件表示中继尚未成功启动：先完成 hosts 并执行「准备特权环境」或「一键启动」；若已执行仍失败请查看 ${runtimeConstants_1.RELAY_LOG_PATH}`,
    });
    items.push({
        key: 'privilege',
        title: '特权 / 签名说明',
        ok: true,
        detail: 'hosts、监听 443、codesign 需要管理员密码。「准备特权环境」只写 hosts + 启动 relay；完整一键启动另需注入 Antigravity。',
        hint: prepareWhere + '。relay 起停不会自动出现在配置页，需自行检测或看日志。',
    });
    return items;
}
/** hosts 或 SNI 中继未就绪时需要执行「准备特权环境」 */
async function needsPrepareEnvironmentSetup() {
    const hosts = readHostsStatus();
    if (!hosts.ok) {
        return true;
    }
    const relay = await checkRelayProcess();
    if (!relay.ok) {
        return true;
    }
    return false;
}
/**
 * 状态栏「全绿」条件：与诊断面板核心项一致（hosts、relay、Electron、上游连通、SOCKS5 等），任一步失败则为 false。
 */
async function isProxyFullyHealthy(extensionRoot, config) {
    try {
        if (!config.host || !config.port) {
            return false;
        }
        const ag = (0, validator_1.validateAntigravityPath)(config.antigravityAppPath);
        if (!ag.valid) {
            return false;
        }
        const dylib = bundledBin(extensionRoot, 'libantigravity.dylib');
        const relay = bundledBin(extensionRoot, runtimeConstants_1.RELAY_EXECUTABLE);
        if (!dylib.ok || !relay.ok) {
            return false;
        }
        const hosts = readHostsStatus();
        if (!hosts.ok) {
            return false;
        }
        const relayProc = await checkRelayProcess();
        if (!relayProc.ok) {
            return false;
        }
        try {
            await execShort('pgrep -f "Antigravity.app/Contents/MacOS/Electron"');
        }
        catch {
            return false;
        }
        const timeout = Math.min(Math.max(config.timeout || 5000, 1000), 30000);
        const tcp = await (0, validator_1.validateProxyConnection)(config.host, config.port, timeout);
        if (!tcp.valid) {
            return false;
        }
        if (config.type === 'socks5') {
            const socks = await (0, validator_1.validateSocks5Handshake)(config.host, config.port, timeout);
            if (!socks.valid) {
                return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=diagnostics.js.map