pub mod server;

use std::time::Duration;

/// 启动 HTTP 服务(独立线程内的 tokio runtime),返回实际监听端口。
/// 窗口与 --serve 模式共用这一入口。
pub fn spawn_server(port_hint: u16) -> u16 {
    let (tx, rx) = std::sync::mpsc::channel::<u16>();
    std::thread::Builder::new()
        .name("http-server".into())
        .spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("build tokio runtime");
            rt.block_on(async move {
                let listener = tokio::net::TcpListener::bind(("127.0.0.1", port_hint))
                    .await
                    .expect("bind 127.0.0.1");
                let port = listener.local_addr().expect("local addr").port();
                let _ = tx.send(port);
                axum::serve(listener, server::router()).await.expect("axum serve");
            });
        })
        .expect("spawn http thread");
    rx.recv_timeout(Duration::from_secs(15)).expect("server start timeout")
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // --serve:无窗口服务模式(黑盒测试 / 高级用法)
    // 用法:skill-viewer-desktop --serve [--port N]
    if args.iter().any(|a| a == "--serve") {
        let port = flag_value(&args, "--port").and_then(|v| v.parse().ok()).unwrap_or(0);
        let port = spawn_server(port);
        println!("LISTENING 127.0.0.1:{port}");
        // 服务线程常驻,主线程挂起等待
        loop {
            std::thread::park();
        }
    }

    tauri::Builder::default()
        .setup(|app| {
            let port = spawn_server(0);
            let url: tauri::Url = format!("http://127.0.0.1:{port}/")
                .parse()
                .expect("valid url");
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .title("Skill 全览 · 本地知识库")
                .inner_size(1280.0, 860.0)
                .min_inner_size(920.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn flag_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
