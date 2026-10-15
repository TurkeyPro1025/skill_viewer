//! 连通性探针(与 Node connectivity.js 对齐):
//! - LLM:GET /models(顺带拿模型列表),404/405 回退 1-token chat;
//! - 翻译:免费档 = usage 探针 + 空 text 请求(401=key 无效,400=鉴权通过);完整档 = 真实翻译 1 字符。

use serde_json::{json, Value};
use std::time::Instant;

const LLM_TIMEOUT_MS: u64 = 12_000;
const TRANSLATE_TIMEOUT_MS: u64 = 15_000;

pub async fn test_llm(base_url: &str, api_key: &str, model: &str) -> Value {
    let base = base_url.trim_end_matches('/');
    if base.is_empty() {
        return json!({ "ok": false, "error": "缺少 API 地址" });
    }
    let t0 = Instant::now();
    let client = reqwest::Client::new();

    // 1) models 列表
    match client
        .get(format!("{base}/models"))
        .header("Authorization", format!("Bearer {api_key}"))
        .timeout(std::time::Duration::from_millis(LLM_TIMEOUT_MS))
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status().as_u16();
            if (200..300).contains(&status) {
                let body: Value = res.json().await.unwrap_or(Value::Null);
                let models: Vec<String> = body
                    .get("data")
                    .and_then(|v| v.as_array())
                    .map(|a| {
                        a.iter()
                            .filter_map(|m| m.get("id").and_then(|x| x.as_str()).map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                return json!({ "ok": true, "latencyMs": t0.elapsed().as_millis() as u64, "models": models });
            }
            if status == 401 || status == 403 {
                return json!({
                    "ok": false,
                    "latencyMs": t0.elapsed().as_millis() as u64,
                    "error": format!("鉴权失败(HTTP {status}):key 无效或无权限"),
                });
            }
            // 404/405 → 走 chat 探测
        }
        Err(err) => {
            return json!({ "ok": false, "error": format!("无法连接:{err}") });
        }
    }

    // 2) 1-token chat 兜底
    match client
        .post(format!("{base}/chat/completions"))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&json!({
            "model": if model.is_empty() { "gpt-3.5-turbo" } else { model },
            "messages": [{ "role": "user", "content": "ping" }],
            "max_tokens": 1,
        }))
        .timeout(std::time::Duration::from_millis(LLM_TIMEOUT_MS))
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status().as_u16();
            if (200..300).contains(&status) {
                json!({ "ok": true, "latencyMs": t0.elapsed().as_millis() as u64, "models": [] })
            } else if status == 401 || status == 403 {
                json!({
                    "ok": false,
                    "latencyMs": t0.elapsed().as_millis() as u64,
                    "error": format!("鉴权失败(HTTP {status}):key 无效或无权限"),
                })
            } else {
                let detail = res.text().await.unwrap_or_default();
                let detail: String = detail.chars().take(200).collect();
                json!({
                    "ok": false,
                    "latencyMs": t0.elapsed().as_millis() as u64,
                    "error": format!("服务返回 HTTP {status}:{detail}"),
                })
            }
        }
        Err(err) => json!({ "ok": false, "error": format!("无法连接:{err}") }),
    }
}

pub async fn test_translate(
    endpoint: &str,
    api_key: &str,
    full: bool,
    style: &str,
    context: &str,
) -> Value {
    let mut out = json!({ "reachable": false, "keyAccepted": null, "full": null });
    let origin = match endpoint.split_once("//").map(|(scheme, rest)| {
        let host = rest.split('/').next().unwrap_or("");
        format!("{scheme}//{host}")
    }) {
        Some(o) if endpoint.starts_with("http") => o,
        _ => {
            out["error"] = json!(format!("endpoint 配置不合法: {endpoint}"));
            return out;
        }
    };
    let client = reqwest::Client::new();

    // 免费可达性探针
    match client
        .get(format!("{origin}/api/v1/status/usage"))
        .timeout(std::time::Duration::from_millis(8000))
        .send()
        .await
    {
        Ok(r) => {
            out["reachable"] = json!(r.status().is_success());
        }
        Err(err) => {
            out["error"] = json!(format!("服务不可达:{err}"));
            return out;
        }
    }
    if out["reachable"] != json!(true) {
        out["error"] = json!("服务可达性探针未通过");
        return out;
    }
    if api_key.is_empty() {
        out["error"] = json!("未提供 API key");
        return out;
    }

    let url = format!("{endpoint}?target_lang=zh");

    if full {
        // 真实翻译 1 字符:确定但计费
        match client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {api_key}"))
            .json(&json!({ "text": "hi", "style": style, "context": context, "preserve_format": true }))
            .timeout(std::time::Duration::from_millis(TRANSLATE_TIMEOUT_MS))
            .send()
            .await
        {
            Ok(res) => {
                let status = res.status().as_u16();
                if (200..300).contains(&status) {
                    let body: Value = res.json().await.unwrap_or(Value::Null);
                    let sample = body
                        .pointer("/data/translated_text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let sample: String = sample.chars().take(80).collect();
                    out["full"] = json!({ "ok": true, "sample": sample });
                    out["keyAccepted"] = json!(true);
                } else if status == 401 || status == 403 {
                    out["keyAccepted"] = json!(false);
                    out["full"] = json!({ "ok": false, "error": format!("key 无效(HTTP {status})") });
                } else {
                    let detail = res.text().await.unwrap_or_default();
                    let detail: String = detail.chars().take(200).collect();
                    out["full"] = json!({ "ok": false, "error": format!("HTTP {status}:{detail}") });
                    out["keyAccepted"] = json!(status != 401);
                }
            }
            Err(err) => {
                out["full"] = json!({ "ok": false, "error": err.to_string() });
            }
        }
        return out;
    }

    // 免费档:空 text 请求。401=key 无效,400=已过鉴权
    match client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {api_key}"))
        .json(&json!({ "text": "", "style": style, "context": context, "preserve_format": true }))
        .timeout(std::time::Duration::from_millis(TRANSLATE_TIMEOUT_MS))
        .send()
        .await
    {
        Ok(res) => {
            let status = res.status().as_u16();
            out["keyAccepted"] = json!(status != 401 && status != 403);
        }
        Err(err) => {
            out["error"] = json!(format!("探测请求失败:{err}"));
        }
    }
    out
}
