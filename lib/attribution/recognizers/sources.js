'use strict';

/**
 * 归属来源识别器(瀑布的各层)。每个识别器返回 attribution 或 null。
 * priority: lock=10 > git=20 > frontmatter-url=30 > llm=40。
 */

const fs = require('node:fs');
const path = require('node:path');

const name = 'lock';

function createLockRecognizer({ manifestFiles }) {
  // manifestFiles: { file: entries } — 由分析器先用 engine.readManifest 读好传入
  return {
    name: `lock`,
    priority: 10,
    async recognize(entity, ctx) {
      for (const file of manifestFiles()) {
        const m = ctx.manifests?.[file];
        if (!m) continue;
        const e = m.entries[entity.dirName] || m.entries[entity.name];
        if (e) {
          return {
            repo: e.repo,
            sourceUrl: e.sourceUrl,
            group: e.group || null,
            method: 'lock',
            manifest: path.basename(file),
            skillFolderHash: e.skillFolderHash,
            installedAt: e.installedAt,
            inferred: false,
            confidence: null,
            confirmed: false,
          };
        }
      }
      return null;
    },
  };
}

const gitName = 'git-remote';

function createGitRecognizer() {
  return {
    name: gitName,
    priority: 20,
    async recognize(entity) {
      const url = readOriginRemote(entity.realPath);
      if (!url) return null;
      return {
        repo: repoFromUrl(url),
        sourceUrl: url,
        group: null,
        method: 'git',
        inferred: false,
        confidence: null,
        confirmed: false,
      };
    },
  };
}

function readOriginRemote(skillDir) {
  const dotGit = path.join(skillDir, '.git');
  let configPath = null;
  try {
    const st = fs.statSync(dotGit);
    if (st.isDirectory()) {
      configPath = path.join(dotGit, 'config');
    } else {
      // worktree/submodule:.git 文件内容为 "gitdir: ..."
      const raw = fs.readFileSync(dotGit, 'utf8').trim();
      const m = /^gitdir:\s*(.+)$/.exec(raw);
      if (m) configPath = path.resolve(skillDir, m[1].replace(/\\$/, ''), 'config');
    }
  } catch {
    return null;
  }
  if (!configPath) return null;
  let config;
  try {
    config = fs.readFileSync(configPath, 'utf8');
  } catch {
    return null;
  }
  const remoteBlock = /\[remote\s+"([^"]+)"\]\s*\n((?:[^\[]*\n)*)/g;
  let m;
  let fallback = null;
  while ((m = remoteBlock.exec(config))) {
    const url = /^\s*url\s*=\s*(\S+)/m.exec(m[2])?.[1];
    if (url) {
      if (m[1] === 'origin') return url;
      fallback ??= url;
    }
  }
  return fallback;
}

function repoFromUrl(url) {
  const m = /github\.com[/:]([^/]+)\/([^/.#?]+)/i.exec(url)
    || /(?:gitlab\.com|bitbucket\.org|gitee\.com)[/:]([^/]+)\/([^/.#?]+)/i.exec(url);
  if (m) return `${m[1]}/${m[2]}`;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1].replace(/\.git$/, '')}`;
  } catch {
    // 非 http 的 git URL(如 git@):ssh 形式
    const s = /^git@([^:]+):([^/]+)\/([^/]+)$/i.exec(url);
    if (s) return `${s[2]}/${s[3].replace(/\.git$/, '')}`;
  }
  return url;
}

const fmName = 'frontmatter-url';

function createFrontmatterUrlRecognizer() {
  return {
    name: fmName,
    priority: 30,
    async recognize(entity) {
      const url = findSourceUrl(entity.frontmatter || {});
      if (!url) return null;
      return {
        repo: repoFromUrl(url),
        sourceUrl: url,
        group: null,
        method: 'frontmatter-url',
        // frontmatter URL 是"创作上游"而非安装来源,UI 必须标注
        upstreamOnly: true,
        upstream: { url, repo: repoFromUrl(url) },
        inferred: false,
        confidence: null,
        confirmed: false,
      };
    },
  };
}

/** 在 frontmatter 常见字段中找来源 URL(source/url/sourceUrl/repository/homepage 及 metadata 嵌套、credits 再嵌套) */
function findSourceUrl(fm) {
  const candidates = ['source', 'url', 'sourceUrl', 'source-url', 'repository', 'repo', 'homepage'];
  for (const key of candidates) {
    const v = fm[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v.trim())) return v.trim();
  }
  for (const [key, v] of Object.entries(fm.metadata || {})) {
    if (typeof v === 'string') {
      if (candidates.includes(key) && /^https?:\/\//.test(v.trim())) return v.trim();
    } else if (v && typeof v === 'object') {
      // metadata.credits.url 这类两层嵌套
      for (const vv of Object.values(v)) {
        if (typeof vv === 'string' && /^https?:\/\//.test(vv.trim())) return vv.trim();
      }
    }
  }
  return null;
}

const llmName = 'llm-inference';

/**
 * LLM 推断识别器:只消费分析器预计算好的 ctx.lastInference(含缓存复用),
 * 自身不发起 LLM 调用。**只有高置信度推断才自动纳入仓库分组**;
 * 中/低置信度保留为"推断候选"(待用户在整理归属中确认),技能留在未知来源。
 */
function createLlmRecognizer() {
  return {
    name: llmName,
    priority: 40,
    async recognize(entity, ctx) {
      const inf = ctx?.lastInference?.[entity.id];
      if (!inf || inf.confidence !== 'high') return null;
      return { ...inf };
    },
  };
}

module.exports = {
  createLockRecognizer,
  createGitRecognizer,
  createFrontmatterUrlRecognizer,
  createLlmRecognizer,
  readOriginRemote,
  repoFromUrl,
  findSourceUrl,
};
