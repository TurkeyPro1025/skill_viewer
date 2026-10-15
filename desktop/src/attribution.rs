//! 归属引擎(瀑布式,只读)——与 Node attribution/engine.js + recognizers 对齐:
//! overrides(手动,最高)→ lock 安装清单 → .git remote → frontmatter URL(创作上游)
//! → LLM 推断(仅 high 自动纳入)→ 未知来源。

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub struct Attribution {
    pub repo: Option<String>,
    pub method: Option<String>,
    pub source_url: Option<String>,
    pub group: Option<String>,
    pub manifest: Option<String>,
    pub skill_folder_hash: Option<String>,
    pub installed_at: Option<String>,
    pub inferred: bool,
    pub confidence: Option<String>,
    pub confirmed: bool,
    pub upstream: Option<Value>,
    pub manual: bool,
    pub upstream_only: bool,
    pub unknown: bool,
    pub alternatives: Vec<String>,
}

impl Attribution {
    pub fn to_json(&self) -> Value {
        // 与 Node 落盘/API 的 attribution 字段形状一致(含显式 null)
        let mut m = Map::new();
        m.insert("repo".into(), self.repo.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("method".into(), self.method.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("sourceUrl".into(), self.source_url.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("group".into(), self.group.clone().map(Value::String).unwrap_or(Value::Null));
        if let Some(x) = &self.manifest {
            m.insert("manifest".into(), Value::String(x.clone()));
        }
        if let Some(x) = &self.skill_folder_hash {
            m.insert("skillFolderHash".into(), Value::String(x.clone()));
        }
        if let Some(x) = &self.installed_at {
            m.insert("installedAt".into(), Value::String(x.clone()));
        }
        m.insert("inferred".into(), Value::Bool(self.inferred));
        m.insert("confidence".into(), self.confidence.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("confirmed".into(), Value::Bool(self.confirmed));
        m.insert("upstream".into(), self.upstream.clone().unwrap_or(Value::Null));
        if self.manual {
            m.insert("manual".into(), Value::Bool(true));
        }
        if self.upstream_only {
            m.insert("upstreamOnly".into(), Value::Bool(true));
        }
        if self.unknown {
            m.insert("unknown".into(), Value::Bool(true));
        }
        if !self.alternatives.is_empty() {
            m.insert("alternatives".into(), Value::Array(
                self.alternatives.iter().cloned().map(Value::String).collect(),
            ));
        }
        Value::Object(m)
    }
}

pub struct LockEntry {
    pub repo: String,
    pub source_url: Option<String>,
    pub group: Option<String>,
    pub skill_folder_hash: Option<String>,
    pub installed_at: Option<String>,
}

/// manifest 文件 → folder → LockEntry
pub type Manifests = HashMap<PathBuf, HashMap<String, LockEntry>>;

pub struct ResolveCtx<'a> {
    pub manifests: &'a Manifests,
    pub known_repos: &'a [String],
    pub upstreams: &'a HashMap<String, (String, String)>, // dirName → (url, repo)
    pub last_inference: &'a HashMap<String, Option<Attribution>>,
}

pub fn read_manifest(file: &Path) -> Option<(String, HashMap<String, LockEntry>)> {
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()?;
    let skills = raw.get("skills")?.as_object()?;
    if skills.is_empty() {
        return None;
    }
    let mut entries = HashMap::new();
    for (folder, e) in skills {
        let source = e.get("source").and_then(|v| v.as_str());
        let Some(repo) = source.filter(|s| !s.is_empty()) else { continue };
        entries.insert(folder.clone(), LockEntry {
            repo: repo.to_string(),
            source_url: e.get("sourceUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
            group: group_of_skill_path(e.get("skillPath").and_then(|v| v.as_str()).unwrap_or("")),
            skill_folder_hash: e.get("skillFolderHash").and_then(|v| v.as_str()).map(|s| s.to_string()),
            installed_at: e.get("installedAt").and_then(|v| v.as_str()).map(|s| s.to_string()),
        });
    }
    Some(("skill-lock-v3".to_string(), entries))
}

/// skills/engineering/ask-matt/SKILL.md → engineering;
/// .claude/skills/brand/SKILL.md → null(前缀是安装噪音)
pub fn group_of_skill_path(skill_path: &str) -> Option<String> {
    let mut parts: Vec<&str> = skill_path.split('/').filter(|p| !p.is_empty()).collect();
    parts.pop(); // SKILL.md
    parts.pop(); // 技能文件夹名
    let idx = parts.iter().rposition(|p| *p == "skills");
    let group: Vec<&str> = match idx {
        None => parts,
        Some(i) => parts[i + 1..].to_vec(),
    };
    if group.is_empty() { None } else { Some(group.join("/")) }
}

pub fn repo_from_url(url: &str) -> String {
    let gh = regex::Regex::new(r"(?i)github[.]com[/:]([^/]+)/([^/.#?]+)").unwrap();
    if let Some(m) = gh.captures(url) {
        return format!("{}/{}", m.get(1).unwrap().as_str(), m.get(2).unwrap().as_str());
    }
    let gl = regex::Regex::new(r"(?i)(?:gitlab[.]com|bitbucket[.]org|gitee[.]com)[/:]([^/]+)/([^/.#?]+)").unwrap();
    if let Some(m) = gl.captures(url) {
        return format!("{}/{}", m.get(1).unwrap().as_str(), m.get(2).unwrap().as_str());
    }
    // http(s) URL:取 pathname 前两段
    if url.starts_with("http://") || url.starts_with("https://") {
        let no_scheme = url.split_once("://").map(|x| x.1).unwrap_or(url);
        let path = no_scheme.split_once(['?', '#']).map(|x| x.0).unwrap_or(no_scheme);
        let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
        if parts.len() >= 3 {
            // parts[0] 是 host
            return format!("{}/{}", parts[1], parts[2].trim_end_matches(".git"));
        }
        return url.to_string();
    }
    // ssh 形式 git@host:owner/repo
    let ssh = regex::Regex::new(r"(?i)^git@([^:]+):([^/]+)/([^/]+)$").unwrap();
    if let Some(m) = ssh.captures(url.trim()) {
        return format!("{}/{}", m.get(2).unwrap().as_str(), m.get(3).unwrap().as_str().trim_end_matches(".git"));
    }
    url.to_string()
}

/// .git/config 读取 origin(或首个)remote url
pub fn read_origin_remote(skill_dir: &Path) -> Option<String> {
    let dot_git = skill_dir.join(".git");
    let config_path = match std::fs::metadata(&dot_git) {
        Ok(st) if st.is_dir() => dot_git.join("config"),
        Ok(_) => {
            // worktree/submodule:.git 文件内容为 "gitdir: ..."
            let raw = std::fs::read_to_string(&dot_git).ok()?.trim().to_string();
            let dir = regex::Regex::new(r"^gitdir:\s*(.+)$").unwrap().captures(&raw)?.get(1)?.as_str().trim_end_matches('\\').to_string();
            let p = PathBuf::from(&dir);
            let p = if p.is_absolute() { p } else { skill_dir.join(p) };
            p.join("config")
        }
        Err(_) => return None,
    };
    let config = std::fs::read_to_string(config_path).ok()?;
    let block_re = regex::Regex::new(r#"(?s)\[remote\s+"([^"]+)"\]\s*\n((?:[^\[]*\n)*)"#).unwrap();
    let url_re = regex::Regex::new(r"(?m)^\s*url\s*=\s*(\S+)").unwrap();
    let mut fallback = None;
    for m in block_re.captures_iter(&config) {
        let body = m.get(2).unwrap().as_str();
        if let Some(u) = url_re.captures(body).and_then(|x| x.get(1).map(|y| y.as_str().to_string())) {
            if m.get(1).unwrap().as_str() == "origin" {
                return Some(u);
            }
            fallback = fallback.or(Some(u));
        }
    }
    fallback
}

/// frontmatter 常见字段中找来源 URL(含 metadata 嵌套、credits 再嵌套)
pub fn find_source_url(fm: &Value) -> Option<String> {
    const CANDIDATES: [&str; 7] = ["source", "url", "sourceUrl", "source-url", "repository", "repo", "homepage"];
    let obj = fm.as_object()?;
    for key in CANDIDATES {
        if let Some(Value::String(v)) = obj.get(key) {
            let t = v.trim();
            if t.starts_with("http://") || t.starts_with("https://") {
                return Some(t.to_string());
            }
        }
    }
    if let Some(Value::Object(meta)) = obj.get("metadata") {
        for (key, v) in meta {
            if let Value::String(v) = v {
                if CANDIDATES.contains(&key.as_str()) {
                    let t = v.trim();
                    if t.starts_with("http://") || t.starts_with("https://") {
                        return Some(t.to_string());
                    }
                }
            } else if let Value::Object(inner) = v {
                for vv in inner.values() {
                    if let Value::String(vv) = vv {
                        let t = vv.trim();
                        if t.starts_with("http://") || t.starts_with("https://") {
                            return Some(t.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// 对单个技能实体跑归属瀑布(与 engine.resolve 对齐)。
pub fn resolve(
    entity: &crate::scanner::Entity,
    ctx: &ResolveCtx,
    overrides: &Value,
    lock_files: &[PathBuf],
) -> Attribution {
    let upstream = ctx.upstreams.get(&entity.dir_name).map(|(url, repo)| {
        json!({ "url": url, "repo": repo })
    });

    let mut result: Option<Attribution> = None;

    // lock(10)
    for file in lock_files {
        let Some(m) = ctx.manifests.get(file) else { continue };
        let e = m.get(&entity.dir_name).or_else(|| m.get(&entity.name));
        if let Some(e) = e {
            result = Some(Attribution {
                repo: Some(e.repo.clone()),
                method: Some("lock".into()),
                source_url: e.source_url.clone(),
                group: e.group.clone(),
                manifest: file.file_name().map(|n| n.to_string_lossy().to_string()),
                skill_folder_hash: e.skill_folder_hash.clone(),
                installed_at: e.installed_at.clone(),
                inferred: false,
                confidence: None,
                confirmed: false,
                upstream: None,
                manual: false,
                upstream_only: false,
                unknown: false,
                alternatives: Vec::new(),
            });
            break;
        }
    }

    // git(20)
    if result.is_none() {
        if let Some(url) = read_origin_remote(&entity.real_path) {
            result = Some(Attribution {
                repo: Some(repo_from_url(&url)),
                method: Some("git".into()),
                source_url: Some(url),
                ..Default::default()
            });
        }
    }

    // frontmatter-url(30)
    if result.is_none() {
        if let Some(url) = find_source_url(&entity.frontmatter) {
            let repo = repo_from_url(&url);
            result = Some(Attribution {
                repo: Some(repo.clone()),
                method: Some("frontmatter-url".into()),
                source_url: Some(url.clone()),
                upstream_only: true,
                upstream: Some(json!({ "url": url, "repo": repo })),
                ..Default::default()
            });
        }
    }

    // llm(40):只有高置信度推断才自动纳入
    if result.is_none() {
        if let Some(Some(inf)) = ctx.last_inference.get(&entity.id) {
            if inf.confidence.as_deref() == Some("high") {
                result = Some(inf.clone());
            }
        }
    }

    let result_method = result.as_ref().and_then(|r| r.method.clone());
    let mut attribution = match result {
        Some(mut r) => {
            if r.upstream.is_none() {
                r.upstream = upstream.clone();
            }
            r
        }
        None => Attribution {
            upstream: upstream.clone(),
            ..Default::default()
        },
    };

    // overrides 最高优先级:手动归组 / 确认推断
    let o = overrides.get(&entity.id).filter(|v| v.is_object());
    if let Some(o) = o {
        let repo = o.get("repo").and_then(|v| v.as_str());
        if let Some(repo) = repo {
            // repo === "" 表示"移入未知来源"
            attribution.repo = if repo.is_empty() { None } else { Some(repo.to_string()) };
            attribution.method = Some("overrides".into());
            attribution.manual = true;
            attribution.inferred = false;
            if repo.is_empty() {
                attribution.source_url = None;
                attribution.unknown = true;
            }
        } else if o.get("confirmInference").and_then(|v| v.as_bool()).unwrap_or(false) {
            let inferable = result_method.is_none() || result_method.as_deref() == Some("llm");
            if inferable {
                if let Some(Some(inf)) = ctx.last_inference.get(&entity.id) {
                    let mut a = inf.clone();
                    a.confirmed = true;
                    attribution = a;
                }
            }
        }
    }
    attribution
}
