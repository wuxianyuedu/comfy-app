#[cfg(not(debug_assertions))]
use std::net::{TcpListener, TcpStream};
#[cfg(not(debug_assertions))]
use std::process::Command;
use std::sync::Mutex;
#[cfg(not(debug_assertions))]
use std::time::Duration;

use tauri::Manager;

// 生产模式 sidecar（Next standalone server）PID，应用退出时回收
#[cfg(not(debug_assertions))]
static SIDECAR_PID: Mutex<Option<u32>> = Mutex::new(None);

/// 应用级状态：由 launcher 通过环境变量传入项目根目录，
/// 启动页调用 get_launch_status / navigate_to_app 时使用。
struct AppState {
  project_root: Mutex<String>,
  app_url: Mutex<String>,
}

impl AppState {
  fn new(project_root: String, app_url: String) -> Self {
    Self {
      project_root: Mutex::new(project_root),
      app_url: Mutex::new(app_url),
    }
  }

  fn project_root(&self) -> String {
    self.project_root.lock().unwrap().clone()
  }

  fn app_url(&self) -> String {
    self.app_url.lock().unwrap().clone()
  }

  fn set_app_url(&self, url: String) {
    *self.app_url.lock().unwrap() = url;
  }
}

/// 从项目根目录读取 launcher 写入的启动状态文件 run/launch-status.json。
#[tauri::command]
fn get_launch_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
  let root = state.project_root();
  if root.is_empty() {
    return Err("COMFYAPP_PROJECT_ROOT not set".to_string());
  }
  let path = std::path::Path::new(&root).join("run").join("launch-status.json");
  match std::fs::read_to_string(&path) {
    Ok(text) => Ok(text),
    Err(e) => Err(format!("无法读取启动状态文件：{} ({})", path.display(), e)),
  }
}

/// 启动页检测到 ready 后，让 Rust 侧把主窗口导航到真正的应用 URL。
/// 这比前端直接 window.location 更可靠，可跨越 tauri:// 与 http:// 协议边界。
#[tauri::command]
fn navigate_to_app(state: tauri::State<'_, AppState>, app_handle: tauri::AppHandle) -> Result<(), String> {
  let url = state.app_url();
  let parsed: tauri::Url = url.parse().map_err(|e| format!("非法 URL {}: {}", url, e))?;
  if let Some(win) = app_handle.get_webview_window("main") {
    win
      .navigate(parsed)
      .map_err(|e| format!("导航失败: {:?}", e))?;
    Ok(())
  } else {
    Err("找不到主窗口 main".to_string())
  }
}

/// 生产模式：挑一个空闲端口给 standalone server（避开固定端口冲突）
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

  // 更新应用 URL，供启动页 ready 后导航
  let app_url = format!("http://127.0.0.1:{}/workspace", port);
  if let Some(state) = app.try_state::<AppState>() {
    state.set_app_url(app_url.clone());
  }

  // 后台轮询端口就绪后，把主窗口导航到本地服务（窗口先显示 splash.html 加载页）
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

/// 尝试从 launcher 传入的环境变量读取项目根目录；
/// 失败则回退到当前 exe 所在目录。
fn resolve_project_root() -> String {
  if let Ok(root) = std::env::var("COMFYAPP_PROJECT_ROOT") {
    if std::path::Path::new(&root).join("scripts").join("dev-launcher.ps1").exists() {
      return root;
    }
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      let dir = dir.to_string_lossy().to_string();
      if std::path::Path::new(&dir).join("scripts").join("dev-launcher.ps1").exists() {
        return dir;
      }
    }
  }
  String::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let project_root = resolve_project_root();
  // 开发模式默认跳本地 Next.js dev server；可由 launcher 通过环境变量注入。
  // 生产模式在 spawn_sidecar 中更新为实际 sidecar 端口。
  let app_url = std::env::var("COMFYAPP_DEV_URL")
    .unwrap_or_else(|_| "http://localhost:3000/workspace".to_string());

  let app = tauri::Builder::default()
    .manage(AppState::new(project_root, app_url))
    .invoke_handler(tauri::generate_handler![get_launch_status, navigate_to_app])
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
