'use strict';

/**
 * 语言包完整性(v1.2.0):轻量静态断言,不进浏览器。
 * - zh 与 en 词条 key 集合完全一致(缺失即失败)
 * - 占位符 {param} 在两种语言中一致
 * - index.html 的 data-i18n* key、app.js 的静态 t('...') key 都存在于语言包
 * - 英文词条不残留中文(语言名 "中文" 只出现在 languages 元数据,不在 en 词条里)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES = path.join(ROOT, 'public', 'locales.json');
const INDEX = path.join(ROOT, 'public', 'index.html');
const APP = path.join(ROOT, 'public', 'app.js');

const pack = JSON.parse(fs.readFileSync(LOCALES, 'utf8'));
const zh = pack.zh || {};
const en = pack.en || {};

function placeholders(value) {
  return [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

test('语言包结构:zh/en 就绪且 key 集合一致', () => {
  assert.ok(pack.languages.some((l) => l.code === 'zh'), '缺少中文语言声明');
  assert.ok(pack.languages.some((l) => l.code === 'en'), '缺少英文语言声明');
  for (const l of pack.languages) {
    assert.ok(pack[l.code] && typeof pack[l.code] === 'object', `语言 ${l.code} 没有对应词条表`);
  }

  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(enKeys, zhKeys, 'zh/en 词条 key 集合不一致');
  assert.ok(zhKeys.length >= 100, `词条数量异常(${zhKeys.length})`);

  for (const key of zhKeys) {
    assert.equal(typeof zh[key], 'string', `zh.${key} 不是字符串`);
    assert.equal(typeof en[key], 'string', `en.${key} 不是字符串`);
    assert.ok(zh[key].trim(), `zh.${key} 为空`);
    assert.ok(en[key].trim(), `en.${key} 为空`);
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), `占位符不一致: ${key}`);
  }
});

test('英文词条不残留中文', () => {
  const leftovers = Object.entries(en)
    .filter(([, v]) => /[\u4e00-\u9fff]/.test(v))
    .map(([k]) => k);
  assert.deepEqual(leftovers, [], `英文词条仍含中文: ${leftovers.join(', ')}`);
});

function keysInHtml(html) {
  const keys = new Set();
  for (const m of html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)) {
    keys.add(m[1]);
  }
  return [...keys].sort();
}

/** 轻量 HTML 扫描:找出不在任何 data-i18n 元素内部的可见中文 */
function unlocalizedChinese(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '');
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  const out = [];
  let last = 0;
  for (const m of cleaned.matchAll(/<[^>]+>/g)) {
    const text = cleaned.slice(last, m.index);
    if (!stack.some(Boolean) && /[\u4e00-\u9fff]/.test(text)) out.push(text.trim());
    last = m.index + m[0].length;
    const tag = m[0];
    const nameMatch = /^<\s*\/?\s*([a-zA-Z][\w-]*)/.exec(tag);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    if (/^<\s*\//.test(tag)) {
      if (!VOID.has(name)) stack.pop();
    } else if (!VOID.has(name) && !/\/>$/.test(tag)) {
      stack.push(/data-i18n(?:-placeholder|-title|-aria-label)?\s*=/.test(tag));
    }
  }
  const tail = cleaned.slice(last);
  if (!stack.some(Boolean) && /[\u4e00-\u9fff]/.test(tail)) out.push(tail.trim());
  return out;
}

test('index.html 的 data-i18n 标注都能在语言包找到', () => {
  const html = fs.readFileSync(INDEX, 'utf8');
  const keys = keysInHtml(html);
  assert.ok(keys.length >= 40, `data-i18n 标注数量异常(${keys.length})`);
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `index.html 使用了不存在的词条: ${key}`);
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `index.html 使用了不存在的英文词条: ${key}`);
  }
});

test('index.html 的可见中文都被 data-i18n 覆盖', () => {
  const leftovers = unlocalizedChinese(fs.readFileSync(INDEX, 'utf8'));
  assert.deepEqual(leftovers, [], `以下中文没有 data-i18n 标注: ${leftovers.join(' | ')}`);
});

test('app.js 的静态 t(\'...\') 词条都存在', () => {
  const src = fs.readFileSync(APP, 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/\bt\(\s*'([^'$]+)'/g)) keys.add(m[1]);
  for (const m of src.matchAll(/\bt\(\s*"([^"$]+)"/g)) keys.add(m[1]);
  assert.ok(keys.size >= 80, `静态 t() 词条数量异常(${keys.size})`);
  for (const key of keys) {
    assert.ok(Object.prototype.hasOwnProperty.call(zh, key), `app.js 使用了不存在的词条: ${key}`);
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `app.js 使用了不存在的英文词条: ${key}`);
  }
});
