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
exports.sudoersNopasswdLine = sudoersNopasswdLine;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
/** 固定安装路径，便于单条 sudoers NOPASSWD 白名单 */
exports.SUDO_HELPER_PATH = '/usr/local/bin/antigravity-proxy-helper';
function isSudoHelperInstalled() {
    try {
        fs.accessSync(exports.SUDO_HELPER_PATH, fs.constants.X_OK);
        return true;
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