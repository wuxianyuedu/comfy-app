use std::net::TcpStream;
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
#[cfg(not(debug_assertions))]
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, Wry};

// ── 官方 first-party 插件 ──
use tauri_plugin_process;
use tauri_plugin_single_instance as single_instance;
use tauri_plugin_window_state::StateFlags as WindowStateFlags;

// 生产模式 sidecar（Next standalone server）PID，应用退出时回收
#[cfg(not(debug_assertions))]
static SIDECAR_PID: Mutex<Option<u32>> = Mutex::new(None);

/// 应用级状态：由 launcher 通过环境变量传入项目根目录，
/// 启动页调用 get_launch_status / navigate_to_app 时使用。
struct AppState {
  project_root: Mutex<String>,
  app_url: Mutex<String>,
  /// 应用窗口是否已显示过。启动期 main 一直隐藏待命，只有首次显示才需要
  /// 「不抢前台」处理（见 show_main_window_without_focus）。
  shown: Mutex<bool>,
  /// 是否允许把应用窗口顶到前台。默认 false：启动耗时期间用户可能已切到
  /// 别的窗口，加载完成后突然抢焦点会把正在看的内容打断。由启动器按
  /// COMFYAPP_FOREGROUND 控制；应用已在前台 / 用户主动唤起时不改配置直接放行。
  foreground: Mutex<bool>,
  /// 已按「不抢前台」方式显示过但用户还没看过的应用窗口，供托盘「打开主界面」
  /// 时清掉闪烁提醒。
  attention: Mutex<bool>,
}

impl AppState {
  fn new(project_root: String, app_url: String, foreground: bool) -> Self {
    Self {
      project_root: Mutex::new(project_root),
      app_url: Mutex::new(app_url),
      shown: Mutex::new(false),
      foreground: Mutex::new(foreground),
      attention: Mutex::new(false),
    }
  }

  fn foreground(&self) -> bool {
    *self.foreground.lock().unwrap()
  }

  /// 标记应用窗口已显示过并返回「本次是否为首次显示」。
  fn mark_shown(&self) -> bool {
    let mut shown = self.shown.lock().unwrap();
    let first = !*shown;
    *shown = true;
    first
  }

  fn set_attention(&self, value: bool) {
    *self.attention.lock().unwrap() = value;
  }

  fn take_attention(&self) -> bool {
    let mut a = self.attention.lock().unwrap();
    let had = *a;
    *a = false;
    had
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

/// 默认开发 URL：优先读 COMFYAPP_PORT 环境变量（默认 3100），
/// 与 .env 的 COMFYAPP_PORT、启动器 -p 参数保持一致，避免端口冲突时壳仍跳 3100。
fn default_dev_url(host: &str) -> String {
  let port = std::env::var("COMFYAPP_PORT").unwrap_or_else(|_| "3100".to_string());
  format!("http://{}:{}/workspace", host, port)
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
  log::info!("[ComfyAPP] navigate_to_app called with url: {}", url);
  let parsed: tauri::Url = url.parse().map_err(|e| format!("非法 URL {}: {}", url, e))?;
  if let Some(win) = app_handle.get_webview_window("main") {
    win
      .navigate(parsed)
      .map_err(|e| format!("导航失败: {:?}", e))?;
    log::info!("[ComfyAPP] navigate_to_app: navigation dispatched");
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
      show_main_window_without_focus(&monitor, false);
      if let Some(s) = monitor.get_webview_window("splash") {
        let _ = s.close();
      }
    }
  });
  Ok(())
}

/// 让已显示的应用窗口回到前台并清掉任务栏提醒。
///
/// 用户显式唤起（托盘「打开主界面」、二次启动）时调用——这类场景不适用
/// 「不打断」策略：用户就是想看它。
#[tauri::command]
fn activate_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
  show_main_window_without_focus(&app_handle, true);
  Ok(())
}

/// 供前端在挂载时询问「应用窗口是否应自动给前台」。
///
/// 判据在壳进程里（`COMFYAPP_FOREGROUND`，由启动器按「前台本来就是本应用 /
/// 用户刚点了启动」注入，见 scripts/start_tauri_launcher.py 的
/// decide_foreground）。放在 Rust 侧而不是前端读 env，是因为只有服务端渲染
/// 阶段能拿到非 `NEXT_PUBLIC_` 前缀的变量，客户端读不到会一律降级成「不给前台」。
#[tauri::command]
fn should_activate_on_launch(state: tauri::State<'_, AppState>) -> bool {
  state.foreground()
}

/// 供启动页读取当前应用目标 URL，用于自主探测后端是否就绪。
#[tauri::command]
fn get_app_url(state: tauri::State<'_, AppState>) -> String {
  state.app_url()
}

/// 把应用窗口（main）显示出来，并按需避免抢前台。
///
/// 启动期用户可能已切到别的窗口（切出去干别的了），此时应用加载完成若是照直
/// `show()` + `set_focus()`，Windows 会把窗口直接顶到最前面——正在看的内容被
/// 打断。默认策略改为「只显示、不激活」：窗口出现在任务栏，同时请求一次任务栏
/// 闪烁提醒（request_user_attention），用户处理完手上的事自己点开。
///
/// 只有下面两种情况给前台，其余一律「只显示」：
/// 1. `request_focus`——调用方的显式意图（托盘「打开主界面」、二次启动的单实例
///    回调），这类场景用户就是想看它；
/// 2. `AppState.foreground`——启动器经 `COMFYAPP_FOREGROUND` 注入，判据是
///    「前台本来就是本应用 / 用户刚点的启动 / 用户再次唤起运行中的实例」
///    （见 scripts/start_tauri_launcher.py 的 decide_foreground）。
///
/// **不再无条件调 `set_focus()` 试探**（ISSUE #359 回归的直接原因）：启动页窗口带
/// `WS_EX_TOOLWINDOW`，交接时它被关闭、主窗的任务栏按钮重建，Windows 把主窗当成
/// 「新窗口」并**自己放行前台**——于是 `set_focus()` 必成功，用户的「别打断我」策略
/// 被架空，表现为「构建后启动仍然抢前台」。前台归属的最终裁定交给启动器的交接
/// 复核进程（scripts/win32-window-focus.py：它知道用户是否就在等这个应用，
/// 也拿得到双击启动所赋予的输入权，能把不该给的前台收回去）。
fn show_main_window_without_focus(app: &tauri::AppHandle, request_focus: bool) {
  let Some(win) = app.get_webview_window("main") else {
    return;
  };
  let state = app.try_state::<AppState>();
  let first_show = state.as_ref().map(|s| s.mark_shown()).unwrap_or(false);
  let configured = state.as_ref().map(|s| s.foreground()).unwrap_or(false);
  let activate = request_focus || configured;

  if let Err(e) = win.show() {
    log::warn!("[ComfyAPP] show main window failed: {:?}", e);
  }
  // 显示动作本身会不会把前台带过来由系统决定（交接瞬间 Windows 当真当「新窗口」
  // 放行）。这里只把结论记下来，交给启动器的交接复核进程把不该给的前台还回去。
  let focused_after_show = win.is_focused().unwrap_or(false);
  let keep_attention = !activate && !focused_after_show;
  if let Some(s) = state.as_ref() {
    s.set_attention(keep_attention);
  }

  if activate {
    // 用户主动唤起 / 启动器判定用户就在等它：必须把前台拿到手——系统可能因
    // 前台锁定（用户在别的窗口上刚有点击）拦下 set_focus，未获前台时补一次
    // 任务栏闪烁，用户才不至于「点了没反应」。
    let _ = win.set_focus();
    if !win.is_focused().unwrap_or(false) {
      log::warn!(
        "[ComfyAPP] main window shown, foreground request not granted (request={} configured={})",
        request_focus,
        configured
      );
      if let Some(s) = state.as_ref() {
        s.set_attention(true);
      }
      let _ = win.request_user_attention(Some(tauri::UserAttentionType::Informational));
    } else {
      log::info!(
        "[ComfyAPP] main window shown with focus (request={} configured={} first={})",
        request_focus,
        configured,
        first_show
      );
    }
    return;
  }

  log::info!(
    "[ComfyAPP] main window shown without stealing focus (focused_after_show={} first={})",
    focused_after_show,
    first_show
  );
  // 不抢前台：让任务栏按钮持续闪烁到用户点开，作为「加载好了」的提示。
  if keep_attention {
    match win.request_user_attention(Some(tauri::UserAttentionType::Informational)) {
      Ok(()) => log::info!("[ComfyAPP] taskbar attention requested"),
      Err(e) => log::warn!("[ComfyAPP] request_user_attention failed: {:?}", e),
    }
  }
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
    log::warn!("[ComfyAPP] 应用地址在交换窗口时不可达，进入重导航循环：{}", url);
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
/// log/launcher/dev-launcher-current.txt 指向的真实文件为准；附带 stderr 尾部，
/// 启动卡住时用户能直接在启动页看到「执行到哪一步 / 卡在哪里」。
#[tauri::command]
fn get_launch_log(state: tauri::State<'_, AppState>) -> Result<String, String> {
  let root = state.project_root();
  if root.is_empty() {
    return Err("COMFYAPP_PROJECT_ROOT not set".to_string());
  }
  let log_dir = std::path::Path::new(&root).join("log").join("launcher");
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
  // 壳自持日志（release 落 log/shell/shell.log；dev 由 launcher 重定向 stderr，
  // 不产生此文件）。启动期壳的导航/看门狗/侧车诊断都经 log:: 打到这份文件，
  // 正式版壳脱离 launcher（standalone 双击）崩溃时仍有可查日志。
  let shell_log = std::path::Path::new(&root).join("log").join("shell").join("shell.log");
  if let Some(tail) = tail_log_file(&shell_log, 8 * 1024, 120) {
    if !tail.trim().is_empty() {
      sections.push(format!("─ 壳日志（log/shell/shell.log）─\n{}", tail));
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
      log::warn!("[ComfyAPP] standalone server.js 缺失，回退到 dev URL: {}", dev_url);
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
      log::warn!("[ComfyAPP] 应用地址非法 {}：{}", url, e);
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
        }
        // 启动页（splash）不可用，无窗口可交换：直接显示「应用」窗口并关闭黑屏 splash
        show_main_window_without_focus(&handle, false);
        if let Some(splash) = handle.get_webview_window("splash") {
          let _ = splash.close();
        }
        return;
      }
      std::thread::sleep(Duration::from_millis(500));
    }
    log::warn!("[ComfyAPP] 等待应用地址就绪超时：{}", url);
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

/// 日志插件：开发模式走 stdout（launcher 已把 stderr 重定向进
/// log/launcher/dev-launcher-stderr.log）；生产模式额外落一份壳自持日志到
/// <项目根>/log/shell/（standalone 双击无 launcher 重定向时的兜底落盘，见
/// launch-and-build.md §4 日志布局：按子系统分区，新增 shell 子系统）。
#[cfg(not(debug_assertions))]
fn build_log_plugin(project_root: &str) -> tauri::plugin::TauriPlugin<Wry> {
  // 保留 stdout/stderr：launcher 下壳 stderr 被重定向进 dev-launcher-stderr.log；
  // release（windows_subsystem）下无控制台，写 stderr 无害。生产模式另落一份
  // 壳自持日志到 <项目根>/log/shell/shell.log——standalone 双击无 launcher 重定向，
  // 壳若在 launcher 之外崩溃仍有日志可查（launch-and-build.md §4：按子系统分区）。
  // 插件自带 KeepOne 轮转，避免文件无限增长。
  let mut targets = vec![
    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
  ];
  if !project_root.is_empty() {
    let shell_log_dir = std::path::Path::new(project_root).join("log").join("shell");
    targets.push(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
      path: shell_log_dir,
      file_name: Some("shell.log".to_string()),
    }));
  }
  tauri_plugin_log::Builder::new()
    .level(log::LevelFilter::Info)
    .targets(targets)
    .build()
}

#[cfg(debug_assertions)]
fn build_log_plugin(_project_root: &str) -> tauri::plugin::TauriPlugin<Wry> {
  // dev 模式：壳日志由 launcher 把 stderr 重定向进 log/launcher/，无需壳自持文件。
  tauri_plugin_log::Builder::new()
    .level(log::LevelFilter::Info)
    .targets([
      tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
      tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
    ])
    .build()
}

/// 窗口状态持久化：记忆 main / comfyui 窗口的位置、尺寸与最大化，重启后还原。
/// 刻意排除 VISIBLE——本壳的 main 窗由「启动页 → 导航 → 交换」流程控制显隐，
/// 交给插件自动 show 会破坏隐藏待命语义（见 run() 里对 main 的 visible(false)）。
/// splash 只做进度展示，无记忆需求，deny 掉。
fn build_window_state_plugin() -> tauri::plugin::TauriPlugin<Wry> {
  tauri_plugin_window_state::Builder::default()
    .with_denylist(&["splash"])
    .with_state_flags(
      WindowStateFlags::SIZE | WindowStateFlags::POSITION | WindowStateFlags::MAXIMIZED,
    )
    .build()
}

/// 壳层单实例保护：launcher（CreateMutexW）只保护「双击启动」这一层；当
/// app.exe 被直接拉起（standalone 双击、launcher 已退而壳还活着）时仍可能
/// 叠加窗口。把单实例下沉到壳进程，二次实例由插件杀掉并在回调里把主窗口带到前台。
fn build_single_instance_plugin() -> tauri::plugin::TauriPlugin<Wry> {
  single_instance::init(|app, _args, _cwd| {
    // 应用仍在启动期（splash 还开着、main 尚未交换）时不做前台抢占，
    // 否则会把尚在 about:blank 的隐藏主窗顶出来，破坏启动页流程。
    // 二次启动是用户显式意图，直接给前台（这不会「打断」——用户刚点了启动）。
    if app.get_webview_window("splash").is_none() {
      show_main_window_without_focus(app, true);
    }
  })
}

/// 托盘图标 id（应用退出时用同一 id 查回托盘对象）。
const TRAY_ID: &str = "comfyapp-tray";

/// 系统托盘：应用以「不抢前台」方式显示时，用户从任务栏点开过就不需要它，
/// 但「启动完成后窗口在任务栏、用户又切走了」这类场景需要一个稳定的唤起入口，
/// 因此常驻一个最小托盘——左键单击把主窗口带回前台，右键给出显示/退出。
/// 托盘是窗口的附属入口，不改变窗口关闭语义（关主窗即退出应用）。
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
  use tauri::menu::{Menu, MenuItem};
  use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

  let open_item = MenuItem::with_id(app, "open-main", "打开主界面", true, None::<&str>)?;
  let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

  TrayIconBuilder::with_id(TRAY_ID)
    .icon(app.default_window_icon().unwrap().clone())
    .tooltip("Comfy APP")
    .menu(&menu)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id().as_ref() {
      "open-main" => show_main_window_without_focus(app, true),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      // 只响应「单击左键后抬起」：双击会先产生一次单击，重复唤起无副作用。
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        show_main_window_without_focus(tray.app_handle(), true);
      }
    })
    .build(app)?;
  log::info!("[ComfyAPP] tray icon created");
  Ok(())
}

/// 启动页窗口的兜底尺寸，与 tauri.conf.json 的 splash 窗口几何保持一致
/// （配置是编译期内嵌的静态值，这里只在「屏幕装不下」时需要再收一次）。
const SPLASH_WINDOW_SIZE: (f64, f64) = (1680.0, 1000.0);

/// 启动页窗口尺寸：优先用配置值，但**不得超过当前显示器可用区域**。
///
/// 为什么需要这一步：启动页的日志面板是「一行一条日志」的不折行布局
/// （`white-space: pre` + 横向滚动），窗口越宽越能一次读全一行——因此窗口
/// 尺寸给得比内容卡片大得多。但固定值在小屏（1366×768 笔记本、
/// 1920×1080 开了 150% 缩放）上会超出屏幕：窗口被系统推到屏幕外，用户看到
/// 的是「启动页缺了一角」。这里按显示器取一次上限（宽高各留 48px 边距，
/// 与页面自身的 `100vw - 48px` 约束同口径），窗口尺寸于是「大屏大、
/// 小屏不越界」，尺寸不够时由页面内的 `min(..., 100vw - 48px)` 继续收。
fn splash_window_size(app: &tauri::AppHandle) -> (f64, f64) {
  let (mut width, mut height) = SPLASH_WINDOW_SIZE;
  let Ok(Some(monitor)) = app.primary_monitor() else {
    log::warn!("[ComfyAPP] primary monitor unavailable, keeping default splash size");
    return (width, height);
  };
  let scale = monitor.scale_factor();
  let available = monitor.size().to_logical::<f64>(scale);
  let max_width = (available.width - 48.0).max(640.0);
  let max_height = (available.height - 48.0).max(480.0);
  if width > max_width || height > max_height {
    log::info!(
      "[ComfyAPP] splash window clamped to monitor: {:.0}x{:.0} (available {:.0}x{:.0})",
      width.min(max_width),
      height.min(max_height),
      available.width,
      available.height
    );
  }
  width = width.min(max_width);
  height = height.min(max_height);
  (width, height)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let project_root = resolve_project_root();
  // 开发模式默认跳本地 Next.js dev server；可由 launcher 通过环境变量注入。
  // 生产模式在 spawn_sidecar 中更新为实际 sidecar 端口。
  let app_url = std::env::var("COMFYAPP_DEV_URL")
    .unwrap_or_else(|_| default_dev_url("localhost"));

  let log_plugin = build_log_plugin(&project_root);

  // 是否允许启动完成时把应用窗口顶到前台。默认 false（不打断用户正在看的
  // 内容）；启动器在「前台本来就是本应用 / 用户主动唤起 / 冷启动」等场景注入
  // COMFYAPP_FOREGROUND=1 覆盖（判据见 scripts/start_tauri_launcher.py 的
  // decide_foreground 与 docs/standards/launch-and-build.md §1.3）。
  let foreground = std::env::var("COMFYAPP_FOREGROUND")
    .map(|raw| {
      let value = raw.trim().to_ascii_lowercase();
      value == "1" || value == "true" || value == "yes"
    })
    .unwrap_or(false);

  let app = tauri::Builder::default()
    .plugin(build_window_state_plugin())
    .plugin(build_single_instance_plugin())
    .plugin(log_plugin)
    // 应用自更新：设置页「检测更新 / 更新并重启」入口（见 app-update-client.ts）。
    // 更新源与签名公钥在 tauri.conf.json 的 plugins.updater 配置；无有效端点时
    // check() 会返回无更新，前端据此降级提示。
    .plugin(tauri_plugin_updater::Builder::new().build())
    // 进程重启：更新安装完成后调 relaunch 使新版本生效；也供「重启应用」按钮用。
    .plugin(tauri_plugin_process::init())
    .manage(AppState::new(project_root, app_url, foreground))
    .invoke_handler(tauri::generate_handler![
      get_launch_status,
      navigate_to_app,
      get_app_url,
      get_launch_log,
      open_comfyui_window,
      activate_main_window,
      should_activate_on_launch
    ])
    .setup(|app| {
      // ── 方向 B：启动页与「应用」窗口分离 ──
      // 配置里的 splash 窗口（label="splash"）仅显示启动进度，可见。
      // 真正的应用窗口（label="main"）在此创建为隐藏窗口，先停在 about:blank，
      // 由启动页探测后端就绪后调用 navigate_to_app 导航到应用 URL；main 页面真正
      // 加载完成（on_page_load Finished）时再交换窗口：显示 main、关闭 splash。
      // 这样启动页会一直显示到应用首屏真正可见，不再出现「启动完成却还要等很久」。
      // 启动页窗口尺寸按当前显示器收一次（见 splash_window_size）：配置值给得宽，
      // 为的是让日志面板的单行日志尽量不被折成两截；屏幕装不下时再收回来。
      if let Some(splash) = app.get_webview_window("splash") {
        let (width, height) = splash_window_size(app.handle());
        let _ = splash.set_size(tauri::LogicalSize::new(width, height));
        let _ = splash.center();
      }

      let main_url: tauri::Url = "about:blank"
        .parse()
        .unwrap_or_else(|_| tauri::Url::parse(&default_dev_url("127.0.0.1")).unwrap());
      let app_handle_for_page = app.handle().clone();
      let _main_win = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(main_url))
        .title("Comfy APP")
        .inner_size(1280.0, 800.0)
        .min_inner_size(1024.0, 700.0)
        .center()
        .resizable(true)
        .fullscreen(false)
        // 关闭原生装饰：标题行由前端 ShellTabs / TitleBarTabs 接管，页签直接
        // 显示在标题行（ISSUE #310 / #200），不再额外占用应用内区域。拖拽与
        // 最小化/最大化/关闭由 window-controls-client 调 Tauri window API 补齐，
        // 对应权限见 capabilities/{default,remote}.json。
        .decorations(false)
        .visible(false)
        .on_page_load(move |_win, payload| {
          if payload.event() == tauri::webview::PageLoadEvent::Finished {
            let url = payload.url().as_str();
            log::info!("[ComfyAPP] main window Finished: {}", url);
            // 忽略初始 about:blank / 空 URL / 内部错误页，只有在真正导航到应用 URL（http/https）
            // 后才交换窗口，避免主窗口提前显示在黑屏的 about:blank 上。
            if url.is_empty()
              || url.starts_with("about:blank")
              || url.starts_with("tauri://")
              || url.starts_with("https://tauri.localhost")
              || (!url.starts_with("http://") && !url.starts_with("https://"))
            {
              log::debug!("[ComfyAPP] ignoring initial/non-app page load");
              return;
            }
            log::info!("[ComfyAPP] app page loaded, swapping windows");
            // 导航失败（连接被拒/服务又挂掉）时 WebView2 也会以 http URL 触发
            // Finished，页面内容是内嵌的 Edge「无法访问此页面」错误页——历史上
            // 它曾被当成「应用加载完成」直接顶给用户。交换前用 TCP 可达性做
            // 二次校验：不可达就不交换，交给重导航循环，保持启动页可见。
            if !url_reachable(payload.url()) {
              log::warn!("[ComfyAPP] swap aborted, app url unreachable: {}", url);
              spawn_renavigate(app_handle_for_page.clone(), payload.url().clone());
              return;
            }
            // 启动期可能已过了几十秒，用户很可能切到了别的窗口：这里只把应用
            // 显示到任务栏并做闪烁提醒，不把窗口顶到前台（见函数注释）。
            show_main_window_without_focus(&app_handle_for_page, false);
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
            log::warn!("[ComfyAPP] splash watchdog: base url not seen in 5s, giving up");
            return;
          };
          log::info!("[ComfyAPP] splash watchdog: base url {}", splash_url);
          for _ in 0..300 {
            std::thread::sleep(Duration::from_millis(1000));
            let Some(s) = handle.get_webview_window("splash") else { return };
            let drifted = match s.url() {
              Ok(u) => u != splash_url,
              Err(_) => false,
            };
            if drifted {
              let cur = s.url().map(|u| u.to_string()).unwrap_or_default();
              log::warn!("[ComfyAPP] splash watchdog: url drifted to {}, restoring", cur);
              let _ = s.navigate(splash_url.clone());
            }
          }
        });
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
          log::info!(
            "[ComfyAPP] launch mode={:?}，跳过 standalone sidecar，使用 dev URL",
            launch_mode
          );
        }

        // 启动页资源缺失兜底（详见 navigate_when_ready 注释）：
        // 老版本 app.exe 未嵌入 splash.html，窗口会 404 黑屏且无法自动跳转，
        // 这里检测不到启动页就直接等应用地址就绪后导航，避免永久黑屏。
        let has_splash = app.asset_resolver().get("splash.html".to_string()).is_some();
        log::info!("[ComfyAPP] splash.html embedded: {}", has_splash);
        if !has_splash {
          if let Some(state) = app.try_state::<AppState>() {
            let url = state.app_url();
            if !url.is_empty() {
              log::warn!("[ComfyAPP] splash.html 未嵌入，启动页不可用，就绪后直接导航到 {}", url);
              navigate_when_ready(app.handle().clone(), url);
            }
          }
        }
      }
      // 托盘是「窗口只在任务栏、用户又切走了」时的兜底唤起入口：创建失败
      // （缺图标资源 / 系统限制）只记 WARN，绝不能让整个应用起不来。
      if let Err(e) = build_tray(app.handle()) {
        log::warn!("[ComfyAPP] tray icon not created: {:?}", e);
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app, event| match event {
    tauri::RunEvent::Exit => {
      #[cfg(not(debug_assertions))]
      kill_sidecar();
    }
    tauri::RunEvent::ExitRequested { code, .. } => {
      // 关窗即退出（不做「最小化到托盘」）。用户若在窗口只显示到任务栏、还没点开
      // 的情况下直接退出，留一条日志，便于对照「双击了却没看到界面」的反馈。
      if code.is_none() {
        if let Some(state) = app.try_state::<AppState>() {
          if state.take_attention() {
            log::info!(
              "[ComfyAPP] exiting while the window was only shown in the taskbar (never opened by the user)"
            );
          }
        }
      }
    }
    _ => {}
  });
}
