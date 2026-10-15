//! Markdown 内容块解析 + 行内保护(与 Node translate/blocks.js 行为对齐)。
//! 代码块整体不译;行内代码、URL、路径、环境变量以占位符摘出、译后回填。

#[derive(Clone, Debug)]
pub struct Block {
    pub id: String,
    pub kind: String, // heading/paragraph/list/quote/table/code/hr
    pub text: String,
    pub translatable: bool,
    pub items: Option<Vec<String>>,
}

fn is_closing_fence(line: &str, marker: char, len: usize) -> bool {
    let re = regex::Regex::new(r"^ {0,3}(`{3,}|~{3,})\s*$").unwrap();
    let Some(m) = re.captures(line) else { return false };
    let s = m.get(1).unwrap().as_str();
    s.chars().next() == Some(marker) && s.len() >= len
}

fn is_list_line(line: &str) -> bool {
    let re = regex::Regex::new(r"^ {0,3}([-*+]\s+|\d{1,9}[.)]\s+)").unwrap();
    re.is_match(line)
}

fn is_table_line(line: &str) -> bool {
    let a = regex::Regex::new(r"^\s*\|.*\|\s*$").unwrap();
    let b = regex::Regex::new(r"^\|.*\|").unwrap();
    a.is_match(line) || b.is_match(line)
}

fn split_list_items(lines: &[String]) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    let mut cur: Option<String> = None;
    for line in lines {
        if is_list_line(line) {
            if let Some(c) = cur.take() {
                items.push(c);
            }
            cur = Some(line.clone());
        } else if let Some(c) = cur.as_mut() {
            c.push('\n');
            c.push_str(line);
        }
    }
    if let Some(c) = cur {
        items.push(c);
    }
    items
}

struct RawBlock {
    kind: String,
    text: String,
    items: Option<Vec<String>>,
}

pub fn parse_blocks(markdown: &str, explode_limit: usize) -> Vec<Block> {
    let lines: Vec<String> = markdown.split('\n').map(|l| l.trim_end_matches('\r').to_string()).collect();
    let mut raw: Vec<RawBlock> = Vec::new();
    let mut i = 0usize;

    let fence_re = regex::Regex::new(r"^(\s{0,3})(```+|~~~+)").unwrap();
    let heading_re = regex::Regex::new(r"^ {0,3}(#{1,6})\s+").unwrap();
    let heading_break_re = regex::Regex::new(r"^ {0,3}(#{1,6}\s|(-{3,}|\*{3,}|_{3,})\s*$|```|~~~)").unwrap();
    let hr_re = regex::Regex::new(r"^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$").unwrap();
    let quote_re = regex::Regex::new(r"^ {0,3}>").unwrap();
    let quote_break_re = regex::Regex::new(r"^ {0,3}(#{1,6}\s|```|~~~)").unwrap();
    let table_sep_re = regex::Regex::new(r"^ {0,3}\|?[\s:|-]+\|[\s:|-]*$").unwrap();
    let para_break_re = regex::Regex::new(r"^ {0,3}(#{1,6}\s|>|```|~~~|(-{3,}|\*{3,}|_{3,})\s*$)").unwrap();

    while i < lines.len() {
        let line = &lines[i];
        if line.trim().is_empty() {
            i += 1;
            continue;
        }

        // 围栏代码块(不译)
        if let Some(fence) = fence_re.captures(line) {
            let marker_str = fence.get(2).unwrap().as_str();
            let marker = marker_str.chars().next().unwrap();
            let len = marker_str.len();
            let mut body = vec![line.clone()];
            i += 1;
            while i < lines.len() && !is_closing_fence(&lines[i], marker, len) {
                body.push(lines[i].clone());
                i += 1;
            }
            if i < lines.len() {
                body.push(lines[i].clone());
                i += 1;
            }
            raw.push(RawBlock { kind: "code".into(), text: body.join("\n"), items: None });
            continue;
        }

        if heading_re.is_match(line) {
            let mut body = vec![line.clone()];
            i += 1;
            while i < lines.len()
                && !lines[i].trim().is_empty()
                && !heading_break_re.is_match(&lines[i])
                && !is_list_line(&lines[i])
                && !is_table_line(&lines[i])
            {
                body.push(lines[i].clone());
                i += 1;
            }
            raw.push(RawBlock { kind: "heading".into(), text: body.join("\n"), items: None });
            continue;
        }

        if hr_re.is_match(line) {
            raw.push(RawBlock { kind: "hr".into(), text: line.clone(), items: None });
            i += 1;
            continue;
        }

        if quote_re.is_match(line) {
            let mut body: Vec<String> = Vec::new();
            while i < lines.len()
                && (quote_re.is_match(&lines[i])
                    || (!lines[i].trim().is_empty()
                        && !body.is_empty()
                        && !quote_break_re.is_match(&lines[i])
                        && !is_list_line(&lines[i])))
            {
                body.push(lines[i].clone());
                i += 1;
            }
            raw.push(RawBlock { kind: "quote".into(), text: body.join("\n"), items: None });
            continue;
        }

        if is_list_line(line) {
            let mut body: Vec<String> = Vec::new();
            while i < lines.len()
                && (is_list_line(&lines[i])
                    || (!lines[i].trim().is_empty()
                        && lines[i].starts_with(' ')
                        && !heading_re.is_match(&lines[i])))
            {
                body.push(lines[i].clone());
                i += 1;
            }
            let items = split_list_items(&body);
            raw.push(RawBlock { kind: "list".into(), text: body.join("\n"), items: Some(items) });
            continue;
        }

        if is_table_line(line) && i + 1 < lines.len() && table_sep_re.is_match(&lines[i + 1]) {
            let mut body: Vec<String> = Vec::new();
            while i < lines.len() && is_table_line(&lines[i]) {
                body.push(lines[i].clone());
                i += 1;
            }
            raw.push(RawBlock { kind: "table".into(), text: body.join("\n"), items: None });
            continue;
        }

        // 段落:连续非空行,直到遇到其他块类型
        let mut body: Vec<String> = Vec::new();
        while i < lines.len()
            && !lines[i].trim().is_empty()
            && !para_break_re.is_match(&lines[i])
            && !is_list_line(&lines[i])
            && !is_table_line(&lines[i])
        {
            body.push(lines[i].clone());
            i += 1;
        }
        if !body.is_empty() {
            raw.push(RawBlock { kind: "paragraph".into(), text: body.join("\n"), items: None });
        } else {
            raw.push(RawBlock { kind: "paragraph".into(), text: line.clone(), items: None });
            i += 1;
        }
    }

    // 超长块拆分(语义单元不撕裂)
    let mut exploded: Vec<RawBlock> = Vec::new();
    for b in raw {
        if b.kind == "code" || b.kind == "hr" || b.text.chars().count() <= explode_limit {
            exploded.push(b);
            continue;
        }
        if b.kind == "list" {
            if let Some(items) = &b.items {
                let mut buf: Vec<String> = Vec::new();
                let mut buf_len = 0usize;
                for item in items {
                    let add = item.chars().count() + 1; // join('\n') 换行
                    if !buf.is_empty() && buf_len + add > explode_limit {
                        exploded.push(RawBlock { kind: "list".into(), text: buf.join("\n"), items: None });
                        buf = Vec::new();
                        buf_len = 0;
                    }
                    buf.push(item.clone());
                    buf_len += add;
                }
                if !buf.is_empty() {
                    exploded.push(RawBlock { kind: "list".into(), text: buf.join("\n"), items: None });
                }
                continue;
            }
        }
        // 长段落按句子分组
        let sentence_re = regex::Regex::new(r"[^.!?。!?]+[.!?。!?]*\s*").unwrap();
        let sentences: Vec<&str> = sentence_re
            .find_iter(&b.text)
            .map(|m| m.as_str())
            .collect();
        let sentences = if sentences.is_empty() { vec![b.text.as_str()] } else { sentences };
        let mut buf = String::new();
        for s in sentences {
            if !buf.is_empty() && buf.chars().count() + s.chars().count() > explode_limit {
                exploded.push(RawBlock { kind: b.kind.clone(), text: buf.clone(), items: None });
                buf = String::new();
            }
            buf.push_str(s);
        }
        if !buf.trim().is_empty() {
            exploded.push(RawBlock { kind: b.kind.clone(), text: buf, items: None });
        }
    }

    exploded
        .into_iter()
        .enumerate()
        .map(|(idx, b)| {
            let translatable = b.kind != "code" && b.kind != "hr" && !b.text.trim().is_empty();
            Block {
                id: format!("b{idx}"),
                kind: b.kind,
                translatable,
                text: b.text,
                items: None,
            }
        })
        .collect()
}

/* ---------- 行内保护 ---------- */

pub struct ProtectMap {
    pub entries: Vec<(String, String)>, // token → raw
}

pub fn protect_inline(text: &str) -> (String, ProtectMap) {
    let mut map = ProtectMap { entries: Vec::new() };
    let mut n = 0usize;
    let stash = |kind: char, raw: &str, map: &mut ProtectMap, n: &mut usize| -> String {
        let token = format!("⟦{kind}{n}⟧");
        map.entries.push((token.clone(), raw.to_string()));
        *n += 1;
        token
    };

    let inline_code = regex::Regex::new(r"`[^`\n]+`").unwrap();
    let url_re = regex::Regex::new(r"https?://[^\s)>\]]+").unwrap();
    let path_re = regex::Regex::new(r"(?:~/|\.{0,2}/)[A-Za-z0-9_.\-/]+|(?:[A-Za-z]:\\|\\\\)[A-Za-z0-9_.\-\\ ]+").unwrap();
    let env_re = regex::Regex::new(r"\$[A-Z][A-Z0-9_]{2,}|%[A-Z_][A-Z0-9_]+%").unwrap();

    let mut out = text.to_string();
    out = inline_code.replace_all(&out, |c: &regex::Captures| stash('C', c.get(0).unwrap().as_str(), &mut map, &mut n)).to_string();
    out = url_re.replace_all(&out, |c: &regex::Captures| stash('U', c.get(0).unwrap().as_str(), &mut map, &mut n)).to_string();
    out = path_re
        .replace_all(&out, |c: &regex::Captures| {
            let m = c.get(0).unwrap().as_str();
            if m.starts_with("http:") || m.starts_with("https:") {
                m.to_string()
            } else {
                stash('P', m, &mut map, &mut n)
            }
        })
        .to_string();
    out = env_re.replace_all(&out, |c: &regex::Captures| stash('E', c.get(0).unwrap().as_str(), &mut map, &mut n)).to_string();
    (out, map)
}

/// 译文回填占位符;丢失的占位符按记号兜底找回
pub fn restore_inline(translated: &str, map: &ProtectMap) -> String {
    let mut out = translated.to_string();
    for (token, raw) in &map.entries {
        if out.contains(token.as_str()) {
            out = out.replace(token.as_str(), raw);
        }
    }
    let re = regex::Regex::new("⟦([A-Z])(\\d+)⟧").unwrap();
    re.replace_all(&out, |c: &regex::Captures| {
        let kind = c.get(1).unwrap().as_str();
        let idx = c.get(2).unwrap().as_str();
        let token = format!("⟦{kind}{idx}⟧");
        match map.entries.iter().find(|(t, _)| *t == token) {
            Some((_, raw)) => raw.clone(),
            None => c.get(0).unwrap().as_str().to_string(),
        }
    })
    .to_string()
}
