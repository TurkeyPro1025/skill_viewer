'use strict';

/**
 * vercel-labs skills CLI 的 .skill-lock.json(v3)清单识别器。
 * 格式:{ version: 3, skills: { <folder>: { source, sourceType, sourceUrl, skillPath,
 *        skillFolderHash, pluginName?, installedAt, updatedAt } } }
 */

const name = 'skill-lock-v3';

function canRead(raw) {
  return Boolean(raw && typeof raw === 'object' && raw.skills && typeof raw.skills === 'object');
}

function parse(raw) {
  const entries = {};
  for (const [folder, e] of Object.entries(raw.skills)) {
    if (!e || typeof e.source !== 'string') continue;
    entries[folder] = {
      repo: e.source,
      sourceUrl: e.sourceUrl || null,
      sourceType: e.sourceType || null,
      group: groupOfSkillPath(e.skillPath || ''),
      skillFolderHash: e.skillFolderHash || null,
      pluginName: e.pluginName || null,
      installedAt: e.installedAt || null,
      updatedAt: e.updatedAt || null,
    };
  }
  return entries;
}

/**
 * skills/engineering/ask-matt/SKILL.md → engineering
 * .claude/skills/brand/SKILL.md → null(前缀是安装噪音,无真实分组)
 * skills/flyai/SKILL.md → null
 */
function groupOfSkillPath(skillPath) {
  const parts = skillPath.split('/').filter(Boolean);
  parts.pop(); // SKILL.md
  parts.pop(); // 技能文件夹名
  // skills 段之前是安装路径前缀(如 .claude/),分组取其后部分
  const idx = parts.lastIndexOf('skills');
  const group = idx === -1 ? parts : parts.slice(idx + 1);
  return group.length ? group.join('/') : null;
}

module.exports = { name, canRead, parse, groupOfSkillPath };
