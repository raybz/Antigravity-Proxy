/** 与 Makefile RELAY_DOMAINS 保持一致，写入 /etc/hosts 的域名列表 */
export const HOSTS_MARKER = '# antigravity-proxy';

export const RELAY_DOMAINS: readonly string[] = [
    'daily-cloudcode-pa.googleapis.com',
    'cloudcode-pa.googleapis.com',
    'oauth2.googleapis.com',
    'accounts.google.com',
    'www.googleapis.com',
    'generativelanguage.googleapis.com',
    'content-cloudcode-pa.googleapis.com',
];
