'use strict';

/**
 * 非敏感 provider 设置(LLM 预设/baseUrl/模型):明文 JSON 即可,
 * 与机密(见 credentials.js)分离存储。
 */

const path = require('node:path');
const { readJsonIfExists, writeJsonAtomic } = require('./util');

function createProviderSettings({ dataDir }) {
  const file = path.join(dataDir, 'providers.json');
  const defaults = { version: 1, llm: { preset: null, baseUrl: '', model: '' } };
  let data = { ...defaults, ...(readJsonIfExists(file) || {}) };
  data.llm = { ...defaults.llm, ...(data.llm || {}) };

  function save() {
    writeJsonAtomic(file, data);
  }

  return {
    get() {
      return structuredClone(data);
    },
    updateLlm(patch) {
      const picked = {};
      for (const k of ['preset', 'baseUrl', 'model']) {
        if (patch[k] !== undefined) picked[k] = patch[k];
      }
      data.llm = { ...data.llm, ...picked };
      save();
      return this.get();
    },
  };
}

module.exports = { createProviderSettings };
