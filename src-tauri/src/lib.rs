use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

// 生产模式 sidecar（Next standalone server）PID，应用退出时回收
static SIDECAR_PID: Mutex<Option<u32>> = Mutex::new(None);

/// 挑一个空闲端口给 standalone server（避开固定端口冲突）
#[cfg(not(debug_assertions))]
fn pick_free_port() -> u16 {
  if let Ok(listener) = TcpListener::bind("127.0.0.1:0") {
    if let Ok(addr) = listener.local_addr() {
      return addr.port();
    }
  }
  3100
}

/// 生产模式：以 Node sidecar 启动 Next standalone server，端口就绪后主窗口跳转
#[cfg(not(debug_assertions))]
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  let port = pick_free_port();
  let res_dir = app.path().resource_dir()?;
  let node = res_dir.join("binaries").join("node.exe");
  let server = res_dir.join("server.js");

  if !server.exists() {
    return Err(format!(
      "standalone server.js 不存在：{:?}。请先执行 pnpm tauri build（beforeBuildCommand 会组装 src-tauri/static）",
      server
    )
    .into());
  }

  let child = Command::new(&node)
    .arg(&server)
    .env("PORT", port.to_string())
    .env("HOSTNAME", "127.0.0.1")
    .current_dir(&res_dir)
    .spawn()?;
  *SIDECAR_PID.lock().unwrap() = Some(child.id());

  // 后台轮询端口就绪后，把主窗口导航到本地服务（窗口先显示 static/index.html 加载页）
  let handle = app.clone();
  std::thread::spawn(move || {
    let url = format!("http://127.0.0.1:{}", port);
    for _ in 0..240 {
      if TcpStream::connect(("127.0.0.1", port)).is_ok() {
        std::thread::sleep(Duration::from_millis(300));
        if let Some(win) = handle.get_webview_window("main") {
          if let Ok(u) = url.parse() {
            let _ = win.navigate(u);
          }
        }
        return;
      }
      std::thread::sleep(Duration::from_millis(500));
    }
  });

  Ok(())
}

/// 应用退出时回收 sidecar 整棵进程树（Windows）
#[cfg(not(debug_assertions))]
fn kill_sidecar() {
  if let Some(pid) = *SIDECAR_PID.lock().unwrap() {
    let _ = Command::new("taskkill")
      .args(["/T", "/F", "/PID", &pid.to_string()])
      .status();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .setup(|app| {
      #[cfg(debug_assertions)]
      {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(not(debug_assertions))]
      {
        spawn_sidecar(app.handle())?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|_app, event| {
    if let tauri::RunEvent::Exit = event {
      #[cfg(not(debug_assertions))]
      kill_sidecar();
    }
  });
}
