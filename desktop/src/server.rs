//! HTTP 层:复用 public/ 前端(一份代码双端)。
//! - debug:从磁盘读 ../public(改 CSS/JS 免重编译)
//! - release:include_bytes! 内嵌进二进制,单文件分发
//! API 在 M3 逐模块补齐,当前返回 501 结构化错误(与 Node 版错误格式一致)。

use axum::{
    extract::Request,
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde_json::json;

pub fn router() -> Router {
    Router::new()
        .route("/", get(index_route))
        .route("/style.css", get(css_route))
        .route("/app.js", get(js_route))
        .fallback(fallback)
        .layer(middleware::from_fn(log_requests))
}

async fn index_route() -> Response {
    asset("index.html", "text/html; charset=utf-8")
}
async fn css_route() -> Response {
    asset("style.css", "text/css; charset=utf-8")
}
async fn js_route() -> Response {
    asset("app.js", "application/javascript; charset=utf-8")
}

async fn log_requests(req: Request, next: Next) -> Response {
    if cfg!(debug_assertions) || std::env::var_os("SKILL_VIEWER_VERBOSE").is_some() {
        eprintln!("[http] {} {}", req.method(), req.uri().path());
    }
    next.run(req).await
}

fn asset(name: &str, mime: &str) -> Response {
    #[cfg(debug_assertions)]
    {
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public");
        if let Ok(body) = std::fs::read(base.join(name)) {
            return (
                [(header::CONTENT_TYPE, mime.to_string())],
                body,
            )
                .into_response();
        }
        eprintln!("[http] 磁盘读取 {name} 失败,回退内嵌资源");
    }
    let body: &'static [u8] = match name {
        "index.html" => include_bytes!("../../public/index.html"),
        "style.css" => include_bytes!("../../public/style.css"),
        "app.js" => include_bytes!("../../public/app.js"),
        _ => return not_found(),
    };
    (
        [(header::CONTENT_TYPE, mime.to_string())],
        body,
    )
        .into_response()
}

async fn fallback(req: Request) -> Response {
    let path = req.uri().path().to_string();
    if path.starts_with("/api/") {
        return api_not_implemented(&path);
    }
    // SPA 兜底:未知路径回首页(与 Node 版行为一致)
    asset("index.html", "text/html; charset=utf-8")
}

fn not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({ "error": { "code": "not_found", "message": "资源不存在" } })),
    )
        .into_response()
}

fn api_not_implemented(path: &str) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": {
                "code": "not_implemented",
                "message": format!("Rust 服务尚未移植该端点(M3 进行中):{path}"),
            }
        })),
    )
        .into_response()
}
