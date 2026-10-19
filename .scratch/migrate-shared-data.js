/* 一次性迁移脚本:建共享 config.json + 把项目 data/ 数据并入 %APPDATA%\skill-viewer。
   幂等保护:共享配置已存在则拒绝执行。desktop.json(桌面自启设置)保留桌面侧现值。 */
const fs = require('fs');
const path = require('path');

const appData = process.env.APPDATA;
const shared = path.join(appData, 'skill-viewer');
const projectData = path.join(__dirname, '..', 'data');
const cfgPath = path.join(shared, 'config.json');

if (!fs.existsSync(projectData)) { console.error('项目数据目录不存在:', projectData); process.exit(1); }
if (fs.existsSync(cfgPath)) { console.error('共享配置已存在,中止:', cfgPath); process.exit(1); }
fs.mkdirSync(shared, { recursive: true });

const cfg = {
  dataDir: shared.replace(/\\/g, '/'),
  seedsFile: 'E:/Project/skill全览工具/seeds/summaries.json',
};
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('written:', cfgPath, JSON.stringify(cfg));

// 复制数据文件(覆盖;desktop.json 除外)
const files = ['.masterkey', 'credentials.enc', 'providers.json', 'index.json', 'state.json'];
for (const f of files) {
  const src = path.join(projectData, f);
  if (!fs.existsSync(src)) { console.log('skip(不存在):', f); continue; }
  fs.copyFileSync(src, path.join(shared, f));
  console.log('copied:', f);
}
for (const dir of ['skills', 'translations']) {
  const src = path.join(projectData, dir);
  if (!fs.existsSync(src)) { console.log('skip(不存在):', dir); continue; }
  fs.cpSync(src, path.join(shared, dir), { recursive: true });
  console.log('copied dir:', dir);
}
console.log('kept desktop-side desktop.json as-is');
console.log('migration done');
