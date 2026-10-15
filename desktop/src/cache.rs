//! JSON 缓存层(与 Node cache.js 布局兼容):索引 / 每技能一文件 / 译文 / overrides / 状态。
//! 密钥绝不写入任何缓存文件。

use crate::util::{read_json_if_exists, write_json_atomic};
use std::path::PathBuf;

#[derive(Clone)]
pub struct Cache {
    pub root: PathBuf,
    pub skills_dir: PathBuf,
    pub translations_dir: PathBuf,
}

impl Cache {
    pub fn new(data_dir: &std::path::Path) -> Self {
        Self {
            root: data_dir.to_path_buf(),
            skills_dir: data_dir.join("skills"),
            translations_dir: data_dir.join("translations"),
        }
    }

    pub fn ensure_dirs(&self) {
        let _ = std::fs::create_dir_all(&self.root);
        let _ = std::fs::create_dir_all(&self.skills_dir);
        let _ = std::fs::create_dir_all(&self.translations_dir);
    }

    pub fn read_index(&self) -> Option<serde_json::Value> {
        read_json_if_exists(&self.root.join("index.json"))
    }
    pub fn write_index(&self, index: &serde_json::Value) {
        let _ = write_json_atomic(&self.root.join("index.json"), index);
    }

    pub fn read_skill(&self, id: &str) -> Option<serde_json::Value> {
        read_json_if_exists(&self.skills_dir.join(format!("{id}.json")))
    }
    pub fn write_skill(&self, id: &str, data: &serde_json::Value) {
        let _ = write_json_atomic(&self.skills_dir.join(format!("{id}.json")), data);
    }

    pub fn read_overrides(&self) -> serde_json::Value {
        match read_json_if_exists(&self.root.join("overrides.json")) {
            Some(v) if v.get("entries").map(|e| e.is_object()).unwrap_or(false) => v,
            _ => serde_json::json!({ "version": 1, "entries": {} }),
        }
    }
    pub fn write_overrides(&self, data: &serde_json::Value) {
        let _ = write_json_atomic(&self.root.join("overrides.json"), data);
    }

    pub fn read_state(&self) -> serde_json::Value {
        read_json_if_exists(&self.root.join("state.json")).unwrap_or_else(|| serde_json::json!({
            "version": 1,
            "consentTranslate": false,
            "creditsUsed": 0,
            "apiCalls": 0,
            "lastAnalysis": null,
        }))
    }
    pub fn write_state(&self, state: &serde_json::Value) {
        let _ = write_json_atomic(&self.root.join("state.json"), state);
    }
}
