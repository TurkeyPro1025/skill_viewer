/* 桌面端自查探针:spawn release exe --serve,对最终产物做功能级验证(计划第 4 步)。
   只用临时 dataDir 与假根目录,不触碰用户真实数据与密钥。用后即焚,非产品代码。 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXE = path.join(__dirname, '..', '..', 'desktop', 'target', 'release', 'skill-viewer-desktop.exe');
const PRESETS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'llm', 'presets.json'), 'utf8'));
const deepseek = PRESETS.presets.find((p) => p.id === 'deepseek');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-desktop-selfcheck-'));
fs.writeFileSync(path.join(TMP, 'config.json'), JSON.stringify({
  port: 0, host: '127.0.0.1',
  roots: [path.join(TMP, 'no-such-root')],
  lockFiles: [], dataDir: path.join(TMP, 'data'),
  seedsFile: path.join(TMP, 'no-such-seeds.json'),
}, null, 2));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

(async () => {
  const child = spawn(EXE, ['--serve', '--config', path.join(TMP, 'config.json'), '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('启动超时: ' + stderr)), 20000);
    child.stdout.on('data', (chunk) => {
      const m = /LISTENING 127\.0\.0\.1:(\d+)/.exec(String(chunk));
      if (m) { clearTimeout(timer); resolve(parseInt(m[1], 10)); }
    });
    child.on('exit', (c) => reject(new Error('提前退出 code=' + c + ' stderr=' + stderr)));
  });
  const base = `http://127.0.0.1:${port}`;
  const H = { 'Content-Type': 'application/json', Origin: base };

  try {
    // 1) 内嵌 index.html 标记
    const idx = await (await fetch(base + '/')).text();
    for (const m of ['density-toggle', 'llm-model-picker', 'stats-bar', 'model-picker-list', "dataset.theme = 'light'"]) {
      check(`index.html 含 ${m}`, idx.includes(m));
    }
    check('index.html 无 btn-theme(已删主题按钮)', !idx.includes('btn-theme'));
    check('index.html 无 j/k 导航残留(keydownNav)', !idx.includes('keydownNav'));

    // 2) 内嵌 app.js 标记
    const js = await (await fetch(base + '/app.js')).text();
    for (const m of ['ICO_DUMP_TO', 'ICO_LINK', 'fitRootBadges', 'KNOWN_ROOT_SLUGS']) {
      check(`app.js 含 ${m}`, js.includes(m));
    }

    // 3) 静态路由与 API
    const logo = await fetch(base + '/logo.png');
    check('GET /logo.png', logo.status === 200 && logo.headers.get('content-type').includes('image/png'), `${logo.status} ${logo.headers.get('content-type')}`);
    for (const p of ['/dump_to.svg', '/link.svg']) {
      const r = await fetch(base + p);
      check(`GET ${p}(死路由,可选)`, r.status === 200 && r.headers.get('content-type').includes('svg'), String(r.status));
    }
    const st = await fetch(base + '/api/status');
    const stBody = await st.json().catch(() => null);
    check('GET /api/status', st.status === 200 && !!stBody, `keys=${stBody ? Object.keys(stBody).slice(0, 6).join(',') : 'null'}`);
    const ds = await fetch(base + '/api/desktop-settings');
    const dsBody = await ds.json().catch(() => null);
    check('GET /api/desktop-settings(桌面专属路由)', ds.status === 200 && !!dsBody, String(ds.status));

    // 4) R1 baseUrl 优先级三连探针(黑盒无此用例)
    const post = async (body) => fetch(base + '/api/settings/providers', { method: 'POST', headers: H, body: JSON.stringify(body) });
    const read = async () => {
      const r = await fetch(base + '/api/settings');
      const j = await r.json();
      return j.llm || {};
    };
    let r = await post({ llm: { preset: 'deepseek', baseUrl: 'https://x.example/v1', model: 'm1' } });
    check('探针a POST 200', r.status === 200, String(r.status));
    check('探针a 非 custom 预设+显式地址 → 读回用户地址', (await read()).baseUrl === 'https://x.example/v1', (await read()).baseUrl);
    await post({ llm: { preset: 'deepseek', baseUrl: '', model: 'm1' } });
    check('探针b 非 custom 预设+空地址 → 读回预设官方地址', (await read()).baseUrl === deepseek.baseUrl, `got=${(await read()).baseUrl} want=${deepseek.baseUrl}`);
    await post({ llm: { preset: 'custom', baseUrl: 'https://keep.example/v1', model: 'm1' } });
    await post({ llm: { preset: 'custom', baseUrl: '', model: 'm1' } });
    check('探针c custom+空地址 → 保留旧值', (await read()).baseUrl === 'https://keep.example/v1', (await read()).baseUrl);
  } finally {
    child.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
    const failed = results.filter((x) => !x.ok);
    console.log(`\n合计 ${results.length} 项,失败 ${failed.length}`);
    if (failed.length) process.exitCode = 1;
  }
})().catch((e) => { console.error('探针脚本报错:', e.message); process.exitCode = 1; });
