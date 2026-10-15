'use strict';

/**
 * JSON 缓存层:索引 / 每技能一文件 / 译文按技能+哈希分文件 / overrides / 运行状态。
 * API key 绝不写入任何缓存文件(只存在内存与环境变量)。
 */

const path = require('node:path');
const fs = require('node:fs');
const { readJsonIfExists, writeJsonAtomic } = require('./util');

function createCache({ dataDir }) {
  const dirs = {
    root: dataDir,
    skills: path.join(dataDir, 'skills'),
    translations: path.join(dataDir, 'translations'),
  };

  function ensureDirs() {
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  }

  // ---- 索引(扫描+归属+概述后的全量视图) ----
  function readIndex() {
    return readJsonIfExists(path.join(dirs.root, 'index.json'));
  }

  function writeIndex(index) {
    writeJsonAtomic(path.join(dirs.root, 'index.json'), index);
  }

  // ---- 每技能一文件(概述/分类,记录内容哈希做增量) ----
  function skillFile(id) {
    return path.join(dirs.skills, `${id}.json`);
  }

  function readSkill(id) {
    return readJsonIfExists(skillFile(id));
  }

  function writeSkill(id, data) {
    writeJsonAtomic(skillFile(id), data);
  }

  // ---- overrides(手动归组,最高优先级,重分析不覆盖) ----
  function readOverrides() {
    const o = readJsonIfExists(path.join(dirs.root, 'overrides.json'));
    return o && typeof o.entries === 'object' ? o : { version: 1, entries: {} };
  }

  function writeOverrides(data) {
    writeJsonAtomic(path.join(dirs.root, 'overrides.json'), data);
  }

  // ---- 运行状态(隐私同意、积分消耗、上次分析) ----
  function readState() {
    return readJsonIfExists(path.join(dirs.root, 'state.json')) || {
      version: 1,
      consentTranslate: false,
      creditsUsed: 0,
      apiCalls: 0,
      lastAnalysis: null,
    };
  }

  function writeState(state) {
    writeJsonAtomic(path.join(dirs.root, 'state.json'), state);
  }

  return {
    dirs,
    ensureDirs,
    readIndex,
    writeIndex,
    readSkill,
    writeSkill,
    readOverrides,
    writeOverrides,
    readState,
    writeState,
  };
}

module.exports = { createCache };
