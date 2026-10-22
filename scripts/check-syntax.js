#!/usr/bin/env node
'use strict';

/**
 * 零依赖语法护栏:对项目内所有 JS 文件跑 node --check。
 * 测试会 import lib/,但不会加载 site/app.js、site/demo.js 等脚本;
 * 这些文件里的语法错误只有本检查能拦住。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const ROOTS = ['server.js', 'lib', 'public', 'site', 'scripts', 'test'];

function collect(rel) {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    const out = [];
    for (const name of fs.readdirSync(abs)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      out.push(...collect(path.join(rel, name)));
    }
    return out;
  }
  return rel.endsWith('.js') ? [rel] : [];
}

const files = ROOTS.flatMap(collect);
for (const file of files) {
  execFileSync(process.execPath, ['--check', path.join(ROOT, file)], { stdio: 'inherit' });
}
console.log(`syntax ok: ${files.length} files`);
