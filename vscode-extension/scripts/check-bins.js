#!/usr/bin/env node
/** 打包前确认随扩展分发的 macOS 二进制已存在（由仓库根目录 make build 同步到 bin/） */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = ['antigravity-relay', 'libantigravity.dylib'];

let ok = true;
for (const name of required) {
    const f = path.join(root, 'bin', name);
    if (!fs.existsSync(f)) {
        console.error(`缺少 ${f}`);
        ok = false;
        continue;
    }
    try {
        fs.accessSync(f, fs.constants.X_OK);
    } catch {
        console.error(`不可执行: ${f}（请 chmod +x）`);
        ok = false;
    }
}

if (!ok) {
    console.error('\n请在本仓库根目录执行: make build');
    process.exit(1);
}

console.log('bin 检查通过:', required.join(', '));
