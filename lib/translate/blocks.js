'use strict';

/**
 * Markdown 内容块解析:标题/段落/列表/引用/表格/代码块/分隔线,每块稳定 ID。
 * 代码块整体不译;行内代码、URL、路径、环境变量以占位符摘出、译后回填。
 * 超长块(整段列表/段落超过 explodeLimit)按语义单元(列表项/句子)拆分,不跨语义单元撕裂。
 */

const PLACEHOLDER_RE = /⟦([A-Z])(\d+)⟧/g;

function parseBlocks(markdown, { explodeLimit = 6000 } = {}) {
  const lines = markdown.split(/\r?\n/);
  const raw = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // 围栏代码块(不译)
    const fence = /^(\s{0,3})(```+|~~~+)/.exec(line);
    if (fence) {
      const fenceChar = fence[2][0];
      const len = fence[2].length;
      const body = [line];
      i++;
      while (i < lines.length && !isClosingFence(lines[i], fenceChar, len)) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) body.push(lines[i]), i++;
      raw.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    if (/^ {0,3}(#{1,6})\s+/.test(line)) {
      const body = [line];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^ {0,3}(#{1,6}\s|(-{3,}|\*{3,}|_{3,})\s*$|```|~~~)/.test(lines[i]) && !isListLine(lines[i]) && !isTableLine(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      raw.push({ type: 'heading', text: body.join('\n') });
      continue;
    }

    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      raw.push({ type: 'hr', text: line });
      i++;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const body = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (lines[i].trim() !== '' && body.length && !/^ {0,3}(#{1,6}\s|```|~~~)/.test(lines[i]) && !isListLine(lines[i])))) {
        body.push(lines[i]);
        i++;
      }
      raw.push({ type: 'quote', text: body.join('\n') });
      continue;
    }

    if (isListLine(line)) {
      const body = [];
      while (i < lines.length && (isListLine(lines[i]) || (lines[i].trim() !== '' && /^\s/.test(lines[i]) && !/^ {0,3}#{1,6}\s/.test(lines[i])))) {
        body.push(lines[i]);
        i++;
      }
      raw.push({ type: 'list', text: body.join('\n'), items: splitListItems(body) });
      continue;
    }

    if (isTableLine(line) && i + 1 < lines.length && /^ {0,3}\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const body = [];
      while (i < lines.length && isTableLine(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      raw.push({ type: 'table', text: body.join('\n') });
      continue;
    }

    // 段落:连续非空行,直到遇到其他块类型
    const body = [];
    while (
      i < lines.length && lines[i].trim() !== ''
      && !/^ {0,3}(#{1,6}\s|>|```|~~~|(-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[i])
      && !isListLine(lines[i]) && !isTableLine(lines[i])
    ) {
      body.push(lines[i]);
      i++;
    }
    if (body.length) {
      raw.push({ type: 'paragraph', text: body.join('\n') });
    } else {
      // 兜底:不应发生,防止死循环
      raw.push({ type: 'paragraph', text: line });
      i++;
    }
  }

  // 超长块拆分(语义单元不撕裂)
  const exploded = [];
  for (const b of raw) {
    if (b.type === 'code' || b.type === 'hr' || b.text.length <= explodeLimit) {
      exploded.push(b);
      continue;
    }
    if (b.type === 'list' && b.items) {
      let buf = [];
      for (const item of b.items) {
        if (buf.join('\n').length + item.length > explodeLimit && buf.length) {
          exploded.push({ type: 'list', text: buf.join('\n') });
          buf = [];
        }
        buf.push(item);
      }
      if (buf.length) exploded.push({ type: 'list', text: buf.join('\n') });
      continue;
    }
    // 长段落按句子分组
    const sentences = b.text.match(/[^.!?。!?]+[.!?。!?]*\s*/g) || [b.text];
    let buf = '';
    for (const s of sentences) {
      if (buf.length + s.length > explodeLimit && buf) {
        exploded.push({ type: b.type, text: buf });
        buf = '';
      }
      buf += s;
    }
    if (buf.trim()) exploded.push({ type: b.type, text: buf });
  }

  return exploded.map((b, idx) => ({
    id: `b${idx}`,
    type: b.type,
    text: b.text,
    translatable: b.type !== 'code' && b.type !== 'hr' && b.text.trim() !== '',
  }));
}

function isClosingFence(line, marker, len) {
  const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(m && m[1][0] === marker[0] && m[1].length >= len);
}

function isListLine(line) {
  return /^ {0,3}([-*+]\s+|\d{1,9}[.)]\s+)/.test(line);
}

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(line) || /^\|.*\|/.test(line);
}

/** 列表块 → 逐项文本(含缩进续行),用于长列表拆分 */
function splitListItems(lines) {
  const items = [];
  let cur = null;
  for (const line of lines) {
    if (isListLine(line)) {
      if (cur) items.push(cur);
      cur = line;
    } else if (cur) {
      cur += '\n' + line;
    }
  }
  if (cur) items.push(cur);
  return items;
}

/** 行内保护:行内代码、URL、文件路径、环境变量 → ⟦C0⟧ 等占位符 */
function protectInline(text) {
  const map = [];
  let n = 0;
  const stash = (kind, raw) => {
    const token = `⟦${kind}${n}⟧`;
    map.push({ token, raw });
    n++;
    return token;
  };

  let out = text;
  // 行内代码最优先(内部可能含 URL/路径)
  out = out.replace(/`[^`\n]+`/g, (m) => stash('C', m));
  // 裸 URL
  out = out.replace(/https?:\/\/[^\s)>\]]+/g, (m) => stash('U', m));
  // Unix 家目录/相对路径、Windows 盘符路径
  out = out.replace(/(?:~\/|\.{0,2}\/)[A-Za-z0-9_.\-/]+|(?:[A-Za-z]:\\|\\\\)[A-Za-z0-9_.\-\\ ]+/g, (m) => (/^https?:/.test(m) ? m : stash('P', m)));
  // 环境变量风格 $VAR / %VAR%
  out = out.replace(/\$[A-Z][A-Z0-9_]{2,}|%[A-Z_][A-Z0-9_]+%/g, (m) => stash('E', m));
  return { masked: out, map };
}

/** 译文回填占位符;丢失的占位符尝试按序号找回,防翻译器吞占位符 */
function restoreInline(translated, map) {
  let out = translated;
  for (const { token, raw } of map) {
    if (out.includes(token)) {
      out = out.split(token).join(raw);
    }
  }
  // 残留占位符(翻译器改写了记号)按序号兜底
  out = out.replace(PLACEHOLDER_RE, (m, kind, idx) => {
    const found = map.find((x) => x.token === `⟦${kind}${idx}⟧`);
    return found ? found.raw : m;
  });
  return out;
}

module.exports = { parseBlocks, protectInline, restoreInline, splitListItems };
