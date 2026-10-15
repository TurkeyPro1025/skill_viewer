#!/usr/bin/env node
'use strict';

/**
 * skill-viewer — 轻量只读的本地 Skill 知识库
 * 用法: node server.js [--port 4763] [--config config.json] [--no-scan]
 * 打开 http://127.0.0.1:4763 即可使用。
 */

const path = require('node:path');
const { loadConfig } = require('./lib/config');
const { createCache } = require('./lib/cache');
const { createCredentialStore } = require('./lib/credentials');
const { createProviderSettings } = require('./lib/providerSettings');
const { createTranslateProvider } = require('./lib/translate/uapipro');
const { createPipeline } = require('./lib/translate/pipeline');
const { createLlmProvider } = require('./lib/llm/provider');
const { createAnalyzer } = require('./lib/analyze');
const { createApp } = require('./lib/api');
const { readJsonIfExists } = require('./lib/util');
const presets = require('./lib/llm/presets.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') out.port = parseInt(argv[++i], 10);
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--config') out.config = argv[++i];
    else if (a === '--no-scan') out.noScan = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('用法: node server.js [--port 4763] [--host 127.0.0.1] [--config config.json] [--no-scan]');
    process.exit(0);
  }

  const config = loadConfig(args.config);
  if (args.port) config.port = args.port;
  if (args.host) config.host = args.host;

  const cache = createCache({ dataDir: config.dataDir });
  cache.ensureDirs();

  // 密钥与 provider 配置统一来自网页设置页(加密存储 + providers.json),不读环境变量
  const credStore = await createCredentialStore({ dataDir: config.dataDir }).init();
  const providerSettings = createProviderSettings({ dataDir: config.dataDir });

  const translateProvider = createTranslateProvider(config.providers.translate, {
    keyGetter: () => credStore.get('uapipro') || '',
  });
  const pipeline = createPipeline({ provider: translateProvider, cacheDir: config.dataDir });
  const llmProvider = createLlmProvider(config.providers.llm, {
    getBaseUrl: () => providerSettings.get().llm.baseUrl || '',
    getApiKey: () => credStore.get('llm') || '',
    getModel: () => providerSettings.get().llm.model || '',
  });
  const seeds = readJsonIfExists(config.seedsFile) || { sources: {} };

  const analyzer = createAnalyzer({ config, cache, pipeline, llmProvider, seeds });
  const { server } = createApp({ config, cache, analyzer, pipeline, seeds, credStore, providerSettings, presets });

  // 启动即扫描;已有缓存则先加载再后台增量分析(--no-scan 跳过)
  if (!args.noScan) {
    const hasIndex = Boolean(cache.readIndex());
    analyzer.run({ trigger: hasIndex ? 'startup-incremental' : 'startup' }).catch((err) => {
      console.error('[analyze] 启动分析失败:', err.message);
    });
  }

  server.listen(config.port, config.host, () => {
    console.log(`skill-viewer 已启动: http://${config.host}:${config.port}`);
    console.log(`  技能根目录: ${config.roots.join(', ')}`);
    console.log(`  安装清单:   ${config.lockFiles.join(', ')}`);
    console.log(`  缓存目录:   ${config.dataDir}`);
    if (!translateProvider.configured()) {
      console.log('  提示: 在网页右上角 ⚙ 设置页配置 UApiPro API key,可启用中英对照翻译');
    }
    if (!llmProvider.configured()) {
      console.log('  提示: 在网页 ⚙ 设置页选择 LLM 预设并填 key,可启用概述与归属推断');
    }
    console.log(`  密钥存储: ${credStore.kind === 'dpapi' ? 'Windows DPAPI + AES-256-GCM'
      : credStore.kind === 'keychain' ? 'macOS 钥匙串 + AES-256-GCM'
        : credStore.kind === 'secret-tool' ? 'Linux secret-tool + AES-256-GCM'
          : '机器绑定 AES-256-GCM(未检测到 OS 凭据库)'}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
