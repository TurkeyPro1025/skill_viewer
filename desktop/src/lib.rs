pub mod app;
pub mod attribution;
pub mod cache;
pub mod config;
pub mod connectivity;
pub mod credentials;
pub mod frontmatter;
pub mod llm;
pub mod pipeline;
pub mod providers;
pub mod scanner;
pub mod server;
pub mod stats;
pub mod translate_blocks;
pub mod uapipro;
pub mod util;

use app::App;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 构建应用状态(配置 → 缓存目录 → 凭据 → provider → 管线)。
pub async fn build_app(mut cfg: config::Config) -> Arc<App> {
    if cfg.data_dir.as_os_str().is_empty() {
        cfg.data_dir = desktop_data_dir();
    }
    let cache = cache::Cache::new(&cfg.data_dir);
    cache.ensure_dirs();

    let seeds = crate::util::read_json_if_exists(&cfg.seeds_file)
        .or_else(|| crate::util::read_json_if_exists(&PathBuf::from("seeds/summaries.json")))
        .unwrap_or_else(|| serde_json::json!({ "sources": {} }));
    let presets: serde_json::Value = serde_json::from_str(include_str!("../../lib/llm/presets.json"))
        .unwrap_or_else(|_| serde_json::json!({ "presets": [] }));

    let creds = credentials::CredentialStore::new(&cfg.data_dir);
    creds.init().await;
    let providers = providers::ProviderSettings::new(&cfg.data_dir);

    let provider = Arc::new(uapipro::UApiProProvider::new(cfg.translate.clone()));
    let pipeline = Arc::new(pipeline::Pipeline::new(provider.clone(), cfg.data_dir.clone()));

    Arc::new(App {
        config: cfg,
        cache,
        creds,
        providers,
        pipeline,
        llm: llm::LlmProvider::new(),
        seeds,
        presets,
        analyzer: Default::default(),
        port: AtomicU16::new(0),
    })
}

/// 桌面版默认数据目录:%APPDATA%\skill-viewer
pub fn desktop_data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(config::home_dir);
    base.join("skill-viewer")
}

/// 在共享 runtime 上启动 HTTP 服务,返回实际监听端口(阻塞至就绪)。
pub fn spawn_server(rt: tokio::runtime::Handle, app: Arc<App>, port_hint: u16) -> u16 {
    let (tx, rx) = std::sync::mpsc::channel::<u16>();
    rt.spawn(async move {
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port_hint)).await {
            Ok(l) => l,
            Err(err) => {
                eprintln!("[http] 绑定失败: {err}");
                return;
            }
        };
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
        app.port.store(port, Ordering::SeqCst);
        let _ = tx.send(port);
        if let Err(err) = axum::serve(listener, server::router(app.clone())).await {
            eprintln!("[http] 服务异常退出: {err}");
        }
    });
    rx.recv_timeout(Duration::from_secs(20)).expect("server start timeout")
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // --serve:无窗口服务模式(黑盒测试 / 高级用法),不自动分析
    // 用法:skill-viewer-desktop --serve [--port N] [--config config.json]
    if args.iter().any(|a| a == "--serve") {
        let port = flag_value(&args, "--port").and_then(|v| v.parse().ok()).unwrap_or(0);
        let config_file = flag_value(&args, "--config").map(PathBuf::from);
        let cfg = config::load_config(config_file.as_deref());

        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime");
        let handle = rt.handle().clone();
        rt.block_on(async move {
            let app = build_app(cfg).await;
            let port = spawn_server(handle, app, port);
            println!("LISTENING 127.0.0.1:{port}");
        });
        loop {
            std::thread::park();
        }
    }

    // 桌面窗口模式:与 node server.js 一致的启动行为(有缓存增量,无缓存全量)
    let config_file = flag_value(&args, "--config").map(PathBuf::from);
    let mut cfg = config::load_config(config_file.as_deref());
    if cfg.config_file.is_none() {
        // 无配置文件:桌面默认数据目录
        cfg.data_dir = desktop_data_dir();
    }
    if let Some(p) = flag_value(&args, "--port").and_then(|v| v.parse().ok()) {
        cfg.port = p;
    }

    let rt = Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime"),
    );

    tauri::Builder::default()
        .setup(move |tauri_app| {
            let handle = rt.handle().clone();
            let app_state = handle.block_on(build_app(cfg));
            let has_index = app_state.cache.read_index().is_some();
            let port = spawn_server(handle.clone(), app_state.clone(), 0);
            eprintln!("[desktop] http://127.0.0.1:{port}/");

            // 启动即分析(后台,与 server.js 一致)
            let state = app_state.clone();
            handle.spawn(async move {
                let trigger = if has_index { "startup-incremental" } else { "startup" };
                state.run_analysis(trigger).await;
            });

            let url: tauri::Url = format!("http://127.0.0.1:{port}/").parse().expect("valid url");
            tauri::WebviewWindowBuilder::new(tauri_app, "main", tauri::WebviewUrl::External(url))
                .title("Skill 全览 · 本地知识库")
                .inner_size(1280.0, 860.0)
                .min_inner_size(920.0, 600.0)
                .build()?;
            let _rt = rt; // 保持 runtime 存活
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
