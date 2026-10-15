'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonIfExists } = require('./util');

const DEFAULTS = {
  port: 4763,
  host: '127.0.0.1',
  roots: ['~/.agents/skills', '~/.zcode/skills', '~/.claude/skills'],
  lockFiles: ['~/.agents/.skill-lock.json'],
  dataDir: 'data',
  seedsFile: 'seeds/summaries.json',
  providers: {
    translate: {
      name: 'uapipro',
      endpoint: 'https://uapis.cn/api/v1/ai/translate',
      authHeader: 'Authorization',
      authPrefix: 'Bearer ',
      targetLang: 'zh',
      style: 'professional',
      context: 'technical',
      preserveFormat: true,
      maxCharsPerCall: 10000,
      qps: 4,
      creditsPerCall: 4,
      responseField: 'data.translated_text',
    },
    llm: { name: 'openai-compat', baseUrl: '', model: '' },
  },
};

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * 配置只保存非敏感信息;API key 一律从环境变量读取,绝不落盘。
 * @param {string|null} configFile 显式配置文件路径;缺省依次找 cwd/package 目录下的 config.json
 */
function loadConfig(configFile) {
  const explicit = configFile || process.env.SKILL_VIEWER_CONFIG || null;
  const candidates = explicit
    ? [explicit]
    : [path.join(process.cwd(), 'config.json'), path.join(__dirname, '..', 'config.json')];
  const found = candidates.find((c) => c && fs.existsSync(c)) || null;
  const baseDir = found ? path.dirname(path.resolve(found)) : process.cwd();

  const user = found ? readJsonIfExists(found) : {};
  const cfg = deepMerge(structuredClone(DEFAULTS), user || {});

  cfg.configFile = found;
  cfg.baseDir = baseDir;
  cfg.roots = (cfg.roots || []).map(expandHome);
  cfg.lockFiles = (cfg.lockFiles || []).map(expandHome);
  cfg.dataDir = path.resolve(baseDir, expandHome(cfg.dataDir));
  cfg.seedsFile = path.resolve(baseDir, expandHome(cfg.seedsFile));
  cfg.publicDir = path.join(__dirname, '..', 'public');
  return cfg;
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

module.exports = { loadConfig, expandHome, DEFAULTS };
