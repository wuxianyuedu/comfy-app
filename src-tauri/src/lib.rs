use std::net::TcpStream;
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::process::Command;
use std::sync::Mutex;
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

/// 启动页检测到 ready 后，让 Rust 侧把「应用」窗口（main，隐藏）导航到真正的应用 URL。
/// 启动页（splash）保持可见，直到 main 的页面真正加载完成（on_page_load Finished）才交换窗口。
/// 这比前端直接 window.location 更可靠，可跨越 tauri:// 与 http:// 协议边界。
#[tauri::command]
fn navigate_to_app(state: tauri::State<'_, AppState>, app_handle: tauri::AppHandle) -> Result<(), String> {
  let url = state.app_url();
  eprintln!("[ComfyAPP] navigate_to_app called with url: {}", url);
  let parsed: tauri::Url = url.parse().map_err(|e| format!("非法 URL {}: {}", url, e))?;
  if let Some(win) = app_handle.get_webview_window("main") {
    win
      .navigate(parsed)
      .map_err(|e| format!("导航失败: {:?}", e))?;
    eprintln!("[ComfyAPP] navigate_to_app: navigation dispatched");
  } else {
    return Err("找不到应用窗口 main".to_string());
  }

  // 安全网：若 150s 内「应用」窗口仍未就绪（on_page_load 未触发，极端情况下后端可响应
  // 但页面一直加载不出），强制显示主窗口并关闭启动页，避免用户永久卡在启动页。
  let monitor = app_handle.clone();
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_secs(150));
    let splash_open = monitor.get_webview_window("splash").is_some();
    let main_hidden = match monitor.get_webview_window("main") {
      Some(m) => !m.is_visible().unwrap_or(false),
      None => false,
    };
    if splash_open && main_hidden {
      if let Some(m) = monitor.get_webview_window("main") {
        let _ = m.show();
        let _ = m.set_focus();
      }
      if let Some(s) = monitor.get_webview_window("splash") {
        let _ = s.close();
      }
    }
  });
  Ok(())
}

/// 供启动页读取当前应用目标 URL，用于自主探测后端是否就绪。
#[tauri::command]
fn get_app_url(state: tauri::State<'_, AppState>) -> String {
  state.app_url()
}

/// 桌面壳内打开 ComfyUI：把运行中的 ComfyUI 网页界面放进 Tauri 壳的独立
/// 窗口（label="comfyui"）里打开，而不是拉起系统浏览器——相当于一个常驻的
/// 「壳内子页签」。已有该窗口则聚焦，地址变化（重启后端口偏移）时重新导航；
/// 否则新建。仅当检测到运行在 Tauri 壳内时前端才调用本命令；浏览器 / dev
/// 模式继续走 Node 端 openUrlInBrowser（见 open-in-browser.ts）。
#[tauri::command]
fn open_comfyui_window(app: tauri::AppHandle, url: String) -> Result<String, String> {
  let parsed: tauri::Url = url
    .parse()
    .map_err(|_| format!("非法 ComfyUI 地址：{}", url))?;
  if !matches!(parsed.scheme(), "http" | "https") {
    return Err(format!("仅支持 http(s) 地址：{}", url));
  }
  // 已有窗口：聚焦；目标地址变化则重新导航（重启可能换端口）。
  if let Some(win) = app.get_webview_window("comfyui") {
    let current = win.url().map(|u| u.to_string()).unwrap_or_default();
    if current != url {
      let _ = win.navigate(parsed.clone());
    }
    let _ = win.show();
    let _ = win.set_focus();
    return Ok(format!("已在壳内打开 ComfyUI（{}）", url));
  }
  tauri::WebviewWindowBuilder::new(&app, "comfyui", tauri::WebviewUrl::External(parsed))
    .title("ComfyUI")
    .inner_size(1280.0, 800.0)
    .min_inner_size(900.0, 600.0)
    .center()
    .resizable(true)
    .build()
    .map_err(|e| format!("打开 ComfyUI 窗口失败：{:?}", e))?;
  Ok(format!("已在壳内打开 ComfyUI（{}）", url))
}

/// 目标 URL 的 host:port 当前能否建立 TCP 连接。
/// 交换窗口前的二次校验依据：WebView2 对「导航失败」（连接被拒/超时）同样会
/// 触发 on_page_load(Finished)，页面内嵌 Edge 错误页且 URL 仍是 http://，
/// 单看事件参数无法区分加载成功与否，必须实际探测端口。
fn url_reachable(url: &tauri::Url) -> bool {
  let Some(host) = url.host_str() else {
    return false;
  };
  if host.is_empty() {
    return false;
  }
  match url.port_or_known_default() {
    Some(port) => TcpStream::connect((host, port)).is_ok(),
    None => false,
  }
}

/// main 窗口加载到错误页后的重导航循环：每 2s 探测一次应用地址，恢复可达后
/// 重新导航；最多约 3 分钟（覆盖 150s 安全网）。RENAVIGATING 防止多次
/// Finished 事件触发重复循环。
static RENAVIGATING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn spawn_renavigate(handle: tauri::AppHandle, url: tauri::Url) {
  use std::sync::atomic::Ordering;
  if RENAVIGATING.swap(true, Ordering::SeqCst) {
    return;
  }
  std::thread::spawn(move || {
    eprintln!("[ComfyAPP] 应用地址在交换窗口时不可达，进入重导航循环：{}", url);
    for _ in 0..90 {
      std::thread::sleep(Duration::from_secs(2));
      // 启动页已关闭（安全网强制交换 / 用户退出）则无需再重试
      if handle.get_webview_window("splash").is_none() {
        break;
      }
      if url_reachable(&url) {
        if let Some(m) = handle.get_webview_window("main") {
          let _ = m.navigate(url.clone());
          break;
        }
      }
    }
    RENAVIGATING.store(false, Ordering::SeqCst);
  });
}

/// 去掉 ANSI 转义序列（ESC + 参数字节 + 字母终止符），PowerShell 日志里
/// 可能写入颜色码，启动页日志面板只应显示纯文本。
fn strip_ansi(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  let mut chars = text.chars();
  while let Some(c) = chars.next() {
    if c == '\u{1b}' {
      for nc in chars.by_ref() {
        if nc.is_ascii_alphabetic() {
          break;
        }
      }
    } else {
      out.push(c);
    }
  }
  out
}

/// 读取日志文件尾部：max_bytes 截断 + max_lines 限行，去 ANSI，失败返回 None。
fn tail_log_file(path: &std::path::Path, max_bytes: usize, max_lines: usize) -> Option<String> {
  let data = std::fs::read(path).ok()?;
  if data.is_empty() {
    return Some(String::new());
  }
  let start = data.len().saturating_sub(max_bytes);
  let text = String::from_utf8_lossy(&data[start..]);
  let plain = strip_ansi(&text);
  let mut lines: Vec<&str> = plain
    .lines()
    .map(str::trim_end)
    // PowerShell Transcript 会把每秒一次的健康检查超时原样灌进日志
    //（PS>TerminatingError(...)），对「执行到哪一步」毫无信息量，直接滤掉
    .filter(|l| !l.starts_with("PS>TerminatingError"))
    .collect();
  if start > 0 && !lines.is_empty() {
    lines.remove(0); // 丢弃被截断的不完整首行
  }
  if lines.len() > max_lines {
    lines = lines[lines.len() - max_lines..].to_vec();
  }
  Some(lines.join("\n"))
}

/// 启动页「查看日志」面板的数据源：返回本次启动的编排日志尾部。
/// dev-launcher.ps1 的日志在文件被占用时会回退改名，以 sentinel
/// log/dev-launcher-current.txt 指向的真实文件为准；附带 stderr 尾部，
/// 启动卡住时用户能直接在启动页看到「执行到哪一步 / 卡在哪里」。
#[tauri::command]
fn get_launch_log(state: tauri::State<'_, AppState>) -> Result<String, String> {
  let root = state.project_root();
  if root.is_empty() {
    return Err("COMFYAPP_PROJECT_ROOT not set".to_string());
  }
  let log_dir = std::path::Path::new(&root).join("log");
  let mut sections: Vec<String> = Vec::new();

  let dev_log = std::fs::read_to_string(log_dir.join("dev-launcher-current.txt"))
    .ok()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty() && std::path::Path::new(s).is_file())
    .unwrap_or_else(|| log_dir.join("dev-launcher.log").to_string_lossy().into_owned());
  let dev_log_name = std::path::Path::new(&dev_log)
    .file_name()
    .map(|s| s.to_string_lossy().into_owned())
    .unwrap_or_else(|| "dev-launcher.log".to_string());
  if let Some(tail) = tail_log_file(std::path::Path::new(&dev_log), 16 * 1024, 160) {
    if !tail.trim().is_empty() {
      sections.push(format!("─ 启动编排日志（{}）─\n{}", dev_log_name, tail));
    }
  }
  if let Some(tail) = tail_log_file(&log_dir.join("dev-launcher-stderr.log"), 4 * 1024, 60) {
    if !tail.trim().is_empty() {
      sections.push(format!("─ 错误输出（dev-launcher-stderr.log）─\n{}", tail));
    }
  }
  if sections.is_empty() {
    return Ok("（暂无日志：启动器尚未写入输出）".to_string());
  }
  Ok(sections.join("\n\n"))
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

  let launch_mode = std::env::var("COMFYAPP_LAUNCH_MODE").unwrap_or_default();
  if !server.exists() {
    if launch_mode == "standalone" {
      // 显式 standalone 模式但资源缺失：必须报错，禁止悄悄回退 dev——
      // 否则「双击 start-tauri-standalone.exe 却跑成 dev」会产生歧义行为。
      return Err(format!(
        "standalone 模式但 server.js 不存在：{:?}。请先执行 pnpm tauri build（beforeBuildCommand 会组装 src-tauri/static）",
        server
      )
      .into());
    }
    // 默认/未显式指定：回退到 dev URL 模式（launcher 的 Prebuilt 分支会单独
    // 启动 Next dev server，壳只需加载 COMFYAPP_DEV_URL 即可），避免「直接
    // cargo build --release（未跑 beforeBuildCommand）」导致壳启动即 panic。
    if let Ok(dev_url) = std::env::var("COMFYAPP_DEV_URL") {
      eprintln!("[ComfyAPP] standalone server.js 缺失，回退到 dev URL: {}", dev_url);
      if let Some(state) = app.try_state::<AppState>() {
        state.set_app_url(dev_url);
      }
      return Ok(());
    }
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

  // 注意：不再在此直接导航「应用」窗口。启动页（splash）会自行探测 sidecar 端口，
  // 就绪后调用 navigate_to_app 命令把隐藏的 main 窗口导航到应用 URL；main 页面真正
  // 加载完成（on_page_load Finished）时再由 setup 中注册的回调交换窗口。这样由启动页
  // 统一编排，避免与启动页的探测重复导航导致应用被加载两次。

  Ok(())
}

/// 启动页兜底：老版本 app.exe 编译时 src-tauri/static 里还没有 splash.html，
/// 窗口加载 tauri://localhost/splash.html 会 404 —— 画面只剩窗口底色（纯黑），
/// 且页面里的 JS 根本不执行，永远不会自动跳转到 dev server，表现为「窗口黑屏」。
/// 检测到资源缺失时改为轮询应用地址，就绪后直接导航，保证用户最终能看到界面。
#[cfg(not(debug_assertions))]
fn navigate_when_ready(handle: tauri::AppHandle, url: String) {
  let parsed = match url.parse::<tauri::Url>() {
    Ok(u) => u,
    Err(e) => {
      eprintln!("[ComfyAPP] 应用地址非法 {}：{}", url, e);
      return;
    }
  };
  let host = parsed.host_str().unwrap_or("127.0.0.1").to_string();
  let port = parsed.port_or_known_default().unwrap_or(80);

  std::thread::spawn(move || {
    for _ in 0..240 {
      if TcpStream::connect((host.as_str(), port)).is_ok() {
        // 端口刚通时 HTTP 未必已能响应，稍等一下再导航
        std::thread::sleep(Duration::from_millis(500));
        if let Some(win) = handle.get_webview_window("main") {
          if let Ok(target) = url.parse::<tauri::Url>() {
            let _ = win.navigate(target);
          }
          // 启动页（splash）不可用，无窗口可交换：直接显示「应用」窗口并关闭黑屏 splash
          let _ = win.show();
          let _ = win.set_focus();
        }
        if let Some(splash) = handle.get_webview_window("splash") {
          let _ = splash.close();
        }
        return;
      }
      std::thread::sleep(Duration::from_millis(500));
    }
    eprintln!("[ComfyAPP] 等待应用地址就绪超时：{}", url);
  });
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
    .invoke_handler(tauri::generate_handler![get_launch_status, navigate_to_app, get_app_url, get_launch_log, open_comfyui_window])
    .setup(|app| {
      // ── 方向 B：启动页与「应用」窗口分离 ──
      // 配置里的 splash 窗口（label="splash"）仅显示启动进度，可见。
      // 真正的应用窗口（label="main"）在此创建为隐藏窗口，先停在 about:blank，
      // 由启动页探测后端就绪后调用 navigate_to_app 导航到应用 URL；main 页面真正
      // 加载完成（on_page_load Finished）时再交换窗口：显示 main、关闭 splash。
      // 这样启动页会一直显示到应用首屏真正可见，不再出现「启动完成却还要等很久」。
      let main_url: tauri::Url = "about:blank"
        .parse()
        .unwrap_or_else(|_| tauri::Url::parse("http://127.0.0.1:3000/workspace").unwrap());
      let app_handle_for_page = app.handle().clone();
      let _main_win = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(main_url))
        .title("Comfy APP")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 700.0)
        .center()
        .resizable(true)
        .fullscreen(false)
        .visible(false)
        .on_page_load(move |_win, payload| {
          if payload.event() == tauri::webview::PageLoadEvent::Finished {
            let url = payload.url().as_str();
            eprintln!("[ComfyAPP] main window Finished: {}", url);
            // 忽略初始 about:blank / 空 URL / 内部错误页，只有在真正导航到应用 URL（http/https）
            // 后才交换窗口，避免主窗口提前显示在黑屏的 about:blank 上。
            if url.is_empty()
              || url.starts_with("about:blank")
              || url.starts_with("tauri://")
              || url.starts_with("https://tauri.localhost")
              || (!url.starts_with("http://") && !url.starts_with("https://"))
            {
              eprintln!("[ComfyAPP] ignoring initial/non-app page load");
              return;
            }
            eprintln!("[ComfyAPP] app page loaded, swapping windows");
            // 导航失败（连接被拒/服务又挂掉）时 WebView2 也会以 http URL 触发
            // Finished，页面内容是内嵌的 Edge「无法访问此页面」错误页——历史上
            // 它曾被当成「应用加载完成」直接顶给用户。交换前用 TCP 可达性做
            // 二次校验：不可达就不交换，交给重导航循环，保持启动页可见。
            if !url_reachable(payload.url()) {
              eprintln!("[ComfyAPP] swap aborted, app url unreachable: {}", url);
              spawn_renavigate(app_handle_for_page.clone(), payload.url().clone());
              return;
            }
            if let Some(m) = app_handle_for_page.get_webview_window("main") {
              let _ = m.show();
              let _ = m.set_focus();
            }
            if let Some(s) = app_handle_for_page.get_webview_window("splash") {
              let _ = s.close();
            }
          }
        })
        .build()?;

      // ── 启动页看门狗（仅 custom-protocol 构建）──
      // custom-protocol 关闭时（tauri dev），tauri 的 cfg(dev) 开启，窗口相对
      // URL 解析到 build.devUrl——启动页由 dev server 提供，那是 dev 模式的预期。
      // custom-protocol 开启时（正式壳，cargo build --release --features
      // custom-protocol），启动页加载编译期内嵌资源；页面一旦被任何导航带走
      // （错误页/其它地址），页内 JS 全部失效，进度/日志界面无法自愈，只能干等
      // main 加载完成后交换窗口。看门狗每秒检查启动页当前 URL，偏离内嵌资源
      // 地址就导航回去，保证进度界面必然恢复。
      #[cfg(feature = "custom-protocol")]
      {
        let handle = app.handle().clone();
        std::thread::spawn(move || {
          // 等启动页创建并拿到基准 URL（= 配置解析出的内嵌资源地址）
          let mut base: Option<tauri::Url> = None;
          for _ in 0..50 {
            match handle.get_webview_window("splash") {
              None => return, // 启动页已关闭（秒就绪），无需看门狗
              Some(s) => {
                if let Ok(u) = s.url() {
                  if u.as_str().ends_with("splash.html") {
                    base = Some(u);
                    break;
                  }
                }
              }
            }
            std::thread::sleep(Duration::from_millis(100));
          }
          let Some(splash_url) = base else {
            eprintln!("[ComfyAPP] splash watchdog: base url not seen in 5s, giving up");
            return;
          };
          eprintln!("[ComfyAPP] splash watchdog: base url {}", splash_url);
          for _ in 0..300 {
            std::thread::sleep(Duration::from_millis(1000));
            let Some(s) = handle.get_webview_window("splash") else { return };
            let drifted = match s.url() {
              Ok(u) => u != splash_url,
              Err(_) => false,
            };
            if drifted {
              let cur = s.url().map(|u| u.to_string()).unwrap_or_default();
              eprintln!("[ComfyAPP] splash watchdog: url drifted to {}, restoring", cur);
              let _ = s.navigate(splash_url.clone());
            }
          }
        });
      }

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
        let launch_mode = std::env::var("COMFYAPP_LAUNCH_MODE").unwrap_or_default();
        if launch_mode == "standalone" {
          // 显式 standalone：必须启动内嵌 server（缺失时 spawn_sidecar 会报错）。
          spawn_sidecar(app.handle())?;
        } else {
          // prebuilt / tauri / 未指定：壳直接加载 COMFYAPP_DEV_URL（由
          // dev-launcher.ps1 起 dev server），不启动 standalone sidecar。
          eprintln!(
            "[ComfyAPP] launch mode={:?}，跳过 standalone sidecar，使用 dev URL",
            launch_mode
          );
        }

        // 启动页资源缺失兜底（详见 navigate_when_ready 注释）：
        // 老版本 app.exe 未嵌入 splash.html，窗口会 404 黑屏且无法自动跳转，
        // 这里检测不到启动页就直接等应用地址就绪后导航，避免永久黑屏。
        let has_splash = app.asset_resolver().get("splash.html".to_string()).is_some();
        eprintln!("[ComfyAPP] splash.html embedded: {}", has_splash);
        if !has_splash {
          if let Some(state) = app.try_state::<AppState>() {
            let url = state.app_url();
            if !url.is_empty() {
              eprintln!("[ComfyAPP] splash.html 未嵌入，启动页不可用，就绪后直接导航到 {}", url);
              navigate_when_ready(app.handle().clone(), url);
            }
          }
        }
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
