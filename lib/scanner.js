'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseFrontmatter } = require('./frontmatter');
const { sha1, shortHash, normalizeRealPath, detectLanguage } = require('./util');

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
const DOC_EXTS = new Set(['.md', '.markdown']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp']);
const MAX_HASH_BYTES = 64 * 1024 * 1024; // 超大文件按前 64MB 取哈希,避免 venv 级目录拖慢扫描

function walkFiles(dir, prefix = '') {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...walkFiles(full, rel));
    } else if (e.isFile()) {
      out.push({ rel, full, size: fs.statSync(full).size });
    }
  }
  return out;
}

function hashFile(full) {
  const st = fs.statSync(full);
  const h = crypto.createHash('sha1');
  const fd = fs.openSync(full, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, MAX_HASH_BYTES));
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    h.update(buf.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * 多根扫描:解析 junction/symlink 得真实路径去重;内容一致的不同拷贝合并;
 * 同名但内容分岔的作为独立版本保留。
 */
function scan({ roots }) {
  const ignored = [];
  const byRealPath = new Map(); // normRealPath -> entity

  roots.forEach((root, rootIndex) => {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      ignored.push({ name: path.basename(root), root, reason: `根目录不可读: ${err.code || err.message}` });
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const entryPath = path.join(root, e.name);
      // junction/symlink 在 withFileTypes 下 isDirectory() 可能为 false,统一用 realpath 判定
      let realPath;
      try {
        realPath = fs.realpathSync.native(entryPath);
      } catch {
        ignored.push({ name: e.name, root, reason: '无法解析路径(断链?)' });
        continue;
      }
      let st;
      try {
        st = fs.statSync(realPath); // 用目标实体的 stat(junction 目录本身也是目录,这里稳妥起见重新 stat)
      } catch {
        ignored.push({ name: e.name, root, reason: '无法读取目标' });
        continue;
      }
      if (!st.isDirectory()) {
        ignored.push({ name: e.name, root, reason: '非目录(已跳过)' });
        continue;
      }
      const linked = normalizeRealPath(realPath) !== normalizeRealPath(entryPath);
      const rootLabel = rootLabelOf(root);

      let entity = byRealPath.get(normalizeRealPath(realPath));
      if (entity) {
        entity.appearances.push({ root, rootLabel, entryPath, linked, rootIndex });
        continue;
      }
      // 只认根目录下一级、含 SKILL.md 的文件夹为技能
      const skillMd = findSkillMd(realPath);
      if (!skillMd) {
        ignored.push({ name: e.name, root, reason: '缺少 SKILL.md(非技能目录)' });
        byRealPath.set(normalizeRealPath(realPath), null);
        continue;
      }
      entity = buildEntity({ realPath, skillMd, dirName: e.name, appearance: { root, rootLabel, entryPath, linked, rootIndex } });
      byRealPath.set(normalizeRealPath(realPath), entity);
    }
  });

  const entities = [...byRealPath.values()].filter(Boolean);

  // 内容一致但真实路径不同的独立拷贝 → 合并为一条;同名但内容分岔 → 各自展示
  const merged = mergeCopies(entities);
  return { entities: merged, ignored, scannedAt: new Date().toISOString() };
}

function rootLabelOf(root) {
  // ~/.agents/skills → ".agents";用根的上级目录名标识"哪个工具生效"
  const parts = path.resolve(root).split(/[\\/]/).filter(Boolean);
  const skillsIdx = parts.lastIndexOf('skills');
  if (skillsIdx > 0) return parts[skillsIdx - 1];
  return parts[parts.length - 1] || path.resolve(root);
}

function findSkillMd(dir) {
  const candidates = fs.readdirSync(dir).filter((f) => /^skill\.md$/i.test(f));
  return candidates.length ? path.join(dir, candidates[0]) : null;
}

function buildEntity({ realPath, skillMd, dirName, appearance }) {
  const files = walkFiles(realPath);
  const fileHashes = files
    .map((f) => `${f.rel}\0${hashFile(f.full)}`)
    .sort()
    .join('\n');
  const contentHash = sha1(fileHashes);
  const raw = fs.readFileSync(skillMd, 'utf8');
  const { data, body } = parseFrontmatter(raw);

  const docs = files
    .filter((f) => DOC_EXTS.has(path.extname(f.rel).toLowerCase()))
    .map((f) => ({ rel: f.rel, size: f.size }))
    .sort((a, b) => (a.rel.toLowerCase() === 'skill.md' ? -1 : b.rel.toLowerCase() === 'skill.md' ? 1 : a.rel.localeCompare(b.rel)));

  const images = files
    .filter((f) => IMAGE_EXTS.has(path.extname(f.rel).toLowerCase()))
    .map((f) => f.rel)
    .sort();

  return {
    id: shortHash(realPath),
    realPath,
    dirName,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : dirName,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    frontmatter: data,
    entryLanguage: detectLanguage(raw),
    contentHash,
    docs,
    images,
    files: files.map((f) => f.rel),
    appearances: [appearance],
  };
}

function mergeCopies(entities) {
  // 内容一致(contentHash 相同)的独立拷贝合并为一条;同名但内容分岔的保留为多个版本
  const byHash = new Map();
  const out = [];
  for (const e of entities) {
    const primary = byHash.get(e.contentHash);
    if (primary) {
      primary.copies.push({
        realPath: e.realPath,
        id: e.id,
        dirName: e.dirName,
        appearances: e.appearances,
      });
      primary.appearances.push(...e.appearances);
      continue;
    }
    e.copies = [];
    byHash.set(e.contentHash, e);
    out.push(e);
  }
  // 同名但内容分岔:标注 forked,展示名加根标签后缀以便区分
  const byName = new Map();
  for (const e of out) {
    if (!byName.has(e.dirName)) byName.set(e.dirName, []);
    byName.get(e.dirName).push(e);
  }
  for (const list of byName.values()) {
    if (list.length > 1) {
      for (const e of list) {
        e.forked = true;
        e.versionLabel = e.appearances[0].rootLabel;
        // 合并拷贝时保留每个真实路径归属的首个根标签
        for (const c of e.copies) c.versionLabel = c.appearances[0].rootLabel;
      }
    }
  }
  return out;
}

module.exports = { scan, rootLabelOf };
