'use strict';

/**
 * 界面语言代码:v1.2.0 内置 zh/en,架构预留任意 2-3 位小写代码(ja/ko 加包即用)。
 * 语言包本身在 public/locales.json;这里只做服务端参数的防御性归一化。
 */

const LANG_RE = /^[a-z]{2,3}$/;

function normalizeLang(value, fallback = 'zh') {
  const v = String(value || '').trim().toLowerCase();
  return LANG_RE.test(v) ? v : fallback;
}

module.exports = { normalizeLang };
