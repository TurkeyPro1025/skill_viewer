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
 * 共享配置的约定位置(桌面端同款逻辑):放一份 config.json 即可让网页版与
 * 桌面版天然使用同一 dataDir,无需启动参数(开机自启/托盘双击也生效)。
 */
function sharedConfigPath(appDataDir) {
  const base = appDataDir
    || process.env.APPDATA
    || path.join(os.homedir(), '.config');
  return path.join(base, 'skill-viewer', 'config.json');
}

/**
 * 配置搜索顺序:显式指定 → 启动目录 → 仓库根目录 → 共享目录。
 * @param {{cwd?: string, repoDir?: string, appDataDir?: string}} from 测试注入点
 */
function configSearchCandidates({ cwd, repoDir, appDataDir } = {}) {
  const cwdDir = cwd || process.cwd();
  const repo = repoDir || path.join(__dirname, '..');
  return [
    path.join(cwdDir, 'config.json'),
    path.join(repo, 'config.json'),
    sharedConfigPath(appDataDir),
  ];
}

/**
 * 配置只保存非敏感信息;API key 一律走网页设置页的加密存储,绝不落盘。
 * @param {string|null} configFile 显式配置文件路径;缺省按 configSearchCandidates 的顺序查找
 */
function loadConfig(configFile) {
  const explicit = configFile || process.env.SKILL_VIEWER_CONFIG || null;
  const candidates = explicit ? [explicit] : configSearchCandidates();
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

module.exports = { loadConfig, configSearchCandidates, sharedConfigPath, expandHome, DEFAULTS };
