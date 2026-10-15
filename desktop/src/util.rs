//! 通用工具:sha1/短哈希、限速器、语言判定、原子 JSON 写(与 Node 版 util.js 对齐)。

use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn sha1_hex(text: &str) -> String {
    let mut h = Sha1::new();
    h.update(text.as_bytes());
    hex::encode(h.finalize())
}

pub fn sha1_bytes_hex(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

pub fn short_hash(text: &str, len: usize) -> String {
    sha1_hex(text).chars().take(len).collect()
}

/// 规范化真实路径,用于跨根去重键(Windows 大小写不敏感)
pub fn normalize_real_path(p: &Path) -> String {
    let norm = path_normalize(p);
    if cfg!(windows) { norm.to_lowercase() } else { norm }
}

/// 去掉 canonicalize 的 \\?\ 前缀,得到与 Node realpathSync.native 一致的形式
pub fn strip_verbatim(p: &Path) -> std::path::PathBuf {
    let s = p.to_string_lossy();
    let owned: String = s.into_owned();
    let stripped = owned
        .strip_prefix(r"\\?\UNC\")
        .map(|x| format!(r"\\{x}"))
        .or_else(|| owned.strip_prefix(r"\\?\").map(|x| x.to_string()));
    match stripped {
        Some(x) => PathBuf::from(x),
        None => p.to_path_buf(),
    }
}

fn path_normalize(p: &Path) -> String {
    // Rust 的 Path 没有 Node path.normalize 的完整语义;这里统一分隔符并折叠 ./..
    let s = p.to_string_lossy().replace('/', "\\");
    let mut out: Vec<String> = Vec::new();
    let mut prefix = String::new();
    if let Some(rest) = s.strip_prefix(r"\\") {
        prefix = format!(r"\\{}", rest.split('\\').next().unwrap_or(""));
        let remain = rest.splitn(2, '\\').nth(1).unwrap_or("");
        for part in remain.split('\\') {
            push_part(&mut out, part);
        }
    } else {
        for part in s.split('\\') {
            push_part(&mut out, part);
        }
    }
    let joined = out.join("\\");
    if prefix.is_empty() { joined } else { format!(r"{}\{}", prefix, joined) }
}

fn push_part(out: &mut Vec<String>, part: &str) {
    match part {
        "." | "" => {}
        ".." => {
            if !out.is_empty() && out.last().map(|x| x != "..").unwrap_or(false) {
                out.pop();
            } else {
                out.push(part.to_string());
            }
        }
        _ => out.push(part.to_string()),
    }
}

/// 简单限速器:相邻两次调用开始时间至少间隔 min_gap(串行排队,失败不毒化)。
pub struct Throttle {
    min_gap: Duration,
    queue: tokio::sync::Mutex<Option<std::time::Instant>>,
}

impl Throttle {
    pub fn new(min_gap_ms: u64) -> Self {
        Self { min_gap: Duration::from_millis(min_gap_ms), queue: tokio::sync::Mutex::new(None) }
    }

    /// 取得"通行权":锁内计算与上次调用的间隔,必要时睡眠。
    /// 返回一个守卫,守卫存活期间持锁,后续调用自动排队。
    pub async fn acquire(&self) -> tokio::sync::MutexGuard<'_, Option<std::time::Instant>> {
        let mut last = self.queue.lock().await;
        let now = std::time::Instant::now();
        if let Some(prev) = *last {
            let earliest = prev + self.min_gap;
            if earliest > now {
                tokio::time::sleep_until(tokio::time::Instant::from_std(earliest)).await;
            }
        }
        *last = Some(std::time::Instant::now());
        last
    }
}

/// CJK 字符占比判定中文文档(单栏直出,不翻译)
pub fn detect_language(text: &str) -> &'static str {
    let re = regex::Regex::new(r"(?s)```.*?```").unwrap();
    let stripped = re.replace_all(text, " ");
    let mut cjk = 0usize;
    let mut letters = 0usize;
    for ch in stripped.chars() {
        let c = ch as u32;
        if (0x4e00..=0x9fff).contains(&c) || (0x3400..=0x4dbf).contains(&c) {
            cjk += 1;
        } else if ch.is_ascii_alphabetic() {
            letters += 1;
        }
    }
    let total = cjk + letters;
    if total == 0 {
        "unknown"
    } else if cjk * 100 >= total * 25 {
        "zh"
    } else {
        "en"
    }
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn read_json_if_exists(file: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(file).ok()?;
    serde_json::from_str(&text).ok()
}

/// 原子写 JSON(先写临时文件再改名,避免扫描中途崩溃留下半截缓存)
pub fn write_json_atomic(file: &Path, data: &serde_json::Value) -> std::io::Result<()> {
    let body = serde_json::to_string_pretty(data).unwrap_or_default();
    write_text_atomic(file, &body)
}

/// 原子写纯文本(密钥文件等)
pub fn write_text_atomic(file: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension(format!("tmp{}", std::process::id()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
    }
    std::fs::rename(&tmp, file)
}

/// 密钥掩码(与 Node credentials.maskSecret 一致)
pub fn mask_secret(value: Option<&str>) -> Option<String> {
    let v = value?;
    let chars: Vec<char> = v.chars().collect();
    if chars.len() <= 8 {
        return Some(format!("{}***", chars.iter().take(2).collect::<String>()));
    }
    let head: String = chars.iter().take(3).collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    Some(format!("{head}***{tail}"))
}
