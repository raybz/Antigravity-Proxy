import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import * as path from 'path';

/** 固定安装路径，便于单条 sudoers NOPASSWD 白名单 */
export const SUDO_HELPER_PATH = '/usr/local/bin/antigravity-proxy-helper';

export function isSudoHelperInstalled(): boolean {
    try {
        fs.accessSync(SUDO_HELPER_PATH, fs.constants.X_OK);
        // 同时确认 sudoers 免密规则存在，否则 cp.exec 中 sudo 仍会要密码（无 TTY 必失败）
        return fs.existsSync('/etc/sudoers.d/antigravity-proxy');
    } catch {
        return false;
    }
}

/** helper 二进制存在但 sudoers 免密规则缺失（需重新安装） */
export function isHelperBinaryOnlyInstalled(): boolean {
    try {
        fs.accessSync(SUDO_HELPER_PATH, fs.constants.X_OK);
        return !fs.existsSync('/etc/sudoers.d/antigravity-proxy');
    } catch {
        return false;
    }
}

/**
 * 比较已安装的 helper 与扩展内置 helper 的 MD5，检测是否过期。
 * 扩展升级后内置 helper 可能变化，但 /usr/local/bin/ 里的不会自动更新。
 */
export function isHelperOutdated(extensionPath: string): boolean {
    try {
        const bundled = path.join(extensionPath, 'scripts', 'antigravity-proxy-helper.sh');
        if (!fs.existsSync(bundled) || !fs.existsSync(SUDO_HELPER_PATH)) {
            return false;
        }
        const md5 = (f: string) =>
            crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
        return md5(bundled) !== md5(SUDO_HELPER_PATH);
    } catch {
        return false;
    }
}

/** 写入 /etc/sudoers.d 的一行（不含换行） */
export function sudoersNopasswdLine(): string {
    const user = os.userInfo().username;
    return `${user} ALL=(ALL) NOPASSWD: ${SUDO_HELPER_PATH}`;
}
