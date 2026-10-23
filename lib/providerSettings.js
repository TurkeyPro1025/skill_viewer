'use strict';

/**
 * 非敏感 provider 设置(LLM 预设/baseUrl/模型):明文 JSON 即可,
 * 与机密(见 credentials.js)分离存储。
 */

const path = require('node:path');
const { readJsonIfExists, writeJsonAtomic } = require('./util');

function createProviderSettings({ dataDir }) {
  const file = path.join(dataDir, 'providers.json');
  const defaults = { version: 1, llm: { preset: null, baseUrl: '', model: '', modelsCache: {} } };
  let data = { ...defaults, ...(readJsonIfExists(file) || {}) };
  data.llm = { ...defaults.llm, ...(data.llm || {}) };
  data.llm.modelsCache = { ...data.llm.modelsCache };

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
    /** 连通性测试拉到的模型列表按服务商(preset|baseUrl)落盘,重启后候选仍以实测为准 */
    updateModelsCache(providerKey, models) {
      const ids = (Array.isArray(models) ? models : [])
        .map((m) => (typeof m === 'string' ? m.trim() : ''))
        .filter(Boolean);
      data.llm.modelsCache = { ...data.llm.modelsCache, [providerKey]: ids };
      save();
      return this.get();
    },
  };
}

module.exports = { createProviderSettings };
