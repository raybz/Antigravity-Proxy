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
exports.installSudoHelper = installSudoHelper;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const sudoHelper_1 = require("./sudoHelper");
const logger_1 = require("./logger");
/**
 * 一次性安装：将 helper 拷到 /usr/local/bin，并写入 /etc/sudoers.d/antigravity-proxy。
 * 之后扩展内 `sudo /usr/local/bin/antigravity-proxy-helper …` 不再要求密码。
 */
function installSudoHelper(context) {
    const bundled = path.join(context.extensionPath, 'scripts', 'antigravity-proxy-helper.sh');
    if (!fs.existsSync(bundled)) {
        void vscode.window.showErrorMessage('扩展内缺少 scripts/antigravity-proxy-helper.sh，请重装 VSIX');
        return;
    }
    const line = (0, sudoHelper_1.sudoersNopasswdLine)();
    const installBody = `#!/bin/bash
set -e
sudo cp ${JSON.stringify(bundled)} ${sudoHelper_1.SUDO_HELPER_PATH}
sudo chmod 755 ${sudoHelper_1.SUDO_HELPER_PATH}
printf '%s\\n' ${JSON.stringify(line)} | sudo tee /etc/sudoers.d/antigravity-proxy >/dev/null
sudo chmod 440 /etc/sudoers.d/antigravity-proxy
echo ""
echo "✓ ${sudoHelper_1.SUDO_HELPER_PATH} 与 /etc/sudoers.d/antigravity-proxy 已就绪（仅此路径免密）。"
`;
    const scriptPath = '/tmp/antigravity-install-helper.sh';
    try {
        fs.writeFileSync(scriptPath, installBody, { mode: 0o755 });
        void vscode.env.clipboard.writeText(`${line}\n`);
        const t = vscode.window.createTerminal({ name: 'Antigravity 免密 sudo 安装' });
        t.show(true);
        t.sendText(`bash ${scriptPath}`);
        (0, logger_1.logSuccess)('已运行免密安装脚本（终端内需输入一次管理员密码）');
        void vscode.window
            .showInformationMessage('免密仅省略之后 sudo 的密码，不会自动写 /etc/hosts。终端里安装完成后，可点「立即准备环境」或重新加载窗口（若已开启「自动准备 hosts/中继」会自行执行）。', '立即准备环境', '知道了')
            .then(choice => {
            if (choice === '立即准备环境') {
                void vscode.commands.executeCommand('antigravity-proxy.prepareEnvironment');
            }
        });
    }
    catch (e) {
        (0, logger_1.logError)(`免密安装脚本写入失败: ${e?.message || e}`);
        void vscode.window.showErrorMessage(e?.message || String(e));
    }
}
//# sourceMappingURL=installHelper.js.map