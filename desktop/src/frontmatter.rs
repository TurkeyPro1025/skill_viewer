//! YAML frontmatter 子集解析器(与 Node frontmatter.js 行为对齐)。
//! 覆盖:标量(裸/引号)、折叠标量(>、>-、|、|-)、嵌套映射、`- item` 列表。
//! 解析失败优雅降级为空对象。

use serde_json::{Map, Value};

pub struct Frontmatter {
    pub data: Map<String, Value>,
    pub body: String,
}

pub fn parse_frontmatter(text: &str) -> Frontmatter {
    let re = regex::Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?").unwrap();
    match re.captures(text) {
        None => Frontmatter { data: Map::new(), body: text.to_string() },
        Some(c) => {
            let raw = c.get(1).map(|m| m.as_str()).unwrap_or("");
            let body = text[c.get(0).unwrap().as_str().len()..].to_string();
            Frontmatter { data: parse_yaml_subset(raw), body }
        }
    }
}

fn parse_scalar(raw: &str) -> Value {
    let s = raw.trim();
    if s.is_empty() || s == "null" || s == "~" {
        return Value::Null;
    }
    if s == "true" {
        return Value::Bool(true);
    }
    if s == "false" {
        return Value::Bool(false);
    }
    if is_int(s) {
        return s.parse::<i64>().map(Value::from).unwrap_or(Value::String(s.to_string()));
    }
    if is_float(s) {
        return s.parse::<f64>().map(|x| {
            // 与 JS 一致:浮点序列化去掉多余的 0(JSON 数字表示)
            Value::from(x)
        }).unwrap_or(Value::String(s.to_string()));
    }
    let bytes = s.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        return Value::String(s[1..s.len() - 1].to_string());
    }
    Value::String(s.to_string())
}

fn is_int(s: &str) -> bool {
    let body = s.strip_prefix('-').unwrap_or(s);
    !body.is_empty() && body.bytes().all(|b| b.is_ascii_digit())
}

fn is_float(s: &str) -> bool {
    let re = regex::Regex::new(r"^-?\d*\.\d+$").unwrap();
    re.is_match(s)
}

struct Line {
    text: String,
    indent: usize,
    blank: bool,
}

fn read_block_scalar(lines: &[Line], i: usize, key_indent: usize) -> (String, usize) {
    let kind_raw = lines[i].text.trim().to_string();
    let kind = kind_raw.trim_end_matches('-').to_string(); // ">" / "|"
    let mut parts: Vec<String> = Vec::new();
    let mut j = i + 1;
    while j < lines.len() {
        let l = &lines[j];
        if l.blank {
            parts.push(String::new());
            j += 1;
            continue;
        }
        if l.indent <= key_indent {
            break;
        }
        // 与 Node 一致:切掉 keyIndent+1 个前导字符
        let text = &l.text;
        let skip = (key_indent + 1).min(text.len());
        parts.push(text[skip..].to_string());
        j += 1;
    }
    while parts.last().map(|p| p.is_empty()).unwrap_or(false) {
        parts.pop();
    }
    let value = if kind == "|" {
        parts.join("\n")
    } else {
        parts.join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
    };
    (value, j)
}

pub fn parse_yaml_subset(raw: &str) -> Map<String, Value> {
    let mut lines: Vec<Line> = raw
        .split('\n')
        .map(|text| {
            let text = text.trim_end_matches('\r');
            let indent = text.len() - text.trim_start_matches(' ').len();
            Line { text: text.to_string(), indent, blank: text.trim().is_empty() }
        })
        .collect();
    // 注释行视为空白(不处理行内注释,避免误伤 URL 里的 #)
    for l in lines.iter_mut() {
        if l.text.trim_start().starts_with('#') {
            l.blank = true;
        }
    }
    let mut pos = 0usize;
    parse_map(&lines, &mut pos, lines.len(), 0)
}

fn parse_map(lines: &[Line], pos: &mut usize, end: usize, indent: usize) -> Map<String, Value> {
    let mut out = Map::new();
    let key_re = regex::Regex::new(r"^([A-Za-z0-9_.-]+):\s*(.*)$").unwrap();
    let block_re = regex::Regex::new(r"^[>|]\d?[+-]?$").unwrap();
    while *pos < end {
        let line = &lines[*pos];
        if line.blank {
            *pos += 1;
            continue;
        }
        if line.indent < indent {
            break;
        }
        let t = line.text.trim().to_string();
        let m = match key_re.captures(&t) {
            Some(m) => m,
            None => {
                *pos += 1;
                continue;
            }
        };
        let key = m.get(1).unwrap().as_str().to_string();
        let value_raw = m.get(2).map(|x| x.as_str()).unwrap_or("").to_string();
        let vr_trim = value_raw.trim();
        if vr_trim.is_empty() || vr_trim.starts_with('#') {
            // 嵌套映射或列表
            match next_content_indent(lines, *pos + 1, end, line.indent) {
                None => {
                    out.insert(key, Value::Null);
                    *pos += 1;
                }
                Some(ci) => {
                    if lines[ci].text.trim().starts_with("- ") {
                        let mut p = ci;
                        let value = parse_list(lines, &mut p, end, lines[ci].indent);
                        out.insert(key, value);
                        *pos = p;
                    } else {
                        let mut p = *pos + 1;
                        let value = parse_map(lines, &mut p, end, lines[ci].indent);
                        out.insert(key, Value::Object(value));
                        *pos = p;
                    }
                }
            }
        } else if block_re.is_match(vr_trim) {
            let (value, next) = read_block_scalar(lines, *pos, line.indent);
            out.insert(key, Value::String(value));
            *pos = next;
        } else {
            out.insert(key, parse_scalar(&value_raw));
            *pos += 1;
        }
    }
    out
}

fn parse_list(lines: &[Line], pos: &mut usize, end: usize, indent: usize) -> Value {
    let mut out = Vec::new();
    while *pos < end {
        let line = &lines[*pos];
        if line.blank {
            *pos += 1;
            continue;
        }
        if line.indent < indent {
            break;
        }
        let t = line.text.trim();
        if !t.starts_with("- ") {
            break;
        }
        out.push(parse_scalar(&t[2..]));
        *pos += 1;
    }
    Value::Array(out)
}

fn next_content_indent(lines: &[Line], from: usize, end: usize, parent_indent: usize) -> Option<usize> {
    for i in from..end {
        if lines[i].blank {
            continue;
        }
        return if lines[i].indent > parent_indent { Some(i) } else { None };
    }
    None
}
