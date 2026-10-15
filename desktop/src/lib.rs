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
pub async fn build_app(mut cfg: config::Config, desktop: bool) -> Arc<App> {
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

    // 桌面设置:默认 关窗最小化到托盘、不开机自启
    let desktop_settings = crate::util::read_json_if_exists(&cfg.data_dir.join("desktop.json"))
        .unwrap_or_else(|| serde_json::json!({ "autostart": false, "closeToExit": false }));

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
        desktop,
        desktop_settings: std::sync::RwLock::new(desktop_settings),
        tauri_handle: std::sync::OnceLock::new(),
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
            let app = build_app(cfg, false).await;
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
    // 开机自启带 --hidden:登录后静默驻留托盘
    let start_hidden = args.iter().any(|a| a == "--hidden");

    let rt = Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("build tokio runtime"),
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动:聚焦已有窗口
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(move |tauri_app| {
            use tauri::Manager;

            let handle = rt.handle().clone();
            let app_state = handle.block_on(build_app(cfg, true));
            tauri_app.manage(app_state.clone());
            let has_index = app_state.cache.read_index().is_some();
            let port = spawn_server(handle.clone(), app_state.clone(), 0);
            eprintln!("[desktop] http://127.0.0.1:{port}/");

            // 启动即分析(后台,与 server.js 一致)
            let state = app_state.clone();
            handle.spawn(async move {
                let trigger = if has_index { "startup-incremental" } else { "startup" };
                state.run_analysis(trigger).await;
            });

            // 桌面设置:按已存状态应用开机自启
            let _ = app_state.tauri_handle.set(tauri_app.handle().clone());
            apply_autostart(tauri_app.handle(), &app_state.read_desktop_settings());

            // 主窗口(指向本地服务)
            let url: tauri::Url = format!("http://127.0.0.1:{port}/").parse().expect("valid url");
            let window = tauri::WebviewWindowBuilder::new(tauri_app, "main", tauri::WebviewUrl::External(url))
                .title("Skill 全览 · 本地知识库")
                .inner_size(1280.0, 860.0)
                .min_inner_size(920.0, 600.0)
                .visible(!start_hidden)
                .build()?;

            // 托盘:显示 / 退出
            use tauri::menu::{MenuBuilder, MenuItemBuilder};
            use tauri::tray::{TrayIconBuilder, TrayIconEvent};
            let show_item = MenuItemBuilder::with_id("show", "显示 Skill 全览").build(tauri_app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(tauri_app)?;
            let menu = MenuBuilder::new(tauri_app).item(&show_item).separator().item(&quit_item).build()?;
            let tray = TrayIconBuilder::with_id("main-tray")
                .tooltip("Skill 全览 · 本地知识库")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .build(tauri_app)?;
            if let Some(icon) = tauri_app.default_window_icon() {
                tray.set_icon(Some(icon.clone()))?;
            }
            tray.on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                    if let Some(w) = tray.app_handle().get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            });

            let _ = window;
            // runtime 必须活过 setup 闭包:闭返回时局部变量会被 drop,
            // 连带杀死 axum 服务与分析任务。桌面进程整个生命周期都需要它,故显式泄漏。
            std::mem::forget(rt);
            Ok(())
        })
        .on_menu_event(|app, event| {
            use tauri::Manager;
            match event.id.as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                use tauri::Manager;
                // 默认关窗 = 最小化到托盘;设置"关闭即退出"后才真正退出
                let app_state = window.app_handle().try_state::<Arc<App>>();
                let close_to_exit = app_state
                    .map(|s| s.desktop_close_to_exit())
                    .unwrap_or(false);
                if !close_to_exit {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 按 desktop.json 应用/取消开机自启(仅窗口模式有效)
pub fn apply_autostart(handle: &tauri::AppHandle, settings: &serde_json::Value) {
    use tauri_plugin_autostart::ManagerExt;
    let want = settings.get("autostart").and_then(|v| v.as_bool()).unwrap_or(false);
    let autolaunch = handle.autolaunch();
    let result = if want {
        if !autolaunch.is_enabled().unwrap_or(false) {
            autolaunch.enable()
        } else {
            Ok(())
        }
    } else if autolaunch.is_enabled().unwrap_or(false) {
        autolaunch.disable()
    } else {
        Ok(())
    };
    if let Err(err) = result {
        eprintln!("[desktop] 开机自启设置失败: {err}");
    }
}
