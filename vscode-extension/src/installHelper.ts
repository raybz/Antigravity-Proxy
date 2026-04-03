import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { sudoersNopasswdLine, SUDO_HELPER_PATH } from './sudoHelper';
import { logSuccess, logError } from './logger';

/**
 * 一次性安装：将 helper 拷到 /usr/local/bin，并写入 /etc/sudoers.d/antigravity-proxy。
 * 之后扩展内 `sudo /usr/local/bin/antigravity-proxy-helper …` 不再要求密码。
 */
export function installSudoHelper(context: vscode.ExtensionContext): void {
    const bundled = path.join(context.extensionPath, 'scripts', 'antigravity-proxy-helper.sh');
    if (!fs.existsSync(bundled)) {
        void vscode.window.showErrorMessage('扩展内缺少 scripts/antigravity-proxy-helper.sh，请重装 VSIX');
        return;
    }

    const line = sudoersNopasswdLine();
    const installBody = `#!/bin/bash
set -e
sudo cp ${JSON.stringify(bundled)} ${SUDO_HELPER_PATH}
sudo chmod 755 ${SUDO_HELPER_PATH}
printf '%s\\n' ${JSON.stringify(line)} | sudo tee /etc/sudoers.d/antigravity-proxy >/dev/null
sudo chmod 440 /etc/sudoers.d/antigravity-proxy
echo ""
echo "✓ ${SUDO_HELPER_PATH} 与 /etc/sudoers.d/antigravity-proxy 已就绪（仅此路径免密）。"
`;

    const scriptPath = '/tmp/antigravity-install-helper.sh';
    try {
        fs.writeFileSync(scriptPath, installBody, { mode: 0o755 });
        void vscode.env.clipboard.writeText(`${line}\n`);
        const t = vscode.window.createTerminal({ name: 'Antigravity 免密 sudo 安装' });
        t.show(true);
        t.sendText(`bash ${scriptPath}`);
        logSuccess('已运行免密安装脚本（终端内需输入一次管理员密码）');
        void vscode.window
            .showInformationMessage(
                '免密仅省略之后 sudo 的密码，不会自动写 /etc/hosts。终端里安装完成后，可点「立即准备环境」或重新加载窗口（若已开启「自动准备 hosts/中继」会自行执行）。',
                '立即准备环境',
                '知道了'
            )
            .then(choice => {
                if (choice === '立即准备环境') {
                    void vscode.commands.executeCommand('antigravity-proxy.prepareEnvironment');
                }
            });
    } catch (e: any) {
        logError(`免密安装脚本写入失败: ${e?.message || e}`);
        void vscode.window.showErrorMessage(e?.message || String(e));
    }
}
