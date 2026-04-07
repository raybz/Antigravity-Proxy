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
exports.SUDO_HELPER_PATH = void 0;
exports.isSudoHelperInstalled = isSudoHelperInstalled;
exports.isHelperBinaryOnlyInstalled = isHelperBinaryOnlyInstalled;
exports.isHelperOutdated = isHelperOutdated;
exports.sudoersNopasswdLine = sudoersNopasswdLine;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
/** 固定安装路径，便于单条 sudoers NOPASSWD 白名单 */
exports.SUDO_HELPER_PATH = '/usr/local/bin/antigravity-proxy-helper';
function isSudoHelperInstalled() {
    try {
        fs.accessSync(exports.SUDO_HELPER_PATH, fs.constants.X_OK);
        // 同时确认 sudoers 免密规则存在，否则 cp.exec 中 sudo 仍会要密码（无 TTY 必失败）
        return fs.existsSync('/etc/sudoers.d/antigravity-proxy');
    }
    catch {
        return false;
    }
}
/** helper 二进制存在但 sudoers 免密规则缺失（需重新安装） */
function isHelperBinaryOnlyInstalled() {
    try {
        fs.accessSync(exports.SUDO_HELPER_PATH, fs.constants.X_OK);
        return !fs.existsSync('/etc/sudoers.d/antigravity-proxy');
    }
    catch {
        return false;
    }
}
/**
 * 比较已安装的 helper 与扩展内置 helper 的 MD5，检测是否过期。
 * 扩展升级后内置 helper 可能变化，但 /usr/local/bin/ 里的不会自动更新。
 */
function isHelperOutdated(extensionPath) {
    try {
        const bundled = path.join(extensionPath, 'scripts', 'antigravity-proxy-helper.sh');
        if (!fs.existsSync(bundled) || !fs.existsSync(exports.SUDO_HELPER_PATH)) {
            return false;
        }
        const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
        return md5(bundled) !== md5(exports.SUDO_HELPER_PATH);
    }
    catch {
        return false;
    }
}
/** 写入 /etc/sudoers.d 的一行（不含换行） */
function sudoersNopasswdLine() {
    const user = os.userInfo().username;
    return `${user} ALL=(ALL) NOPASSWD: ${exports.SUDO_HELPER_PATH}`;
}
//# sourceMappingURL=sudoHelper.js.map