'use strict';

/**
 * YAML frontmatter 子集解析器(零依赖)。
 * 覆盖 SKILL.md 实际使用的语法:标量(裸/引号)、折叠标量(>、>-、|、|-)、
 * 一至三层嵌套映射、简单 `- item` 列表。不追求完整 YAML,解析失败时优雅降级为 {}。
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { data: {}, body: text, raw: '' };
  return { data: parseYamlSubset(m[1]), body: text.slice(m[0].length), raw: m[1] };
}

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/** 折叠/字面标量:收集比当前键更深缩进的后续行 */
function readBlockScalar(lines, i, keyIndent) {
  const kind = lines[i].text.trim().replace(/-$/, ''); // ">" / "|"
  const parts = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const { indent, text, blank } = lines[j];
    if (blank) {
      parts.push('');
      continue;
    }
    if (indent <= keyIndent) break;
    parts.push(text.slice(keyIndent + 1));
  }
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  const joined = kind === '|'
    ? parts.join('\n')
    : parts.join(' ').replace(/\s+/g, ' ');
  return { value: joined, next: j };
}

function parseYamlSubset(raw) {
  const lines = raw.split(/\r?\n/).map((text) => {
    const indent = text.match(/^ */)[0].length;
    return { text, indent, blank: text.trim() === '' };
  });
  // 去掉注释行(不处理行内注释,避免误伤 URL 里的 #)
  for (const l of lines) {
    if (l.text.trim().startsWith('#')) l.blank = true;
  }

  function parseMap(start, end, indent) {
    const out = {};
    let i = start;
    while (i < end) {
      const line = lines[i];
      if (line.blank) {
        i++;
        continue;
      }
      if (line.indent < indent) break;
      const m = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line.text.trim());
      if (!m) {
        i++;
        continue;
      }
      const key = m[1];
      const valueRaw = m[2];
      if (valueRaw.trim() === '' || valueRaw.trim().startsWith('#')) {
        // 可能是嵌套映射或列表
        const childIndent = nextContentIndent(lines, i + 1, end, line.indent);
        if (childIndent === null) {
          out[key] = null;
          i++;
        } else if (lines[childIndent].text.trim().startsWith('- ')) {
          const { value, next } = parseList(i + 1, end, lines[childIndent].indent);
          out[key] = value;
          i = next;
        } else {
          const { value, next } = parseMap(i + 1, end, lines[childIndent].indent);
          out[key] = value;
          i = next;
        }
      } else if (/^[>|]\d?[+-]?$/.test(valueRaw.trim())) {
        const { value, next } = readBlockScalar(lines, i, line.indent);
        out[key] = value;
        i = next;
      } else {
        out[key] = parseScalar(valueRaw);
        i++;
      }
    }
    return { value: out, next: i };
  }

  function parseList(start, end, indent) {
    const out = [];
    let i = start;
    while (i < end) {
      const line = lines[i];
      if (line.blank) {
        i++;
        continue;
      }
      if (line.indent < indent) break;
      const t = line.text.trim();
      if (!t.startsWith('- ')) break;
      out.push(parseScalar(t.slice(2)));
      i++;
    }
    return { value: out, next: i };
  }

  function nextContentIndent(linesArr, from, end, parentIndent) {
    for (let i = from; i < end; i++) {
      if (linesArr[i].blank) continue;
      return linesArr[i].indent > parentIndent ? i : null;
    }
    return null;
  }

  return parseMap(0, lines.length, 0).value;
}

module.exports = { parseFrontmatter, parseYamlSubset };
