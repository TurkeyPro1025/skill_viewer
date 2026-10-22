//! 翻译管线(与 Node translate/pipeline.js 对齐):
//! 块级解析 → 行内保护 → 分块打包 → 拆回按 ID 关联 → 缓存。
//! 缓存键 = 技能 id + 语言 + 文档内容哈希;并发翻译共享同一 in-flight 任务。

use crate::translate_blocks::{parse_blocks, protect_inline, restore_inline, Block};
use crate::uapipro::{TranslateError, UApiProProvider};
use crate::util::{detect_language, now_iso, read_json_if_exists, sha1_hex, write_json_atomic};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

const CACHE_VERSION: i64 = 2;
const CHUNK_MARGIN: usize = 100;

pub struct PipelineError {
    pub code: &'static str,
    pub message: String,
    pub params: Option<Value>,
}

impl PipelineError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), params: None }
    }

    pub fn with_params(code: &'static str, message: impl Into<String>, params: Value) -> Self {
        Self { code, message: message.into(), params: Some(params) }
    }
}

pub struct Pipeline {
    pub provider: Arc<UApiProProvider>,
    pub cache_dir: PathBuf,
    inflight: Mutex<std::collections::HashSet<String>>,
}

impl Pipeline {
    pub fn new(provider: Arc<UApiProProvider>, cache_dir: PathBuf) -> Self {
        Self { provider, cache_dir, inflight: Mutex::new(std::collections::HashSet::new()) }
    }

    fn cache_file(&self, skill_id: &str, lang: &str, doc_hash: &str) -> PathBuf {
        self.cache_dir
            .join("translations")
            .join(skill_id)
            .join(lang)
            .join(format!("{doc_hash}.json"))
    }

    /// v1 布局(无语言段)的旧文件:只按中文解释,英文请求不得误命中中文译文
    fn legacy_cache_file(&self, skill_id: &str, doc_hash: &str) -> PathBuf {
        self.cache_dir
            .join("translations")
            .join(skill_id)
            .join(format!("{doc_hash}.json"))
    }

    /// 读缓存;docHash 不匹配(内容已变)即视为 miss。中文请求可懒迁移 v1 旧文件。
    fn read_cache(&self, skill_id: &str, doc_hash: &str, lang: &str) -> Option<Value> {
        if let Some(hit) = read_json_if_exists(&self.cache_file(skill_id, lang, doc_hash)) {
            let ok = hit.get("version").and_then(|v| v.as_i64()) == Some(CACHE_VERSION)
                && hit.get("lang").and_then(|v| v.as_str()) == Some(lang)
                && hit.get("docHash").and_then(|v| v.as_str()) == Some(doc_hash);
            if ok {
                return Some(hit);
            }
        }
        if lang != "zh" {
            return None;
        }
        let legacy = read_json_if_exists(&self.legacy_cache_file(skill_id, doc_hash))?;
        let legacy_ok = legacy.get("version").and_then(|v| v.as_i64()) == Some(1)
            && legacy.get("docHash").and_then(|v| v.as_str()) == Some(doc_hash);
        if !legacy_ok {
            return None;
        }
        // 旧缓存必为中文译文:迁移到新路径,中文缓存与积分无损
        let mut migrated = legacy.clone();
        if let Some(obj) = migrated.as_object_mut() {
            obj.insert("version".into(), json!(CACHE_VERSION));
            obj.insert("lang".into(), json!("zh"));
        }
        self.write_cache(&migrated);
        let _ = std::fs::remove_file(self.legacy_cache_file(skill_id, doc_hash));
        Some(migrated)
    }

    fn write_cache(&self, entry: &Value) {
        let id = entry.get("skillId").and_then(|v| v.as_str()).unwrap_or_default();
        let lang = entry.get("lang").and_then(|v| v.as_str()).unwrap_or("zh");
        let hash = entry.get("docHash").and_then(|v| v.as_str()).unwrap_or_default();
        let _ = write_json_atomic(&self.cache_file(id, lang, hash), entry);
    }

    /// 确保某文档有目标语言译文:缓存命中直接返回,否则翻译并写缓存(in-flight 去重)。
    /// 文档语言与目标语言一致时单栏直出、不翻译、不耗积分。
    pub async fn ensure_translation(
        &self,
        entity_id: &str,
        entity_real_path: &std::path::Path,
        doc_rel_path: &str,
        api_key: &str,
        consented: bool,
        lang: &str,
    ) -> Result<Value, PipelineError> {
        let doc_path = entity_real_path.join(doc_rel_path);
        let raw = match std::fs::read_to_string(&doc_path) {
            Ok(r) => r,
            Err(_) => {
                return Err(PipelineError::with_params(
                    "doc_unreadable",
                    format!("文档不可读: {doc_rel_path}"),
                    json!({ "path": doc_rel_path }),
                ))
            }
        };
        let doc_hash = sha1_hex(&raw);
        if detect_language(&raw) == lang {
            return Ok(json!({
                "language": lang, "cached": true, "blocks": null, "reason": "same_language",
            }));
        }

        if let Some(cached) = self.read_cache(entity_id, &doc_hash, lang) {
            let mut out = cached;
            out.as_object_mut().unwrap().insert("cached".into(), Value::Bool(true));
            return Ok(out);
        }

        if !self.provider.configured(api_key) {
            return Err(PipelineError::new(
                "provider_unconfigured",
                "翻译 provider 未配置(API key 缺失)",
            ));
        }
        if !consented {
            return Err(PipelineError::new("consent_required", "需要用户同意隐私提示后才能翻译"));
        }

        let inflight_key = format!("{entity_id}\0{lang}\0{doc_hash}");
        {
            let guard = self.inflight.lock().await;
            if guard.contains(&inflight_key) {
                drop(guard);
                // 等待另一任务完成,然后读它的缓存(与 Node 共享同一 Promise 等价)
                let mut spins = 0;
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
                    if let Some(done) = self.read_cache(entity_id, &doc_hash, lang) {
                        let mut out = done;
                        out.as_object_mut().unwrap().insert("cached".into(), Value::Bool(true));
                        return Ok(out);
                    }
                    spins += 1;
                    let still = self.inflight.lock().await.contains(&inflight_key);
                    if !still || spins > 500 {
                        break;
                    }
                }
                // 仍无结果(对方失败):落回自己翻
            }
        }

        {
            let mut guard = self.inflight.lock().await;
            guard.insert(inflight_key.clone());
        }
        let result = self
            .translate_doc(entity_id, entity_real_path, doc_rel_path, &raw, &doc_hash, api_key, lang)
            .await;
        {
            let mut guard = self.inflight.lock().await;
            guard.remove(&inflight_key);
        }
        match result {
            Ok(mut v) => {
                v.as_object_mut().unwrap().insert("cached".into(), Value::Bool(false));
                Ok(v)
            }
            Err(e) => Err(e),
        }
    }

    async fn translate_doc(
        &self,
        entity_id: &str,
        entity_real_path: &std::path::Path,
        doc_rel_path: &str,
        raw: &str,
        doc_hash: &str,
        api_key: &str,
        lang: &str,
    ) -> Result<Value, PipelineError> {
        let fm = crate::frontmatter::parse_frontmatter(raw);
        let blocks = parse_blocks(&fm.body, 6000);
        let translatable: Vec<&Block> = blocks.iter().filter(|b| b.translatable).collect();

        let blocks_json: Vec<Value> = blocks
            .iter()
            .map(|b| {
                json!({
                    "id": b.id,
                    "type": b.kind,
                    "src": b.text,
                    "translated": "",
                    "status": if b.translatable { "pending" } else { "original" },
                })
            })
            .collect();
        let mut result = json!({
            "version": CACHE_VERSION,
            "lang": lang,
            "skillId": entity_id,
            "realPath": entity_real_path.to_string_lossy(),
            "docRelPath": doc_rel_path,
            "docHash": doc_hash,
            "provider": "uapipro",
            "createdAt": now_iso(),
            "blocks": blocks_json,
            "calls": 0,
            "credits": 0,
        });

        let max_chars = self.provider.cfg.max_chars_per_call.saturating_sub(CHUNK_MARGIN);
        let chunks = pack_chunks(&translatable, max_chars);
        for chunk in chunks {
            self.translate_chunk(&chunk, api_key, &mut result, lang).await;
        }
        self.write_cache(&result);
        Ok(result)
    }

    async fn translate_chunk(&self, chunk_blocks: &[&Block], api_key: &str, result: &mut Value, lang: &str) {
        let masked: Vec<(String, crate::translate_blocks::ProtectMap)> = chunk_blocks
            .iter()
            .map(|b| protect_inline(&b.text))
            .collect();
        let joined = masked
            .iter()
            .enumerate()
            .map(|(i, (m, _))| format!("⟦S{i}⟧\n{m}"))
            .collect::<Vec<_>>()
            .join("\n⟦E⟧\n");

        // 打包调用
        let batch = self.call_provider(&joined, api_key, result, lang).await;
        if let Ok(out) = batch {
            if let Some(parts) = split_by_separators(&out, masked.len()) {
                for (i, ((_, map), part)) in masked.iter().zip(parts.iter()).enumerate() {
                    apply_result(result, &chunk_blocks[i].id, &restore_inline(part, map));
                }
                return;
            }
        }

        // 打包失败 → 逐块降级
        for ((masked_text, map), b) in masked.iter().zip(chunk_blocks.iter()) {
            match self.call_provider(masked_text, api_key, result, lang).await {
                Ok(out) => apply_result(result, &b.id, &restore_inline(&out, map)),
                Err(err) => {
                    set_failed(result, &b.id, &err.message);
                }
            }
        }
    }

    async fn call_provider(
        &self,
        text: &str,
        api_key: &str,
        result: &mut Value,
        lang: &str,
    ) -> Result<String, TranslateError> {
        let out = self.provider.translate_text(text, api_key, Some(lang)).await?;
        if let Some(obj) = result.as_object_mut() {
            let calls = obj.get("calls").and_then(|v| v.as_u64()).unwrap_or(0) + 1;
            let credits = obj.get("credits").and_then(|v| v.as_u64()).unwrap_or(0) + out.1;
            obj.insert("calls".into(), json!(calls));
            obj.insert("credits".into(), json!(credits));
        }
        Ok(out.0)
    }

    /// 批量翻译短文本(概述/分类/仓库简介):贴满单次字符上限打包,⟦S n⟧/⟦E⟧ 分隔。
    /// 返回与输入等长的数组;失败或超长项为 null,由调用方回退原文并在下次分析重试。
    pub async fn translate_texts(&self, texts: &[String], lang: &str, api_key: &str) -> Vec<Option<String>> {
        let mut out: Vec<Option<String>> = texts.iter().map(|_| None).collect();
        if texts.is_empty() {
            return out;
        }
        let max = self.provider.cfg.max_chars_per_call.saturating_sub(CHUNK_MARGIN);
        let mut chunks: Vec<Vec<(usize, String, crate::translate_blocks::ProtectMap)>> = Vec::new();
        let mut cur: Vec<(usize, String, crate::translate_blocks::ProtectMap)> = Vec::new();
        let mut cur_len = 0usize;
        for (i, text) in texts.iter().enumerate() {
            if text.trim().is_empty() {
                out[i] = Some(text.clone());
                continue;
            }
            let (masked, map) = protect_inline(text);
            let add = masked.chars().count() + 16;
            if add > max {
                continue;
            }
            if !cur.is_empty() && cur_len + add > max {
                chunks.push(std::mem::take(&mut cur));
                cur_len = 0;
            }
            cur.push((i, masked, map));
            cur_len += add;
        }
        if !cur.is_empty() {
            chunks.push(cur);
        }

        for chunk in chunks {
            let joined = chunk
                .iter()
                .enumerate()
                .map(|(n, (_, m, _))| format!("⟦S{n}⟧\n{m}"))
                .collect::<Vec<_>>()
                .join("\n⟦E⟧\n");
            // 整包失败:该包的项保持 null,不拖垮其他包
            let Ok((translated, _)) = self.provider.translate_text(&joined, api_key, Some(lang)).await else {
                continue;
            };
            let Some(parts) = split_by_separators(&translated, chunk.len()) else {
                continue;
            };
            for ((i, _masked, map), part) in chunk.iter().zip(parts.iter()) {
                out[*i] = Some(restore_inline(part, map).trim().to_string());
            }
        }
        out
    }

    /// 重试失败块:只重译 status=failed 的块,合并进缓存
    pub async fn retry_failed(
        &self,
        entity_id: &str,
        entity_real_path: &std::path::Path,
        doc_rel_path: &str,
        api_key: &str,
        consented: bool,
        lang: &str,
    ) -> Result<Value, PipelineError> {
        if !self.provider.configured(api_key) {
            return Err(PipelineError::new("provider_unconfigured", "翻译 provider 未配置"));
        }
        if !consented {
            return Err(PipelineError::new("consent_required", "需要用户同意隐私提示后才能翻译"));
        }
        let raw = std::fs::read_to_string(entity_real_path.join(doc_rel_path))
            .map_err(|_| PipelineError::with_params("doc_unreadable", format!("文档不可读: {doc_rel_path}"), json!({ "path": doc_rel_path })))?;
        let doc_hash = sha1_hex(&raw);
        let mut cached = match self.read_cache(entity_id, &doc_hash, lang) {
            Some(c) => c,
            None => {
                return self
                    .ensure_translation(entity_id, entity_real_path, doc_rel_path, api_key, consented, lang)
                    .await
            }
        };

        let failed: Vec<(String, String, String)> = cached
            .get("blocks")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter(|b| b.get("status").and_then(|s| s.as_str()) == Some("failed"))
                    .filter_map(|b| {
                        Some((
                            b.get("id")?.as_str()?.to_string(),
                            b.get("src")?.as_str()?.to_string(),
                            b.get("type").and_then(|t| t.as_str()).unwrap_or("paragraph").to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        if failed.is_empty() {
            let mut out = cached;
            out.as_object_mut().unwrap().insert("cached".into(), Value::Bool(true));
            out.as_object_mut().unwrap().insert("retried".into(), json!(0));
            return Ok(out);
        }

        // 构造伪块走同一打包路径
        let pseudo: Vec<Block> = failed
            .iter()
            .map(|(id, text, kind)| Block {
                id: id.clone(),
                kind: kind.clone(),
                text: text.clone(),
                translatable: true,
                items: None,
            })
            .collect();
        let refs: Vec<&Block> = pseudo.iter().collect();
        self.translate_chunk(&refs, api_key, &mut cached, lang).await;
        self.write_cache(&cached);
        let mut out = cached;
        out.as_object_mut().unwrap().insert("cached".into(), Value::Bool(true));
        out.as_object_mut().unwrap().insert("retried".into(), json!(failed.len()));
        Ok(out)
    }
}

fn apply_result(result: &mut Value, block_id: &str, translated: &str) {
    if let Some(arr) = result.get_mut("blocks").and_then(|v| v.as_array_mut()) {
        for b in arr {
            if b.get("id").and_then(|x| x.as_str()) == Some(block_id) {
                if let Some(obj) = b.as_object_mut() {
                    obj.insert("translated".into(), json!(translated));
                    obj.insert("status".into(), json!("ok"));
                    obj.insert("error".into(), Value::Null);
                }
            }
        }
    }
}

fn set_failed(result: &mut Value, block_id: &str, message: &str) {
    let msg: String = message.chars().take(300).collect();
    if let Some(arr) = result.get_mut("blocks").and_then(|v| v.as_array_mut()) {
        for b in arr {
            if b.get("id").and_then(|x| x.as_str()) == Some(block_id) {
                if let Some(obj) = b.as_object_mut() {
                    obj.insert("status".into(), json!("failed"));
                    obj.insert("error".into(), json!(msg));
                }
            }
        }
    }
}

/// 拆回译文:必须精确得到 n 段,否则返回 None
fn split_by_separators(text: &str, n: usize) -> Option<Vec<String>> {
    let mut parts = Vec::with_capacity(n);
    let mut rest = text;
    for i in 0..n {
        let re = regex::Regex::new(&format!(r"^\s*⟦S{i}⟧\s*\n?")).unwrap();
        let m = re.find(rest)?;
        rest = &rest[m.end()..];
        let end_idx = rest.find("⟦E⟧");
        if i < n - 1 {
            let end = end_idx?;
            parts.push(rest[..end].to_string());
            rest = &rest[end + "⟦E⟧".len()..];
        } else {
            parts.push(match end_idx {
                Some(end) => rest[..end].to_string(),
                None => rest.to_string(),
            });
        }
    }
    Some(parts)
}

fn pack_chunks<'a>(blocks: &[&'a Block], max_chars: usize) -> Vec<Vec<&'a Block>> {
    let mut chunks: Vec<Vec<&Block>> = Vec::new();
    let mut cur: Vec<&Block> = Vec::new();
    let mut cur_len = 0usize;
    let overhead = |n: usize| n * 12 + 20;
    for b in blocks {
        let add = b.text.chars().count() + 12;
        if !cur.is_empty() && cur_len + add + overhead(cur.len() + 1) > max_chars {
            chunks.push(std::mem::take(&mut cur));
            cur_len = 0;
        }
        cur.push(*b);
        cur_len += add;
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}
