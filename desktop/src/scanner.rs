//! 多根扫描器(与 Node scanner.js 行为对齐):
//! junction/symlink realpath 去重、内容一致拷贝合并、同名分岔版本保留。

use crate::frontmatter::parse_frontmatter;
use crate::util::{detect_language, normalize_real_path, sha1_hex, sha1_bytes_hex, short_hash, strip_verbatim};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const SKIP_DIRS: [&str; 5] = [".git", "node_modules", "__pycache__", ".venv", "venv"];
const DOC_EXTS: [&str; 2] = ["md", "markdown"];
const IMAGE_EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"];
const MAX_HASH_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Appearance {
    pub root: PathBuf,
    pub root_label: String,
    pub entry_path: PathBuf,
    pub linked: bool,
}

#[derive(Clone, Debug)]
pub struct CopyInfo {
    pub real_path: PathBuf,
    pub id: String,
    pub dir_name: String,
    pub appearances: Vec<Appearance>,
    pub version_label: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Entity {
    pub id: String,
    pub real_path: PathBuf,
    pub dir_name: String,
    pub name: String,
    pub description: String,
    pub frontmatter: Value,
    pub entry_language: String,
    pub content_hash: String,
    pub docs: Vec<DocInfo>,
    pub images: Vec<String>,
    pub files: Vec<String>,
    pub appearances: Vec<Appearance>,
    pub copies: Vec<CopyInfo>,
    pub forked: bool,
    pub version_label: Option<String>,
    pub body_preview: String,
}

#[derive(Clone, Debug)]
pub struct DocInfo {
    pub rel: String,
    pub size: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Ignored {
    pub name: String,
    pub root: String,
    pub reason: String,
}

pub struct ScanResult {
    pub entities: Vec<Entity>,
    pub ignored: Vec<Ignored>,
    pub scanned_at: String,
}

fn ext_of(rel: &str) -> String {
    Path::new(rel)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn walk_files(dir: &Path, prefix: &str, out: &mut Vec<(String, PathBuf, u64)>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut names: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    names.sort_by_key(|e| e.file_name());
    for e in names {
        let name = e.file_name().to_string_lossy().to_string();
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        let full = dir.join(&name);
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let ft = match e.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            walk_files(&full, &rel, out);
        } else {
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push((rel, full, size));
        }
    }
}

fn hash_file(full: &Path) -> String {
    use std::io::Read;
    let st = match std::fs::metadata(full) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let take = st.len().min(MAX_HASH_BYTES) as usize;
    let mut f = match std::fs::File::open(full) {
        Ok(f) => f,
        Err(_) => return String::new(),
    };
    let mut buf = vec![0u8; take];
    let mut read = 0usize;
    while read < take {
        match f.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => break,
        }
    }
    sha1_bytes_hex(&buf[..read])
}

pub fn root_label_of(root: &Path) -> String {
    let abs = std::fs::canonicalize(root).map(|p| strip_verbatim(&p)).unwrap_or_else(|_| root.to_path_buf());
    let parts: Vec<String> = abs
        .to_string_lossy()
        .split(|c| c == '\\' || c == '/')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    let skills_idx = parts.iter().rposition(|p| p == "skills");
    if let Some(idx) = skills_idx {
        if idx > 0 {
            return parts[idx - 1].clone();
        }
    }
    parts.last().cloned().unwrap_or_else(|| abs.to_string_lossy().to_string())
}

fn find_skill_md(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names.into_iter().find(|n| n.eq_ignore_ascii_case("skill.md")).map(|n| dir.join(n))
}

struct EntityDraft {
    id: String,
    real_path: PathBuf,
    dir_name: String,
    name: String,
    description: String,
    frontmatter: Value,
    entry_language: String,
    content_hash: String,
    docs: Vec<DocInfo>,
    images: Vec<String>,
    files: Vec<String>,
    appearance: Appearance,
    /// 同一真实路径在后续根中的重复出现(合并进主实体的 appearances)
    appearances_extra: Vec<Appearance>,
}

fn build_entity(real_path: &Path, skill_md: &Path, dir_name: &str, appearance: Appearance) -> EntityDraft {
    let mut files: Vec<(String, PathBuf, u64)> = Vec::new();
    walk_files(real_path, "", &mut files);
    let mut file_hashes: Vec<String> = files
        .iter()
        .map(|(rel, full, _)| format!("{}\0{}", rel, hash_file(full)))
        .collect();
    file_hashes.sort();
    let content_hash = sha1_hex(&file_hashes.join("\n"));

    let raw = std::fs::read_to_string(skill_md).unwrap_or_default();
    let fm = parse_frontmatter(&raw);

    let mut docs: Vec<DocInfo> = files
        .iter()
        .filter(|(rel, _, _)| DOC_EXTS.contains(&ext_of(rel).as_str()))
        .map(|(rel, _, size)| DocInfo { rel: rel.clone(), size: *size })
        .collect();
    docs.sort_by(|a, b| {
        let a_skill = a.rel.eq_ignore_ascii_case("skill.md");
        let b_skill = b.rel.eq_ignore_ascii_case("skill.md");
        match (a_skill, b_skill) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.rel.cmp(&b.rel),
        }
    });

    let mut images: Vec<String> = files
        .iter()
        .filter(|(rel, _, _)| IMAGE_EXTS.contains(&ext_of(rel).as_str()))
        .map(|(rel, _, _)| rel.clone())
        .collect();
    images.sort();

    let name = fm
        .data
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| dir_name.to_string());
    let description = fm
        .data
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    EntityDraft {
        id: short_hash(&real_path.to_string_lossy(), 12),
        real_path: real_path.to_path_buf(),
        dir_name: dir_name.to_string(),
        name,
        description,
        frontmatter: Value::Object(fm.data),
        entry_language: detect_language(&raw).to_string(),
        content_hash,
        docs,
        images,
        files: files.into_iter().map(|(rel, _, _)| rel).collect(),
        appearance,
        appearances_extra: Vec::new(),
    }
}

pub fn scan(roots: &[PathBuf]) -> ScanResult {
    let mut ignored: Vec<Ignored> = Vec::new();
    // normRealPath → Some(entity 索引) / None(已知的非技能目录)
    let mut by_real_path: HashMap<String, Option<usize>> = HashMap::new();
    let mut drafts: Vec<EntityDraft> = Vec::new();
    let mut seen_roots: HashSet<String> = HashSet::new();

    for root in roots {
        let root_key = normalize_real_path(root);
        if !seen_roots.insert(root_key) {
            continue;
        }
        let entries = match std::fs::read_dir(root) {
            Ok(e) => e,
            Err(err) => {
                ignored.push(Ignored {
                    name: root.file_name().map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| root.to_string_lossy().to_string()),
                    root: root.to_string_lossy().to_string(),
                    reason: format!("根目录不可读: {err}"),
                });
                continue;
            }
        };
        let root_label = root_label_of(root);
        let mut names: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        names.sort_by_key(|e| e.file_name());
        for e in names {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let entry_path = root.join(&name);
            let real_path = match std::fs::canonicalize(&entry_path).map(|p| strip_verbatim(&p)) {
                Ok(p) => p,
                Err(_) => {
                    ignored.push(Ignored {
                        name,
                        root: root.to_string_lossy().to_string(),
                        reason: "无法解析路径(断链?)".to_string(),
                    });
                    continue;
                }
            };
            let is_dir = match std::fs::metadata(&real_path) {
                Ok(st) => st.is_dir(),
                Err(_) => {
                    ignored.push(Ignored {
                        name,
                        root: root.to_string_lossy().to_string(),
                        reason: "无法读取目标".to_string(),
                    });
                    continue;
                }
            };
            if !is_dir {
                ignored.push(Ignored {
                    name,
                    root: root.to_string_lossy().to_string(),
                    reason: "非目录(已跳过)".to_string(),
                });
                continue;
            }
            let linked = normalize_real_path(&real_path) != normalize_real_path(&entry_path);
            let appearance = Appearance {
                root: root.clone(),
                root_label: root_label.clone(),
                entry_path: entry_path.clone(),
                linked,
            };

            let key = normalize_real_path(&real_path);
            if let Some(slot) = by_real_path.get(&key) {
                if let Some(idx) = slot {
                    drafts[*idx].appearance_more(appearance);
                }
                continue;
            }
            let skill_md = find_skill_md(&real_path);
            match skill_md {
                None => {
                    ignored.push(Ignored {
                        name,
                        root: root.to_string_lossy().to_string(),
                        reason: "缺少 SKILL.md(非技能目录)".to_string(),
                    });
                    by_real_path.insert(key, None);
                }
                Some(skill_md) => {
                    let draft = build_entity(&real_path, &skill_md, &name, appearance);
                    by_real_path.insert(key, Some(drafts.len()));
                    drafts.push(draft);
                }
            }
        }
    }

    let entities = merge_copies(drafts);
    ScanResult { entities, ignored, scanned_at: crate::util::now_iso() }
}

impl EntityDraft {
    fn appearance_more(&mut self, ap: Appearance) {
        self.appearances_extra.push(ap);
    }
}

fn merge_copies(drafts: Vec<EntityDraft>) -> Vec<Entity> {
    // 内容一致(contentHash 相同)的独立拷贝合并;同名但内容分岔保留为多版本
    let mut by_hash: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Entity> = Vec::new();
    for mut d in drafts {
        let appearances = std::mem::take(&mut d.appearances_extra);
        let mut entity = Entity {
            id: d.id,
            real_path: d.real_path,
            dir_name: d.dir_name,
            name: d.name,
            description: d.description,
            frontmatter: d.frontmatter,
            entry_language: d.entry_language,
            content_hash: d.content_hash,
            docs: d.docs,
            images: d.images,
            files: d.files,
            appearances: vec![d.appearance],
            copies: Vec::new(),
            forked: false,
            version_label: None,
            body_preview: String::new(),
        };
        entity.appearances.extend(appearances);
        match by_hash.get(&entity.content_hash) {
            Some(&primary_idx) => {
                let primary = &mut out[primary_idx];
                primary.copies.push(CopyInfo {
                    real_path: entity.real_path.clone(),
                    id: entity.id.clone(),
                    dir_name: entity.dir_name.clone(),
                    appearances: entity.appearances.clone(),
                    version_label: None,
                });
                primary.appearances.extend(entity.appearances);
            }
            None => {
                by_hash.insert(entity.content_hash.clone(), out.len());
                out.push(entity);
            }
        }
    }

    // 同名但内容分岔 → forked,versionLabel 取各自首个根标签
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, e) in out.iter().enumerate() {
        by_name.entry(e.dir_name.clone()).or_default().push(i);
    }
    for (_, idxs) in by_name {
        if idxs.len() > 1 {
            for i in idxs {
                let first_label = out[i].appearances.first().map(|a| a.root_label.clone())
                    .unwrap_or_default();
                out[i].forked = true;
                out[i].version_label = Some(first_label);
                for c in out[i].copies.iter_mut() {
                    c.version_label = Some(
                        c.appearances.first().map(|a| a.root_label.clone()).unwrap_or_default(),
                    );
                }
            }
        }
    }
    out
}
