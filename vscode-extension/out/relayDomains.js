"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELAY_DOMAINS = exports.HOSTS_MARKER = void 0;
/** 与 Makefile RELAY_DOMAINS 保持一致，写入 /etc/hosts 的域名列表 */
exports.HOSTS_MARKER = '# antigravity-proxy';
exports.RELAY_DOMAINS = [
    'daily-cloudcode-pa.googleapis.com',
    'cloudcode-pa.googleapis.com',
    'oauth2.googleapis.com',
    'accounts.google.com',
    'www.googleapis.com',
    'generativelanguage.googleapis.com',
    'content-cloudcode-pa.googleapis.com',
];
//# sourceMappingURL=relayDomains.js.map