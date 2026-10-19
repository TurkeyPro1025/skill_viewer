/* 中英文标点统一:仅处理与 CJK 相邻的半角标点。
   - , ; : ! ? 与 CJK 相邻 → 全角
   - ( ) 按整对转换:左括号紧邻 CJK,或整对处于同一字符串内且含 CJK
   - 双遍行级处理:
       pass1 求每行起始状态(模板串可跨行,由上一行行尾反引号配对得出);
       pass2 用起始状态算本行字符串 mask,做转换。
     正则字面量内的引号(如 /"/g)只会污染所在行,不跨行传染;含中文文案的
     行没有这类 regex(已全量人工复核),故安全。
   - 跳过:行注释部分、块注释、HTML 注释行、index.html 的 <script> 块。
   用法:node fix-punct.js --dry | node fix-punct.js --apply */
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const FILES = ['public/app.js', 'seeds/summaries.json', 'public/index.html'].map((f) => path.join(__dirname, '..', f));

const MAP = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？' };
const isCJK = (ch) => /[\u4e00-\u9fff\u3000-\u303f\uff01-\uff5e\u2018-\u201d\u2026·]/.test(ch);

/**
 * 单行状态机。startStack: 上一行传下的栈(首行 ['code'])。
 * 返回 { mask, commentCut, endStack }——mask 标记字符串内字符;
 * commentCut 为代码上下文行注释 // 起点(-1 无);endStack 传给下一行。
 */
function scanLine(line, startStack) {
  const mask = new Array(line.length).fill(false);
  const stack = [...startStack];
  let commentCut = -1;
  for (let i = 0; i < line.length; i++) {
    const top = stack[stack.length - 1];
    const ch = line[i];
    if (ch === '\\' && (top === "'" || top === '"')) { if (i + 1 < line.length) mask[i + 1] = true; i++; continue; }
    if (top === "'" || top === '"') {
      mask[i] = true;
      if (ch === top) stack.pop();
      continue;
    }
    if (top === 'template') {
      mask[i] = true;
      if (ch === '`') stack.pop();
      else if (ch === '$' && line[i + 1] === '{') { stack.push('code'); mask[i + 1] = false; i++; }
      continue;
    }
    // code
    if (ch === '/' && line[i + 1] === '/' && commentCut === -1) commentCut = i;
    if (ch === "'" || ch === '"' || ch === '`') { stack.push(ch === '`' ? 'template' : ch); mask[i] = true; }
    else if (ch === '}' && stack.length > 1) stack.pop();
  }
  // 行尾未闭合的引号视为行内泄漏(regex 等),下一行从 code 重新开始;
  // 只有 template 允许跨行继承
  const endStack = stack.includes('template') ? ['code', 'template'] : ['code'];
  return { mask, commentCut, endStack };
}

function fixLine(line, startStack, allowLineComment, mapNeedsMask) {
  const { mask, commentCut } = scanLine(line, startStack);
  const cut = allowLineComment && commentCut !== -1 ? commentCut : line.length;
  const chars = line.split('');
  const stack = [];
  const pairs = [];
  for (let i = 0; i < cut; i++) {
    if (mapNeedsMask && !mask[i]) continue;
    if (chars[i] === '(') stack.push(i);
    else if (chars[i] === ')' && stack.length) pairs.push([stack.pop(), i]);
  }
  const convert = new Set();
  for (const [o, c] of pairs) {
    const prevCJK = o > 0 && isCJK(chars[o - 1]);
    const innerCJK = chars.slice(o + 1, c).some(isCJK);
    if (prevCJK || (mask[o] && mask[c] && innerCJK)) { convert.add(o); convert.add(c); }
  }
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    if (i >= cut) { out += chars[i]; continue; }
    if (convert.has(i)) { out += chars[i] === '(' ? '（' : '）'; continue; }
    const ch = chars[i];
    if (MAP[ch] && (!mapNeedsMask || mask[i])) {
      const prev = chars[i - 1] || '';
      const next = chars[i + 1] || '';
      if (isCJK(prev) || isCJK(next)) { out += MAP[ch]; continue; }
    }
    out += ch;
  }
  return out;
}

let grandTotal = 0;
for (const file of FILES) {
  const isJsLike = file.endsWith('.js');
  const isHtml = file.endsWith('.html');
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  let inScript = false;
  let inBlockComment = false;
  let startStack = ['code'];
  let count = 0;
  const samples = [];
  const out = lines.map((line, idx) => {
    const t = line.trim();
    if (isHtml) {
      if (/^<script[\s>]/i.test(line)) inScript = true;
      if (inScript && /<\/script>/i.test(line)) { inScript = false; return line; }
      if (inScript) { return line; }
      if (t.startsWith('<!--')) return line;
    }
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return line;
    }
    if (t.startsWith('/*')) { if (!line.includes('*/')) inBlockComment = true; return line; }
    if (t.startsWith('//') || t.startsWith('*')) return line;

    const fixed = fixLine(line, startStack, isJsLike, isJsLike);
    // pass1:为本文件更新下一行起始状态(仅 JS 有模板概念)
    if (isJsLike) startStack = scanLine(line, startStack).endStack;
    if (fixed !== line) {
      count++;
      if (samples.length < 80) samples.push({ line: idx + 1, before: line.trim().slice(0, 96), after: fixed.trim().slice(0, 96) });
    }
    return fixed;
  });
  console.log(`\n== ${path.relative(process.cwd(), file)}: ${count} 行${count ? '' : '(无残留)'}`);
  for (const s of samples) console.log(`  L${s.line}\n    - ${s.before}\n    + ${s.after}`);
  grandTotal += count;
  if (APPLY) fs.writeFileSync(file, out.join('\n'));
}
console.log(`\n合计 ${grandTotal} 行${APPLY ? '(已写入)' : '(dry-run,未写入)'}`);
