//! 应用状态容器 + 分析编排(与 Node analyze.js 对齐):
//! 扫描 → 归属(瀑布) → 概述(种子→缓存→LLM→降级) → 入口文档预翻译(仅手动触发)。

use crate::attribution::{self, Attribution, Manifests, ResolveCtx};
use crate::cache::Cache;
use crate::config::Config;
use crate::credentials::CredentialStore;
use crate::llm::{self, LlmConfig, LlmProvider};
use crate::pipeline::Pipeline;
use crate::providers::ProviderSettings;
use crate::scanner::{self, Entity};
use crate::util::now_iso;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct App {
    pub config: Config,
    pub cache: Cache,
    pub creds: CredentialStore,
    pub providers: ProviderSettings,
    pub pipeline: Arc<Pipeline>,
    pub llm: LlmProvider,
    pub seeds: Value,
    pub presets: Value,
    pub analyzer: AnalyzerState,
    pub port: std::sync::atomic::AtomicU16,
}

#[derive(Default)]
pub struct AnalyzerState {
    pub progress: Mutex<Progress>,
    busy: tokio::sync::Mutex<()>,
    pub running: AtomicU64, // 0 = 空闲,>0 = 运行代数
}

#[derive(Clone, Default)]
pub struct Progress {
    pub phase: String,
    pub done: u64,
    pub total: u64,
    pub detail: String,
    pub started_at: Option<String>,
    pub errors: Vec<String>,
}

impl Progress {
    fn to_json(&self) -> Value {
        json!({
            "phase": if self.phase.is_empty() { "idle" } else { self.phase.as_str() },
            "done": self.done,
            "total": self.total,
            "detail": self.detail,
            "startedAt": self.started_at,
            "errors": self.errors,
        })
    }
}

impl App {
    pub async fn llm_config(&self) -> LlmConfig {
        let p = self.providers.get().await;
        let llm = p.get("llm").cloned().unwrap_or(Value::Null);
        LlmConfig {
            base_url: llm.get("baseUrl").and_then(|v| v.as_str()).unwrap_or_default().trim_end_matches('/').to_string(),
            api_key: self.creds.get("llm").await.unwrap_or_default(),
            model: llm.get("model").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        }
    }

    pub async fn translate_key(&self) -> String {
        self.creds.get("uapipro").await.unwrap_or_default()
    }

    pub async fn llm_configured(&self) -> bool {
        LlmProvider::configured(&self.llm_config().await)
    }

    pub async fn translate_configured(&self) -> bool {
        let key = self.translate_key().await;
        self.pipeline.provider.configured(&key)
    }

    /// 触发一轮分析。若已在运行,等待当轮结束后返回最新索引(与 Node 单飞语义等价)。
    pub async fn run_analysis(&self, trigger: &str) -> Value {
        if let Ok(_permit) = self.analyzer.busy.try_lock() {
            self.analyzer.running.store(1, Ordering::SeqCst);
            let index = analyze(self, trigger).await;
            self.analyzer.running.store(0, Ordering::SeqCst);
            index
        } else {
            let _guard = self.analyzer.busy.lock().await;
            self.cache.read_index().unwrap_or(Value::Null)
        }
    }

    pub async fn is_running(&self) -> bool {
        self.analyzer.running.load(Ordering::SeqCst) > 0
    }

    pub async fn get_progress(&self) -> Value {
        self.analyzer.progress.lock().await.to_json()
    }
}

fn entity_json(e: &Entity, attribution: &Attribution, summary: &str, summary_source: &str, categories: &[String]) -> Value {
    json!({
        "id": e.id,
        "realPath": e.real_path.to_string_lossy(),
        "dirName": e.dir_name,
        "name": e.name,
        "description": e.description,
        "entryLanguage": e.entry_language,
        "contentHash": e.content_hash,
        "docs": e.docs.iter().map(|d| json!({ "rel": d.rel, "size": d.size })).collect::<Vec<_>>(),
        "images": e.images,
        "forked": e.forked,
        "versionLabel": e.version_label,
        "appearances": e.appearances.iter().map(|a| json!({ "rootLabel": a.root_label, "linked": a.linked })).collect::<Vec<_>>(),
        "copies": e.copies.iter().map(|c| json!({
            "realPath": c.real_path.to_string_lossy(),
            "appearances": c.appearances.iter().map(|a| json!({ "rootLabel": a.root_label, "linked": a.linked })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "attribution": attribution.to_json(),
        "summary": summary,
        "summarySource": summary_source,
        "categories": categories,
    })
}

fn enrich_body_preview(e: &mut Entity) {
    let skill_md = e.real_path.join("SKILL.md");
    let raw = match std::fs::read_to_string(&skill_md) {
        Ok(r) => r,
        Err(_) => return,
    };
    let fm_end = raw[3.min(raw.len())..].find("---").map(|i| i + 3.min(raw.len()));
    let body = match fm_end {
        Some(fe) if fe > 0 => match raw[fe..].find('\n') {
            Some(nl) => &raw[fe + nl + 1..],
            None => raw.as_str(),
        },
        _ => raw.as_str(),
    };
    e.body_preview = body.chars().take(4000).collect();
}

async fn analyze(app: &App, trigger: &str) -> Value {
    let mut progress = Progress {
        phase: "scan".into(),
        done: 0,
        total: 0,
        detail: "扫描技能根目录…".into(),
        started_at: Some(now_iso()),
        errors: Vec::new(),
    };
    *app.analyzer.progress.lock().await = progress.clone();

    let usage0_calls = app.pipeline.provider.stats.calls();
    let usage0_credits = app.pipeline.provider.stats.credits();

    let overrides = app.cache.read_overrides();
    let overrides_entries = overrides.get("entries").cloned().unwrap_or(json!({}));

    // 清单:解析所有 lock 文件
    let mut manifests: Manifests = HashMap::new();
    for file in &app.config.lock_files.clone() {
        match attribution::read_manifest(file) {
            Some((_, entries)) => {
                manifests.insert(file.clone(), entries);
            }
            None => progress.errors.push(format!("清单未识别或不可读: {}", file.display())),
        }
    }
    let mut known_repos: Vec<String> = Vec::new();
    for m in manifests.values() {
        for e in m.values() {
            if !e.repo.is_empty() && !known_repos.contains(&e.repo) {
                known_repos.push(e.repo.clone());
            }
        }
    }

    // 扫描(阻塞文件 IO 放线程池)
    let roots = app.config.roots.clone();
    let scan_result = tokio::task::spawn_blocking(move || scanner::scan(&roots))
        .await
        .unwrap_or_else(|_| scanner::ScanResult { entities: Vec::new(), ignored: Vec::new(), scanned_at: now_iso() });

    progress.phase = "attribute".into();
    progress.total = scan_result.entities.len() as u64;
    let mut entities = scan_result.entities;
    for e in entities.iter_mut() {
        enrich_body_preview(e);
    }

    let mut upstreams: HashMap<String, (String, String)> = HashMap::new();
    for e in &entities {
        if let Some(url) = attribution::find_source_url(&e.frontmatter) {
            upstreams.insert(e.dir_name.clone(), (url.clone(), attribution::repo_from_url(&url)));
        }
    }

    // LLM 推断(负结果也缓存:内容未变不再烧调用)
    let empty_inference: HashMap<String, Option<Attribution>> = HashMap::new();
    let base_ctx = ResolveCtx {
        manifests: &manifests,
        known_repos: &known_repos,
        upstreams: &upstreams,
        last_inference: &empty_inference,
    };
    let mut last_inference: HashMap<String, Option<Attribution>> = HashMap::new();

    let prev_index = app.cache.read_index();
    let prev_entities: HashMap<String, String> = prev_index
        .as_ref()
        .and_then(|v| v.get("entities").and_then(|x| x.as_array()).cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    let id = e.get("id")?.as_str()?.to_string();
                    let hash = e.get("contentHash").and_then(|h| h.as_str()).unwrap_or_default().to_string();
                    Some((id, hash))
                })
                .collect()
        })
        .unwrap_or_default();
    let prev_inference: Map<String, Value> = prev_index
        .as_ref()
        .and_then(|v| v.get("lastInference").and_then(|x| x.as_object()).cloned())
        .unwrap_or_default();

    let llm_cfg = app.llm_config().await;
    if llm::LlmProvider::configured(&llm_cfg) {
        for e in &entities {
            let o = overrides_entries.get(&e.id).and_then(|v| v.as_object());
            if o.map(|x| x.contains_key("repo")).unwrap_or(false) {
                continue; // 手动已归组
            }
            let base = attribution::resolve(e, &base_ctx, &overrides_entries, &app.config.lock_files);
            if base.repo.is_some() {
                continue;
            }
            if let Some(prev) = prev_inference.get(&e.id) {
                if prev_entities.get(&e.id).map(|h| h == &e.content_hash).unwrap_or(false) {
                    last_inference.insert(
                        e.id.clone(),
                        attribution_from_index(prev),
                    );
                    continue;
                }
            }
            progress.detail = format!("LLM 推断归属:{}", e.name);
            *app.analyzer.progress.lock().await = progress.clone();
            match app.llm.chat_json(&llm_cfg, &llm::build_inference_messages(e, &known_repos)).await {
                Ok(obj) => match llm::parse_inference(&obj) {
                    Some(parsed) => {
                        last_inference.insert(
                            e.id.clone(),
                            Some(Attribution {
                                repo: Some(parsed.repo),
                                source_url: None,
                                group: None,
                                method: Some("llm".into()),
                                inferred: true,
                                confidence: Some(parsed.confidence),
                                alternatives: parsed.alternatives,
                                confirmed: false,
                                upstream: base.upstream.clone(),
                                ..Default::default()
                            }),
                        );
                    }
                    None => {
                        last_inference.insert(e.id.clone(), None);
                    }
                },
                Err(err) => {
                    let msg: String = err.message.chars().take(120).collect();
                    progress.errors.push(format!("LLM 推断失败({}): {}", e.name, msg));
                }
            }
        }
    }

    // 最终遍:带推断结果与 overrides 走完整瀑布
    let ctx = ResolveCtx {
        manifests: &manifests,
        known_repos: &known_repos,
        upstreams: &upstreams,
        last_inference: &last_inference,
    };
    let mut attributions: HashMap<String, Attribution> = HashMap::new();
    for (i, e) in entities.iter().enumerate() {
        progress.done = i as u64 + 1;
        progress.detail = format!("归属:{}", e.name);
        *app.analyzer.progress.lock().await = progress.clone();
        attributions.insert(e.id.clone(), attribution::resolve(e, &ctx, &overrides_entries, &app.config.lock_files));
    }

    // 概述:种子 → 缓存(内容未变) → LLM → 降级描述
    progress.phase = "summaries".into();
    progress.done = 0;
    *app.analyzer.progress.lock().await = progress.clone();

    let seeds_sources = app.seeds.get("sources").cloned().unwrap_or(Value::Null);
    let mut cards: HashMap<String, (String, String, Vec<String>)> = HashMap::new();
    for (i, e) in entities.iter().enumerate() {
        progress.done = i as u64 + 1;
        progress.detail = format!("概述:{}", e.name);
        *app.analyzer.progress.lock().await = progress.clone();
        let a = attributions.get(&e.id).unwrap();
        let (summary, source, categories) = resolve_card(app, e, a, &seeds_sources, &llm_cfg, &mut progress).await;
        cards.insert(e.id.clone(), (summary, source, categories));
    }

    // 组装索引
    let lock_files_json: Vec<String> = app.config.lock_files.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let entities_json: Vec<Value> = entities
        .iter()
        .map(|e| {
            let (summary, source, categories) = cards.get(&e.id).cloned().unwrap_or_default();
            entity_json(e, attributions.get(&e.id).unwrap(), &summary, &source, &categories)
        })
        .collect();
    let linked_merged: u64 = entities.iter().map(|e| e.appearances.len().saturating_sub(1) as u64).sum();
    let attributed_count = attributions.values().filter(|a| a.repo.is_some()).count();
    let inferred_count = attributions.values().filter(|a| a.inferred && !a.confirmed).count();
    let last_inference_json: Map<String, Value> = last_inference
        .iter()
        .map(|(k, v)| (k.clone(), v.as_ref().map(|a| a.to_json()).unwrap_or(Value::Null)))
        .collect();

    let index = json!({
        "version": 1,
        "scannedAt": scan_result.scanned_at,
        "trigger": trigger,
        "roots": app.config.roots.iter().map(|r| json!({
            "path": r.to_string_lossy(),
            "label": scanner::root_label_of(r),
        })).collect::<Vec<_>>(),
        "lockFiles": lock_files_json,
        "entities": entities_json,
        "ignored": scan_result.ignored,
        "lastInference": last_inference_json,
        "stats": {
            "entities": entities.len(),
            "attributed": attributed_count,
            "inferred": inferred_count,
            "linkedMerged": linked_merged,
        },
    });
    app.cache.write_index(&index);

    // 入口文档预翻译:只在用户显式点「手动更新」时执行(知情、按需烧积分)
    let state = app.cache.read_state();
    let consent = state.get("consentTranslate").and_then(|v| v.as_bool()).unwrap_or(false);
    let api_key = app.translate_key().await;
    let provider_ready = app.pipeline.provider.configured(&api_key);
    if consent && trigger == "manual" && provider_ready {
        progress.phase = "pretranslate".into();
        let english: Vec<&Entity> = entities.iter().filter(|e| e.entry_language != "zh").collect();
        progress.total = english.len() as u64;
        progress.done = 0;
        *app.analyzer.progress.lock().await = progress.clone();
        for e in &english {
            progress.done += 1;
            progress.detail = format!("预翻译:{}", e.name);
            *app.analyzer.progress.lock().await = progress.clone();
            if let Err(err) = app.pipeline.ensure_translation(&e.id, &e.real_path, "SKILL.md", &api_key, true).await {
                if err.code != "provider_unconfigured" {
                    let msg: String = err.message.chars().take(120).collect();
                    progress.errors.push(format!("预翻译失败({}): {}", e.name, msg));
                }
            }
        }
    }

    progress.phase = "done".into();
    progress.detail = format!("完成:{} 个技能,归属 {} 个", entities.len(), attributed_count);
    *app.analyzer.progress.lock().await = progress.clone();

    // 累计积分/调用数写入状态(增量)
    let mut next_state = app.cache.read_state();
    let errors_tail: Vec<String> = progress.errors.iter().take(20).cloned().collect();
    next_state["lastAnalysis"] = json!({
        "at": now_iso(),
        "trigger": trigger,
        "entities": entities.len(),
        "errors": errors_tail,
    });
    let d_calls = app.pipeline.provider.stats.calls().saturating_sub(usage0_calls);
    let d_credits = app.pipeline.provider.stats.credits().saturating_sub(usage0_credits);
    if d_calls > 0 {
        let api_calls = next_state.get("apiCalls").and_then(|v| v.as_u64()).unwrap_or(0) + d_calls;
        let credits = next_state.get("creditsUsed").and_then(|v| v.as_u64()).unwrap_or(0) + d_credits;
        next_state["apiCalls"] = json!(api_calls);
        next_state["creditsUsed"] = json!(credits);
    }
    app.cache.write_state(&next_state);

    index
}

/// 概述解析:种子 → 缓存 → LLM → 降级描述
async fn resolve_card(
    app: &App,
    e: &Entity,
    attribution: &Attribution,
    seeds_sources: &Value,
    llm_cfg: &LlmConfig,
    progress: &mut Progress,
) -> (String, String, Vec<String>) {
    // 1. 种子(按 repo+dirName,或全局 *)
    let by_repo = attribution
        .repo
        .as_ref()
        .and_then(|r| seeds_sources.get(r));
    let seed = by_repo
        .and_then(|s| s.get("skills").and_then(|k| k.get(&e.dir_name)))
        .or_else(|| seeds_sources.get("*").and_then(|s| s.get("skills").and_then(|k| k.get(&e.dir_name))));
    if let Some(seed) = seed {
        if let Some(summary) = seed.get("summary").and_then(|v| v.as_str()) {
            let categories: Vec<String> = seed
                .get("categories")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|c| c.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            return (summary.to_string(), "seed".into(), categories);
        }
    }
    // 2. 缓存:内容未变沿用
    let cached = app.cache.read_skill(&e.id);
    let cached_match = cached
        .as_ref()
        .filter(|c| c.get("contentHash").and_then(|h| h.as_str()) == Some(e.content_hash.as_str()));
    if let Some(c) = cached_match {
        if let Some(summary) = c.get("summary").and_then(|v| v.as_str()) {
            let categories: Vec<String> = c
                .get("categories")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let source = c.get("summarySource").and_then(|v| v.as_str()).unwrap_or("llm").to_string();
            return (summary.to_string(), source, categories);
        }
    }
    // 3. LLM 生成
    if llm::LlmProvider::configured(llm_cfg) {
        match app.llm.chat_json(llm_cfg, &llm::build_summary_messages(e)).await {
            Ok(obj) => {
                if let Some(parsed) = llm::parse_summary(&obj) {
                    app.cache.write_skill(
                        &e.id,
                        &json!({
                            "id": e.id,
                            "contentHash": e.content_hash,
                            "summary": parsed.summary,
                            "summarySource": "llm",
                            "categories": parsed.categories,
                            "createdAt": now_iso(),
                        }),
                    );
                    return (parsed.summary, "llm".into(), parsed.categories);
                }
            }
            Err(err) => {
                let msg: String = err.message.chars().take(120).collect();
                progress.errors.push(format!("LLM 概述失败({}): {}", e.name, msg));
            }
        }
    }
    // 4. 降级:frontmatter 原文描述
    let cached_categories: Vec<String> = cached
        .as_ref()
        .and_then(|c| c.get("categories"))
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    let summary = if e.description.is_empty() { "(无描述)".to_string() } else { e.description.clone() };
    (summary, "fallback".into(), cached_categories)
}

fn attribution_from_index(v: &Value) -> Option<Attribution> {
    // JSON null = "推断不出"的负结果缓存,保持为 None(不能变成全空对象)
    if v.is_null() {
        return None;
    }
    Some(Attribution {
        repo: v.get("repo").and_then(|x| x.as_str()).map(|s| s.to_string()),
        method: v.get("method").and_then(|x| x.as_str()).map(|s| s.to_string()),
        source_url: v.get("sourceUrl").and_then(|x| x.as_str()).map(|s| s.to_string()),
        group: v.get("group").and_then(|x| x.as_str()).map(|s| s.to_string()),
        manifest: v.get("manifest").and_then(|x| x.as_str()).map(|s| s.to_string()),
        skill_folder_hash: v.get("skillFolderHash").and_then(|x| x.as_str()).map(|s| s.to_string()),
        installed_at: v.get("installedAt").and_then(|x| x.as_str()).map(|s| s.to_string()),
        inferred: v.get("inferred").and_then(|x| x.as_bool()).unwrap_or(false),
        confidence: v.get("confidence").and_then(|x| x.as_str()).map(|s| s.to_string()),
        confirmed: v.get("confirmed").and_then(|x| x.as_bool()).unwrap_or(false),
        upstream: v.get("upstream").filter(|x| !x.is_null()).cloned(),
        manual: v.get("manual").and_then(|x| x.as_bool()).unwrap_or(false),
        upstream_only: v.get("upstreamOnly").and_then(|x| x.as_bool()).unwrap_or(false),
        unknown: v.get("unknown").and_then(|x| x.as_bool()).unwrap_or(false),
        alternatives: v
            .get("alternatives")
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|y| y.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
    })
}
