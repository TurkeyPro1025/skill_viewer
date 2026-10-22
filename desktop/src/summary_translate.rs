//! 非中文界面的元数据翻译(分析写路径,与 Node summary-translate.js 对齐):
//! - card-summary = frontmatter 描述:英文直接使用,中文等其它语言译成目标语言;
//! - chips(分类标签)与 group-summary(仓库简介)从中文种子/中文概述缓存翻译为目标语言;
//! - 结果分别写入 skills/{id}/{lang}.json、summaries/labels/{lang}.json、summaries/repos/{lang}.json。
//! 内容未变时按源文本哈希命中缓存,不再调用翻译服务。

use crate::cache::Cache;
use crate::pipeline::Pipeline;
use crate::summaries::{
    is_valid_localized_cache, localized_source, summary_source_hash, Card, EntityRef,
};
use crate::util::{detect_language, now_iso, sha1_hex};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn needs_translation(text: &str, lang: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    if lang == "en" {
        return detect_language(text) == "zh";
    }
    // 未来语言:非英文文本都译;英文文本直接使用
    detect_language(text) != "en"
}

fn repo_summary_of(seeds: &Value, repo: &str) -> String {
    seeds
        .get("sources")
        .and_then(|s| s.get(repo))
        .and_then(|s| s.get("repoSummary"))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

pub struct LocalizedResult {
    pub cards: HashMap<String, Card>,
    pub written: usize,
    pub failed: usize,
}

/// 分析阶段批量翻译元数据。返回 None = 不适用(中文界面/未同意/未配置),调用方走原文直出。
#[allow(clippy::too_many_arguments)]
pub async fn localize_summaries(
    entities: &[EntityRef<'_>],
    repos: &HashMap<String, Option<String>>,
    lang: &str,
    seeds: &Value,
    cache: &Cache,
    pipeline: &Pipeline,
    api_key: &str,
    consented: bool,
) -> Option<LocalizedResult> {
    if lang == "zh" || !consented || !pipeline.provider.configured(api_key) {
        return None;
    }

    struct Row {
        id: String,
        content_hash: String,
        source: crate::summaries::LocalizedSource,
        cached: Option<Value>,
        valid: bool,
    }
    let rows: Vec<Row> = entities
        .iter()
        .map(|e| {
            let repo = repos.get(e.id).and_then(|r| r.as_deref());
            let source = localized_source(e, repo, seeds, cache);
            let cached = cache.read_skill(e.id, lang);
            let valid = is_valid_localized_cache(cached.as_ref(), e, lang, &source);
            Row {
                id: e.id.to_string(),
                content_hash: e.content_hash.to_string(),
                source,
                cached,
                valid,
            }
        })
        .collect();

    let mut label_map = cache.read_label_map(lang);
    let repo_data = cache.read_repo_summaries(lang);
    let mut repo_entries: Map<String, Value> = repo_data
        .get("entries")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let mut requests: Vec<String> = Vec::new();
    let mut request_index: HashMap<String, usize> = HashMap::new();
    let add_request = |key: String, text: String, requests: &mut Vec<String>,
                       request_index: &mut HashMap<String, usize>| {
        if let Some(&i) = request_index.get(&key) {
            return i;
        }
        let i = requests.len();
        requests.push(text);
        request_index.insert(key, i);
        i
    };

    let mut desc_index: HashMap<String, usize> = HashMap::new();
    let mut cat_index: HashMap<String, usize> = HashMap::new();
    let mut repo_index: HashMap<String, usize> = HashMap::new();

    for row in &rows {
        if row.valid {
            continue;
        }
        if needs_translation(&row.source.description, lang) {
            let i = add_request(format!("d:{}", row.id), row.source.description.clone(), &mut requests, &mut request_index);
            desc_index.insert(row.id.clone(), i);
        }
        for cat in &row.source.categories {
            if !needs_translation(cat, lang) || label_map.contains_key(cat) {
                continue;
            }
            let i = add_request(format!("c:{cat}"), cat.clone(), &mut requests, &mut request_index);
            cat_index.insert(cat.clone(), i);
        }
    }

    // 仓库简介:保持首次出现顺序去重
    let mut repo_order: Vec<String> = Vec::new();
    for e in entities {
        if let Some(Some(repo)) = repos.get(e.id) {
            if !repo_order.contains(repo) {
                repo_order.push(repo.clone());
            }
        }
    }
    let mut repo_entries_changed = false;
    for repo in &repo_order {
        let source = repo_summary_of(seeds, repo);
        if source.is_empty() {
            continue;
        }
        let existing_ok = repo_entries
            .get(repo)
            .map(|x| {
                x.get("sourceHash").and_then(|v| v.as_str()) == Some(sha1_hex(&source).as_str())
                    && x.get("summary").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
            })
            .unwrap_or(false);
        if existing_ok {
            continue;
        }
        if needs_translation(&source, lang) {
            let i = add_request(format!("r:{repo}"), source, &mut requests, &mut request_index);
            repo_index.insert(repo.clone(), i);
        } else {
            repo_entries.insert(repo.clone(), json!({ "summary": source, "sourceHash": sha1_hex(&source) }));
            repo_entries_changed = true;
        }
    }

    let translations = pipeline.translate_texts(&requests, lang, api_key).await;
    let failed = translations.iter().filter(|t| t.is_none()).count();

    let mut cards: HashMap<String, Card> = HashMap::new();
    let mut written = 0usize;
    for row in &rows {
        if row.valid {
            let c = row.cached.as_ref().unwrap();
            cards.insert(
                row.id.clone(),
                Card {
                    summary: c.get("summary").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    summary_source: "description",
                    categories: c
                        .get("categories")
                        .and_then(|v| v.as_array())
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                        .unwrap_or_default(),
                },
            );
            continue;
        }

        let desc_at = desc_index.get(&row.id).copied();
        let translated_desc = match desc_at {
            None => Some(row.source.description.clone()),
            Some(i) => translations.get(i).and_then(|t| t.clone()),
        };
        // 描述翻译失败:不写缓存(下次分析重试),由调用方回退原文
        if desc_at.is_some() && translated_desc.is_none() {
            continue;
        }

        let mut categories: Vec<String> = Vec::new();
        let mut incomplete = false;
        for cat in &row.source.categories {
            if !needs_translation(cat, lang) {
                categories.push(cat.clone());
                continue;
            }
            let translated = label_map
                .get(cat)
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| cat_index.get(cat).and_then(|&i| translations.get(i)).and_then(|t| t.clone()));
            if let Some(t) = translated {
                categories.push(t.clone());
                label_map.insert(cat.clone(), json!(t));
            } else {
                incomplete = true;
            }
        }
        // 分类翻译有缺失:不写缓存,下次分析重试(避免永久丢掉部分 chips)
        if incomplete {
            continue;
        }

        let summary = translated_desc.unwrap_or_else(|| "(no description)".to_string());
        cache.write_skill(
            &row.id,
            lang,
            &json!({
                "id": row.id,
                "lang": lang,
                "contentHash": row.content_hash,
                "sourceHash": summary_source_hash(&row.source),
                "summary": summary,
                "summarySource": "description",
                "categories": categories,
                "createdAt": now_iso(),
            }),
        );
        written += 1;
        cards.insert(row.id.clone(), Card { summary, summary_source: "description", categories });
    }

    for (repo, i) in &repo_index {
        if let Some(Some(t)) = translations.get(*i).map(|t| t.as_deref()) {
            let source = repo_summary_of(seeds, repo);
            repo_entries.insert(repo.clone(), json!({ "summary": t, "sourceHash": sha1_hex(&source) }));
            repo_entries_changed = true;
        }
    }
    if repo_entries_changed {
        cache.write_repo_summaries(lang, &json!({ "entries": repo_entries }));
    }
    if !label_map.is_empty() {
        cache.write_label_map(lang, &label_map);
    }

    Some(LocalizedResult { cards, written, failed })
}
