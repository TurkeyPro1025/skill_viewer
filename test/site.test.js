'use strict';

/**
 * 站点构建检查(v1.1.0):不测内部实现,只断言发布产物的外部一致性。
 * - canonical / hreflang / og:url 与真实页面文件互链一致
 * - sitemap 条目能映射到实际文件
 * - JSON-LD 可解析,FAQPage 条目数与页面 FAQ 数一致
 * - README 双语互链、package.json 英文描述
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const ORIGIN = 'https://skillslingo.ink';
const PAGES = [
  { file: path.join(SITE, 'index.html'), lang: 'zh-CN', canonical: `${ORIGIN}/`, urlPath: '/' },
  { file: path.join(SITE, 'en', 'index.html'), lang: 'en', canonical: `${ORIGIN}/en/`, urlPath: '/en/' },
];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function meta(html, attr, name) {
  const re = new RegExp(`<meta[^>]+${attr}="${name}"[^>]+content="([^"]*)"`, 'i');
  const m = re.exec(html) || new RegExp(`<meta[^>]+content="([^"]*)"[^>]+${attr}="${name}"`, 'i').exec(html);
  return m ? m[1] : null;
}

function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1]));
}

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${file} 不是 PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('双语页面存在且 lang/canonical/hreflang 一致', () => {
  for (const page of PAGES) {
    assert.ok(fs.existsSync(page.file), `缺少页面 ${page.file}`);
    const html = read(page.file);

    assert.match(html, new RegExp(`<html lang="${page.lang}"`), `${page.file} lang 属性错误`);
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="${page.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`),
      `${page.file} canonical 错误`
    );

    for (const [hreflang, href] of [
      ['zh-CN', `${ORIGIN}/`],
      ['en', `${ORIGIN}/en/`],
      ['x-default', `${ORIGIN}/`],
    ]) {
      assert.match(
        html,
        new RegExp(`hreflang="${hreflang}" href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
        `${page.file} 缺少 hreflang ${hreflang}`
      );
    }
  }
});

test('社交预览元数据指向自定义域名与 1200×630 图片', () => {
  const ogImage = path.join(SITE, 'og-image.png');
  assert.ok(fs.existsSync(ogImage), '缺少 site/og-image.png');
  assert.deepEqual(pngSize(ogImage), { width: 1200, height: 630 }, 'OG 图尺寸不是 1200×630');

  for (const page of PAGES) {
    const html = read(page.file);
    assert.equal(meta(html, 'property', 'og:url'), page.canonical, `${page.file} og:url 错误`);
    assert.equal(meta(html, 'property', 'og:image'), `${ORIGIN}/og-image.png`, `${page.file} og:image 错误`);
    assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image', `${page.file} twitter:card 错误`);
    assert.equal(meta(html, 'name', 'twitter:image'), `${ORIGIN}/og-image.png`, `${page.file} twitter:image 错误`);
    assert.ok(meta(html, 'name', 'twitter:title'), `${page.file} 缺少 twitter:title`);
    assert.ok(meta(html, 'name', 'twitter:description'), `${page.file} 缺少 twitter:description`);
    assert.doesNotMatch(html, /turkeypro1025\.github\.io/i, `${page.file} 仍引用旧 github.io 域名`);
  }
});

test('JSON-LD 可解析,且 FAQPage 条目数与页面 FAQ 一致', () => {
  for (const page of PAGES) {
    const html = read(page.file);
    const blocks = jsonLd(html);
    const app = blocks.find((b) => b['@type'] === 'SoftwareApplication');
    const faq = blocks.find((b) => b['@type'] === 'FAQPage');
    assert.ok(app, `${page.file} 缺少 SoftwareApplication`);
    assert.ok(faq, `${page.file} 缺少 FAQPage`);
    assert.equal(app.url, page.canonical, `${page.file} SoftwareApplication.url 错误`);
    assert.equal(app.offers.price, '0', `${page.file} 应标注免费`);

    const visibleFaqs = (html.replace(/<!--[\s\S]*?-->/g, '').match(/<details[\s>]/g) || []).length;
    assert.equal(faq.mainEntity.length, visibleFaqs, `${page.file} FAQ 结构化数据与页面条目数不一致`);
    for (const q of faq.mainEntity) {
      assert.equal(q['@type'], 'Question');
      assert.ok(q.name && q.acceptedAnswer && q.acceptedAnswer.text, `${page.file} FAQ 条目不完整`);
    }
  }
});

test('sitemap 与 robots 指向真实页面', () => {
  const sitemap = read(path.join(SITE, 'sitemap.xml'));
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs.sort(), [`${ORIGIN}/`, `${ORIGIN}/en/`].sort(), 'sitemap 页面条目不完整');

  for (const page of PAGES) {
    const loc = `${ORIGIN}${page.urlPath}`;
    assert.ok(locs.includes(loc), `sitemap 缺少 ${loc}`);
    assert.match(sitemap, new RegExp(`hreflang="en" href="${ORIGIN}/en/"`), 'sitemap 缺少英文 alternate');
    assert.match(sitemap, new RegExp(`hreflang="zh-CN" href="${ORIGIN}/"`), 'sitemap 缺少中文 alternate');
    assert.ok(fs.existsSync(page.file), `sitemap 条目 ${loc} 没有对应文件`);
  }

  const robots = read(path.join(SITE, 'robots.txt'));
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, new RegExp(`Sitemap: ${ORIGIN}/sitemap\\.xml`));
});

test('llms.txt 存在并包含关键链接', () => {
  const file = path.join(SITE, 'llms.txt');
  assert.ok(fs.existsSync(file), '缺少 site/llms.txt');
  const text = read(file);
  for (const link of [
    `${ORIGIN}/`,
    `${ORIGIN}/en/`,
    'https://github.com/TurkeyPro1025/skills-lingo',
    'README.md',
    'README.zh-CN.md',
  ]) {
    assert.ok(text.includes(link), `llms.txt 缺少 ${link}`);
  }
});

test('语言切换互链正确', () => {
  const zh = read(PAGES[0].file);
  const en = read(PAGES[1].file);
  assert.match(zh, /class="lang-switch"[\s\S]*?href="en\/"/, '中文页缺少 EN 切换链接');
  assert.match(en, /class="lang-switch"[\s\S]*?href="\.\.\/"/, '英文页缺少中文切换链接');
});

test('英文页可见文案不残留中文(语言切换除外)', () => {
  const html = read(PAGES[1].file);
  const body = html.slice(html.indexOf('<body>'));
  const text = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  const cjk = [...new Set(text.match(/[\u4e00-\u9fff]+/g) || [])];
  assert.deepEqual(cjk, ['中文'], `英文页仍残留中文文案: ${cjk.join(', ')}`);
});

test('对外文案以 .agents / 30+ Agent 为主轴', () => {
  for (const page of PAGES) {
    const html = read(page.file);
    assert.doesNotMatch(html, /Claude Code/i, `${page.file} 仍把 Claude Code 作为文案主轴`);
    assert.match(html, /\.agents/, `${page.file} 未突出 .agents`);
    assert.match(html, /30\+/, `${page.file} 未使用 30+ Agent 口径`);
  }
});

test('中英文 hero 文案都包含 .agents 与 30+', () => {
  for (const page of PAGES) {
    const html = read(page.file);
    const m = /<p class="hero-sub">([\s\S]*?)<\/p>/.exec(html);
    assert.ok(m, `${page.file} 缺少 hero-sub`);
    assert.match(m[1], /\.agents/, `${page.file} hero-sub 未提 .agents`);
    assert.match(m[1], /30\+/, `${page.file} hero-sub 未提 30+`);
  }
});

test('OG 图源文件与品牌定位一致', () => {
  const file = path.join(ROOT, 'docs', 'og-image.html');
  assert.ok(fs.existsSync(file), '缺少 docs/og-image.html(OG 图源文件)');
  const src = read(file);
  assert.match(src, /\.agents/, 'OG 图源未提 .agents');
  assert.match(src, /30\+/, 'OG 图源未使用 30+ 口径');
  assert.doesNotMatch(src, /Claude Code/i, 'OG 图源仍把 Claude Code 作为主轴');
});

test('页面引用的本地资源存在(图标允许 PNG 回退)', () => {
  for (const page of PAGES) {
    const html = read(page.file);
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !/^(https?:|#|mailto:)/.test(u));
    const fallbacks = new Map(
      [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*data-fallback="([^"]+)"/g)].map((m) => [m[1], m[2]])
    );
    for (const ref of new Set(refs)) {
      const target = path.resolve(path.dirname(page.file), ref);
      if (fs.existsSync(target)) continue;
      const fallback = fallbacks.get(ref);
      assert.ok(fallback, `${page.file} 引用了不存在的资源 ${ref},且没有 PNG 回退`);
      assert.ok(
        fs.existsSync(path.resolve(path.dirname(page.file), fallback)),
        `${page.file} 的图标回退 ${fallback} 不存在`
      );
    }
  }
});

test('README 双语互链且文件存在', () => {
  const en = read(path.join(ROOT, 'README.md'));
  const zhFile = path.join(ROOT, 'README.zh-CN.md');
  assert.ok(fs.existsSync(zhFile), '缺少 README.zh-CN.md');
  const zh = read(zhFile);
  assert.match(en, /\[中文\]\(README\.zh-CN\.md\)/, 'README.md 缺少中文版链接');
  assert.match(zh, /\[English\]\(README\.md\)/, 'README.zh-CN.md 缺少英文版链接');
  assert.ok(fs.existsSync(path.join(ROOT, 'docs', 'screenshot.png')), 'README 截图缺失');
});

test('package.json 面向国际发布', () => {
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  assert.doesNotMatch(pkg.description, /[\u4e00-\u9fff]/, 'description 仍含中文');
  assert.ok(pkg.keywords.includes('claude-code'), 'keywords 缺少 claude-code');
  assert.ok(pkg.keywords.includes('agent-skills'), 'keywords 缺少 agent-skills');
  assert.ok(pkg.keywords.includes('skill-viewer'), 'keywords 缺少 skill-viewer');
});
