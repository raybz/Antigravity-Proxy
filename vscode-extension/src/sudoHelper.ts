import * as fs from 'fs';
import * as os from 'os';

/** 固定安装路径，便于单条 sudoers NOPASSWD 白名单 */
export const SUDO_HELPER_PATH = '/usr/local/bin/antigravity-proxy-helper';

export function isSudoHelperInstalled(): boolean {
    try {
        fs.accessSync(SUDO_HELPER_PATH, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/** 写入 /etc/sudoers.d 的一行（不含换行） */
export function sudoersNopasswdLine(): string {
    const user = os.userInfo().username;
    return `${user} ALL=(ALL) NOPASSWD: ${SUDO_HELPER_PATH}`;
}
