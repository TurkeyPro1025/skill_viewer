//! 非敏感 provider 设置(LLM 预设/baseUrl/模型):明文 JSON,与机密分离。
//! 文件格式与 Node providerSettings.js 完全兼容。

use crate::util::{read_json_if_exists, write_json_atomic};
use serde_json::{json, Value};
use tokio::sync::RwLock;

pub struct ProviderSettings {
    file: std::path::PathBuf,
    data: RwLock<Value>,
}

impl ProviderSettings {
    pub fn new(data_dir: &std::path::Path) -> Self {
        let file = data_dir.join("providers.json");
        let mut data = read_json_if_exists(&file).unwrap_or_else(|| json!({}));
        // 补默认结构
        if !data.is_object() {
            data = json!({});
        }
        let obj = data.as_object_mut().unwrap();
        obj.entry("version").or_insert(json!(1));
        let llm = obj
            .entry("llm")
            .or_insert_with(|| json!({}));
        if let Some(l) = llm.as_object_mut() {
            l.entry("preset").or_insert(Value::Null);
            l.entry("baseUrl").or_insert(json!(""));
            l.entry("model").or_insert(json!(""));
        }
        Self { file, data: RwLock::new(data) }
    }

    pub async fn get(&self) -> Value {
        self.data.read().await.clone()
    }

    pub async fn update_llm(&self, patch: Value) {
        let mut data = self.data.write().await;
        let picked_keys = ["preset", "baseUrl", "model"];
        if let Some(obj) = data.get_mut("llm").and_then(|v| v.as_object_mut()) {
            if let Some(p) = patch.as_object() {
                for k in picked_keys {
                    if let Some(v) = p.get(k) {
                        obj.insert(k.to_string(), v.clone());
                    }
                }
            }
        }
        let _ = write_json_atomic(&self.file, &data);
    }
}
