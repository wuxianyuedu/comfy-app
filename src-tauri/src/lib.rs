use std::net::TcpStream;
#[cfg(not(debug_assertions))]
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, Wry};

// ── 官方 first-party 插件 ──
use tauri_plugin_process;
use tauri_plugin_window_state::StateFlags as WindowStateFlags;

// 保活服务的「脱离 job 拉起」中介：同一个 exe 的 CLI 形态（见模块头）。
mod detached_spawn;
// 按检出隔离的单实例保护与端口推导（launch-and-build.md §1.4 多检出并行）。
// 该模块自带平台实现（Windows 具名内核对象 / POSIX 锁文件 + SIGUSR1），
// 因此**不需要**在模块声明上做 cfg —— 调用点因此不用按平台分叉。
mod single_instance;
// 壳自编排（「只启动一个 exe」，ISSUE #784）：双击 app.exe 时由壳自己起
// dev-launcher.mjs —— **这是唯一的启动入口形态**（Python 启动器已随本 ISSUE
// 整体移除）。模块自带平台实现（Job Object / 环境块认亲只在 Windows 有），
// 调用点因此不用分叉。
mod shell_launch;

/// 生产模式 sidecar（Next standalone server）句柄，应用退出时回收。
///
/// 用 **tauri-plugin-shell 的 CommandChild** 而不是 `std::process::Command`：
/// 官方的 shell 插件按平台选择解释器（Windows `cmd /C`、POSIX `sh -c`），
/// 且 `kill()` 会连带回收子进程（POSIX 走进程组、Windows 走 Job/任务终止），
/// 这正是「跨平台启动链路」里最不能自己手写的一段（AGENTS 硬规则 3）。
/// 自持 `Command::new` + `taskkill` 的写法在 POSIX 上只剩单杀 leader ——
/// node 之下的 next-server / turbopack worker 会残留成孤儿，继续占端口锁日志。
#[cfg(not(debug_assertions))]
static SIDECAR: Mutex<Option<tauri_plugin_shell::process::CommandChild>> = Mutex::new(None);

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
  /// 用户在启动期关闭了启动页（放弃本次启动）。壳进程随即整体退出；置位是
  /// 为了在退出生效前的瞬间，拦住所有「把隐藏主窗显示出来」的后续路径
  /// （页面加载完成的窗口交接、150s 安全网、就绪兜底导航），避免用户已经
  /// 放弃的启动又把窗口弹出来。
  abandoned: Mutex<bool>,
}

impl AppState {
  fn new(project_root: String, app_url: String, foreground: bool) -> Self {
    Self {
      project_root: Mutex::new(project_root),
      app_url: Mutex::new(app_url),
      shown: Mutex::new(false),
      foreground: Mutex::new(foreground),
      attention: Mutex::new(false),
      abandoned: Mutex::new(false),
    }
  }

  /// 标记「用户已放弃本次启动」并返回标记前的值（幂等：重复关闭启动页只记一次）。
  fn mark_abandoned(&self) -> bool {
    let mut abandoned = self.abandoned.lock().unwrap();
    let was = *abandoned;
    *abandoned = true;
    was
  }

  fn is_abandoned(&self) -> bool {
    *self.abandoned.lock().unwrap()
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

  /// 应用窗口是否已经显示过（交接完成 / 安全网强制显示）。
  ///
  /// 用于给「主窗首帧看护」一个确定的退出界标（见 watch_main_first_paint）：
  /// 窗口一旦显示出来，就不再往页面里注入加载占位——顺手注入的 `eval` 会在
  /// 页面**就位之后**才执行，那一刻用户可能已经在用真界面了。
  fn is_main_shown(&self) -> bool {
    *self.shown.lock().unwrap()
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

/// 默认开发 URL：端口经 `single_instance::resolve_app_port()` 解析
/// （环境变量 → 检出 `.env` → 路径推导，唯一出口，见 single_instance 模块注释
/// 与 launch-and-build.md §1.1）。
///
/// **不要再在这里自己读 `COMFYAPP_PORT`**：那会漏掉 `.env` —— 壳不经过 Node，
/// 只看环境变量就会按路径推导出另一个端口并导航过去，dev server 其实在 `.env`
/// 写的那个端口上（ISSUE #821 的现场：启动页卡在「等 dev server」）。
fn default_dev_url(host: &str) -> String {
  format!("http://{}:{}/workspace", host, single_instance::resolve_app_port())
}

/// 从项目根目录读取启动状态文件 run/launch-status.json。
///
/// **读不到时不再只是一句 Err**（ISSUE #784 手验反馈：「启动状态文件也没有」）：
/// 「编排器还没写」与「项目根推不出来 / 文件在另一个地方」这两件事实在太容易
/// 混为一谈，而它们的处理方式完全相反（前者等，后者修环境）。因此失败时返回
/// 一份**壳自持的兜底状态**：`phase: "no-status-file"`，`reason` 说明是哪一种，
/// 附上诊断出口（壳侧链路日志 / 壳日志 / 应然路径）。
///
/// 但判据仍然要能分辨**真故障**：读失败若是「权限 / IO 错误」而不是
/// `NotFound`，那是实打实的问题，照样回 Err —— 不能被兜底吞掉。
#[tauri::command]
fn get_launch_status(state: tauri::State<'_, AppState>) -> Result<String, String> {
  let root = state.project_root();
  if root.is_empty() {
    // 项目根为空 = 壳推不出来：这不是「还没写」，壳写不进去就是因为没根。
    // 返回结构化兜底（让启动页能说出原因）而不是 Err（Err 在页面上只是一句
    // 无信息量的「读不到」）。
    log::warn!("[ComfyAPP] get_launch_status: COMFYAPP_PROJECT_ROOT 为空，无法定位启动状态文件");
    let searched = project_root_search_hint();
    return Ok(no_status_payload(
      "",
      &format!(
        "项目根未推导出来：壳找不到 run/launch-status.json。\
         已按「环境变量 → exe 所在目录逐级上溯 → 当前目录逐级上溯」找过，没有一处像本检出\
         （认 package.json + scripts/dev-launcher.mjs）。{searched}\
         若是把 exe 复制到别处运行：检出不完整时请回到项目根的 src-tauri/target/release/ 启动；\
         独立模式（standalone）的产物请用 tools\\build\\build-standalone.ps1 构建。"
      ),
    ));
  }
  let path = shell_launch::status_file_path(&root);
  match std::fs::read_to_string(&path) {
    Ok(text) => Ok(text),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
      // 编排器还没写（正常启动窗口期）或路径不对（环境问题）——两者都可能，
      // 因此把判断所需的事实（应然路径 + 壳侧日志位置）一起给出去。
      log::info!("[ComfyAPP] 启动状态文件尚未出现：{}", path.display());
      Ok(no_status_payload(
        &root,
        &format!(
          "启动状态文件尚未出现（{}）。若是刚双击启动，编排器写第一份状态前有 1~2 秒空档；\
           若持续为空，说明编排器没能起来 —— 先看壳侧编排链路日志。",
          path.display()
        ),
      ))
    }
    Err(e) => Err(format!("无法读取启动状态文件：{} ({})", path.display(), e)),
  }
}

/// 构造「没有状态文件」时的兜底状态（形态与编排器写的那份同域 + 多两个字段）。
///
/// `progress` 保持 < 1 且 `error: false`（这是「还没到」不是「失败」）——
/// 启动页据此继续显示等待动画，而不是把一次正常启动画成错误。
fn no_status_payload(root: &str, reason: &str) -> String {
  let launch_log = if root.is_empty() {
    String::new()
  } else {
    shell_launch::launch_log_path(root).display().to_string()
  };
  let shell_log = if root.is_empty() {
    String::new()
  } else {
    std::path::Path::new(root)
      .join("log")
      .join("shell")
      .join("shell.log")
      .display()
      .to_string()
  };
  serde_json::json!({
    "phase": "no-status-file",
    "progress": 0,
    "message": reason,
    "error": false,
    "noStatusFile": true,
    "diagnostics": {
      "projectRoot": root,
      "launchLog": launch_log,
      "shellLog": shell_log,
      "statusFile": if root.is_empty() { String::new() } else { shell_launch::status_file_path(root).display().to_string() },
    },
    "updatedAt": "shell",
  })
  .to_string()
}

/// 启动页检测到 ready 后，让 Rust 侧把「应用」窗口（main，隐藏）导航到真正的应用 URL。
/// 启动页（splash）保持可见，直到 main 的页面真正加载完成（on_page_load Finished）才交换窗口。
/// 这比前端直接 window.location 更可靠，可跨越 tauri:// 与 http:// 协议边界。
#[tauri::command]
fn navigate_to_app(state: tauri::State<'_, AppState>, app_handle: tauri::AppHandle) -> Result<(), String> {
  let url = state.app_url();
  log::info!("[ComfyAPP] navigate_to_app called with url: {}", url);
  // 导航一发起，主窗画面就离开启动页；在应用画好首帧之前由探测持续注入加载占位，
  // 避免这段时间露出 WebView2 空白 / 内嵌错误页（见 watch_main_first_paint）。
  watch_main_first_paint(app_handle.clone(), true);
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
    let abandoned = monitor
      .try_state::<AppState>()
      .map(|s| s.is_abandoned())
      .unwrap_or(false);
    if abandoned {
      // 用户已关闭启动页放弃本次启动，壳正在退出：不再把主窗显示出来。
      return;
    }
    let splash_open = monitor.get_webview_window("splash").is_some();
    let main_hidden = match monitor.get_webview_window("main") {
      Some(m) => !m.is_visible().unwrap_or(false),
      None => false,
    };
    if splash_open && main_hidden {
      // 强制交接：主窗可能还停在空白 / 错误页，先注入占位再显示，别把空白顶给用户
      watch_main_first_paint(monitor.clone(), true);
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
/// 显式冷启动 / 唤起已有实例」注入，见 scripts/start_tauri_launcher.py 的
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
///    「前台本来就是本应用 / 显式冷启动 / 用户再次唤起运行中的实例」；双击启动
///    不再注入（用户切去干别的正是常态，见 scripts/start_tauri_launcher.py 的
///    decide_foreground）。
///
/// **不再无条件调 `set_focus()` 试探**（ISSUE #359 回归的直接原因）：交接时
/// `show()` 若带激活语义，Windows 会把主窗当成「新窗口」**自己放行前台**——
/// `set_focus()` 必成功，用户的「别打断我」策略被架空。现在主窗以 `focused(false)`
/// 创建（首次 `show()` 走 `SW_SHOWNOACTIVATE`，不向前台要焦点），前台归属的
/// 最终裁定交给启动器的交接复核进程（scripts/win32-window-focus.py：它知道
/// 用户是否就在等这个应用，也拿得到双击启动所赋予的输入权，能把不该给的
/// 前台收回去）。
fn show_main_window_without_focus(app: &tauri::AppHandle, request_focus: bool) {
  let Some(win) = app.get_webview_window("main") else {
    return;
  };
  let state = app.try_state::<AppState>();
  let first_show = state.as_ref().map(|s| s.mark_shown()).unwrap_or(false);
  let configured = state.as_ref().map(|s| s.foreground()).unwrap_or(false);
  let activate = request_focus || configured;

  /* 首次显示这一刻才套用「上一次运行的窗口几何」（尺寸 / 位置 / 最大化）。
   *
   * 为什么不是让窗口状态插件在「窗口就绪」时套用（见 build_window_state_plugin
   * 的 skip_initial_state）：插件的 `maximized` 分支是 `window.maximize()`，
   * Windows 上它自带显示语义 —— 对一个**还该隐藏**的主窗调它，就是把窗口显示
   * 出来（实测启动期整屏闪一下）。放在这一行则窗口本来就要显示，最大化不再有
   * 副作用；而且位置 / 尺寸是在显示之前设好的，窗口一出现就在记忆的位置上，
   * 不会先冒出来再挪。 */
  if first_show {
    apply_saved_main_window_state(&win);
  }

  /* 最小化时先还原：`show()`（tao 走 SW_SHOW）对最小化窗口不会还原——Windows
   * 只把它「按原尺寸/原状态」显示出来，仍是任务栏上一条不动的按钮；随后的
   * `set_focus()` 也只是把「最小化的窗口」记为前台。用户双击启动或点托盘得到的
   * 观感就是「点了没法切到前台」，而再点一次任务栏又能出来（第二次点击走的是
   * 系统自己的还原路径）——正是「有时候切不到前台」。
   * 仅在确实最小化时调 unminimize：它的实现是 SW_RESTORE，对非最小化窗口带激活
   * 语义，无条件调会把「不抢前台」策略架空（见本函数开头与 §1.3）。 */
  if win.is_minimized().unwrap_or(false) {
    if let Err(e) = win.unminimize() {
      log::warn!("[ComfyAPP] unminimize main window failed: {:?}", e);
    }
  }
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
    // 同主窗：最小化时 show() 不还原，先 unminimize 再显示/聚焦。
    if win.is_minimized().unwrap_or(false) {
      let _ = win.unminimize();
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

/// 读取日志文件，只返回最后一个 `marker` 之后的尾部行。
///
/// 找不到 marker 时退回普通 `tail_log_file` 行为，避免首次上线 marker 前日志空白。
fn tail_log_file_since_marker(
  path: &std::path::Path,
  marker: &str,
  max_bytes: usize,
  max_lines: usize,
) -> Option<String> {
  let data = std::fs::read(path).ok()?;
  if data.is_empty() {
    return Some(String::new());
  }
  let text = String::from_utf8_lossy(&data);
  let plain = strip_ansi(&text);
  let lines: Vec<&str> = plain
    .lines()
    .map(str::trim_end)
    // PowerShell Transcript 会把每秒一次的健康检查超时原样灌进日志
    //（PS>TerminatingError(...)），对「执行到哪一步」毫无信息量，直接滤掉
    .filter(|l| !l.starts_with("PS>TerminatingError"))
    .collect();

  // 找最后一个会话标记；找不到时按原 tail_log_file 逻辑取尾部。
  let start = lines
    .iter()
    .rposition(|l| l.contains(marker))
    .map(|i| i + 1)
    .unwrap_or_else(|| lines.len().saturating_sub(max_lines));

  if start >= lines.len() {
    return Some(String::new());
  }
  let mut selected = &lines[start..];
  if selected.len() > max_lines {
    selected = &selected[selected.len() - max_lines..];
  }
  let mut joined = selected.join("\n");
  if joined.len() > max_bytes {
    let cut = joined.len() - max_bytes;
    // 从截断点向后找到第一个换行符，避免首行残缺
    let next_newline = joined[cut..].find('\n').map(|i| cut + i + 1).unwrap_or(cut);
    joined = joined[next_newline..].to_string();
  }
  Some(joined)
}

/// 「项目根是怎么找的、找过哪些地方」一段可读的过程说明。
///
/// 存在的理由：`项目根未推导出来` 这句话本身**不可行动** —— 用户（与贴图报障的人）
/// 需要知道壳试过哪儿、以及「什么样才算检出」，才能判断自己是「把 exe 挪走了」还是
/// 「检出缺文件」。旧提示只说「请确认 app.exe 位于项目根的 src-tauri/target/release/ 下」，
/// 而那句话正是用户当时**已经**在做的事（ISSUE #784 手验反馈：反复出现同一句提示、
/// 每次都指回原点）。
fn project_root_search_hint() -> String {
  let mut parts: Vec<String> = Vec::new();
  if let Ok(exe) = std::env::current_exe() {
    parts.push(format!("exe 位置：{}", exe.display()));
  }
  if let Ok(cwd) = std::env::current_dir() {
    parts.push(format!("当前目录：{}", cwd.display()));
  }
  parts.push(
    "检出的标志是两个文件同时存在：package.json 与 scripts/dev-launcher.mjs".to_string(),
  );
  format!("（{}）", parts.join("；"))
}

/// 一条日志都取不到时的「按顺序看这里」清单。
///
/// 判据是**文件在不在**，不是「该看哪一份」的经验之谈：把存在的那几份一一列出来
/// 并标出路径，用户（以及贴图报障的人）照着走就能拿到现场。全都不在时说明
/// 「这一层的日志都还没落地」，并点出**最可能的原因**（项目根没推出来 / 壳太旧）。
///
/// `logHintLines()`（Node 侧 `src/lib/shell/launch-diagnostics.ts`）是同一份清单的
/// Node 实现，两侧的候选路径必须一致 —— Node 侧的单测锁住那份。
fn no_log_guidance(root: &str) -> String {
  let mut lines = vec!["（暂无日志。）".to_string()];
  if root.is_empty() {
    lines.push("根因指向项目根：壳没能推导出项目根（三处候选都没命中本检出）。".to_string());
    lines.push(project_root_search_hint());
    lines.push(
      "项目根是编排器路径、日志目录与端口推导的共同锚点；推不出来时上述路径全都无处可写。"
        .to_string(),
    );
    return lines.join("\n");
  }
  lines.push(format!("项目根：{root}"));
  lines.push("按顺序看这几处（存在哪份就先看哪份）：".to_string());
  let candidates = [
    (
      "壳侧编排链路（壳自己写的，启动期最先有内容）",
      shell_launch::launch_log_path(root),
    ),
    (
      "壳日志（release）",
      std::path::Path::new(root).join("log").join("shell").join("shell.log"),
    ),
    (
      "编排日志（编排器起来后才有）",
      std::path::Path::new(root).join("log").join("launcher").join("dev-launcher.log"),
    ),
    (
      "编排错误输出",
      std::path::Path::new(root)
        .join("log")
        .join("launcher")
        .join("dev-launcher-stderr.log"),
    ),
    ("启动状态文件", shell_launch::status_file_path(root)),
  ];
  let mut found = 0usize;
  for (label, path) in candidates {
    let exists = path.is_file();
    if exists {
      found += 1;
    }
    lines.push(format!("  {} {}：{}", if exists { "●" } else { "○" }, label, path.display()));
  }
  if found == 0 {
    lines.push(
      "以上一处都还没落地：说明壳侧编排还没走到写日志那一步。请重编壳后重试：\
       cd src-tauri && cargo build --release --features custom-protocol"
        .to_string(),
    );
  }
  lines.join("\n")
}

/// 启动编排器的日志在文件被占用时会回退改名，以 sentinel
/// log/launcher/dev-launcher-current.txt 指向的真实文件为准；附带 stderr 尾部、
/// 壳自持日志与**壳侧编排链路日志**（`log/launcher/shell-launch.log`，启动期
/// 最先有内容的一份，见 §1.5.1），启动卡住时用户能直接在启动页看到
///「执行到哪一步 / 卡在哪里」。
#[tauri::command]
fn get_launch_log(state: tauri::State<'_, AppState>) -> Result<String, String> {
  let root = state.project_root();
  if root.is_empty() {
    // 项目根为空时不再回一句「没设环境变量」：面板需要的是**能做点什么**，
    // 而这里能说的是「壳推不出项目根」，以及唯一有效的动作（见 noLogGuidance
    // 的同名分支）。返回文本而不是 Err —— 面板把两者都渲染成一行，但前者
    // 至少把根因写出来了。
    return Ok(no_log_guidance(""));
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
  // 这份是追加不轮转的固定名文件，会累积历次启动。壳在每次启动时先往里写会话
  // 标记，这里只取最后一个标记之后的行，保证面板只显示本次启动的 stderr。
  if let Some(tail) = tail_log_file_since_marker(
    &log_dir.join("dev-launcher-stderr.log"),
    shell_launch::SESSION_START_MARKER,
    4 * 1024,
    60,
  ) {
    if !tail.trim().is_empty() {
      sections.push(format!("─ 错误输出（dev-launcher-stderr.log）─\n{}", tail));
    }
  }
  // 壳自持日志（release 落 log/shell/shell.log；dev 由 launcher 重定向 stderr，
  // 不产生此文件）。启动期壳的导航/看门狗/侧车诊断都经 log:: 打到这份文件，
  // 正式版壳脱离 launcher（standalone 双击）崩溃时仍有可查日志。
  let shell_log = std::path::Path::new(&root).join("log").join("shell").join("shell.log");
  // 同上：追加不轮转，靠会话标记只取本次启动的壳自持日志（dev 模式下这份文件
  // 不产生，下面取不到标记会退回空切片，不影响其它段）。
  if let Some(tail) = tail_log_file_since_marker(
    &shell_log,
    shell_launch::SESSION_START_MARKER,
    8 * 1024,
    120,
  ) {
    if !tail.trim().is_empty() {
      sections.push(format!("─ 壳日志（log/shell/shell.log）─\n{}", tail));
    }
  }
  // 壳侧的编排链路日志（`log/launcher/shell-launch.log`）：**这是启动期最先
  // 有内容的一份**——它由壳自己落，不依赖编排器起来（编排器写的三份日志在
  // 「壳已接手、编排器还没写」的窗口期全是空的，正是手验反馈里「暂时读不到
  // 日志」的现场）。放在最后一段是因为它信息密度最高（启动报告 + 编排器输出）。
  //
  // 这份日志是追加写的，会累积历次启动。壳在每次启动时先写一行会话标记，
  // 这里只取最后一个标记之后的行，保证面板只显示本次启动相关的内容。
  let launch_log = shell_launch::launch_log_path(&root);
  if let Some(tail) = tail_log_file_since_marker(
    &launch_log,
    shell_launch::SESSION_START_MARKER,
    16 * 1024,
    200,
  ) {
    if !tail.trim().is_empty() {
      sections.push(format!(
        "─ 壳侧编排链路（log/launcher/shell-launch.log）─\n{}",
        tail
      ));
    }
  }
  // 一条都没读到时，把壳在启动那一刻写下的报告附上（`startup_report()` 与
  // 日志里那份同源）。原由：编排器写自己的 `launch-status.json` 时会把壳的快照
  // （含 diagnostics.projectRoot 与这份报告）整份顶掉，而它写第一份日志之前，
  // 磁盘上确实一份日志都没有 —— 那段窗口期里「这条日志读不到」的现场就只剩
  // 这一份报告（项目根 / 编排脚本在不在 / 依赖门禁 / 端口 / 各日志路径）。
  if sections.is_empty() {
    let report = shell_launch::startup_report_section(&root, "（读不到日志，这是壳接手时的快照）");
    // 「没了」这一步必须给出**下一步做什么**，否则用户唯一能做的就是把屏幕
    // 截图发出来（手验反馈正是如此）。
    return Ok(format!("{}\n\n{}", report, no_log_guidance(&root)));
  }
  Ok(sections.join("\n\n"))
}

/// 关闭窗口（默认启动页）。
///
/// 与最小化一组：启动页窗口关了原生装饰（`decorations: false`），窗口按钮是
/// 启动期唯一的出口，而按钮只是「按钮」，不该因此把 core:window 的整面命令
/// 授权出去——所以这里给按钮两个自己的命令，壳侧直接操作窗口。
///
/// 它同时是 Tauri window API 那条主路径的兜底（页面侧 `win_minimize` /
/// `win_close` 探不到时给出「壳过期」的可见提示，见 docs/standards/07-日志系统.md §7.18.7）。
#[tauri::command]
fn win_close(app_handle: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app_handle.get_webview_window("splash") else {
    return Err("找不到启动页窗口 splash".to_string());
  };
  win
    .close()
    .map_err(|e| format!("关闭启动页窗口失败: {:?}", e))
}

/// 最小化窗口（默认启动页）。语义与 `win_close` 成对，见其说明。
#[tauri::command]
fn win_minimize(app_handle: tauri::AppHandle) -> Result<(), String> {
  let Some(win) = app_handle.get_webview_window("splash") else {
    return Err("找不到启动页窗口 splash".to_string());
  };
  win
    .minimize()
    .map_err(|e| format!("最小化启动页窗口失败: {:?}", e))
}

/// 启动页「收起 / 展开日志」时把窗口调到对应档位。
///
/// 为什么由壳来做而不是让页面自己调窗口 API：尺寸档位是**窗口语义**（内容多大
/// 窗口多大），常量与开窗时的 `splash_window_size` 同源——两处各写一份，改一处
/// 就会露出空白或裁掉内容。展开日志后日志面板按窗口高度撑满，单行日志也才放得开。
#[tauri::command]
fn set_splash_compact(app_handle: tauri::AppHandle, compact: bool) -> Result<(), String> {
  let Some(splash) = app_handle.get_webview_window("splash") else {
    return Err("找不到启动页窗口 splash".to_string());
  };
  let requested = if compact {
    SPLASH_WINDOW_SIZE
  } else {
    SPLASH_WINDOW_SIZE_EXPANDED
  };
  let (width, height) = clamp_to_monitor(&app_handle, requested);
  splash
    .set_size(tauri::LogicalSize::new(width, height))
    .map_err(|e| format!("调整启动页尺寸失败: {:?}", e))?;
  // 只调尺寸不挪位置，窗口左边缘会留在原地、看起来往右跑；重新居中一次。
  let _ = splash.center();
  Ok(())
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

/// sidecar 可执行文件名：**按目标平台判据**，不写死 `node.exe`。
///
/// 写死时跨平台构建会直接死在 `build.rs`：`bundle.externalBin` 声明的是
/// Tauri 的「无后缀 basename」约定，打包器按当前目标三元组补后缀去找
/// `node-<triple>[.exe]`，而 Windows 版脚本只产出 `.exe`、sidecar 解析又只
/// 拼 `node.exe` —— Linux/macOS 上两处都会落空（实测报错
/// ``resource path `binaries/node-x86_64-unknown-linux-gnu` doesn't exist``）。
/// 判据收在这一个函数里，与 scripts/build-desktop.mjs 的 sidecarFileName 同源。
#[cfg(not(debug_assertions))]
fn sidecar_binary_name() -> &'static str {
  if cfg!(windows) {
    "node.exe"
  } else {
    "node"
  }
}

/// 生产模式：以 Node sidecar 启动 Next standalone server，端口就绪后主窗口跳转。
///
/// 进程经 **tauri-plugin-shell** 拉起（而不是 `std::process::Command`）：
/// 官方插件按平台选解释器并让 `kill()` 连带回收子进程，跨平台回收因此不必
/// 自己写两套（见 SIDECAR 静态量的注释）。
#[cfg(not(debug_assertions))]
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
  use tauri_plugin_shell::process::CommandEvent;
  use tauri_plugin_shell::ShellExt;

  let port = pick_free_port();
  // 允许回退 dev 的模式判据：只认「显式 standalone」这一种拒绝回退的情形，
  // 所以这里判的是**缺省值**而不是整条字符串比较。它不引用 run() 里那份
  // COMFYAPP_LAUNCH_MODE（本函数只在 setup_standalone_runtime 命中 standalone
  // 分支时才会被调用，语义上已经隐含），启动模式的唯一读取点仍在 run()。
  let refuses_dev_fallback = matches!(
    std::env::var("COMFYAPP_LAUNCH_MODE").as_deref(),
    Ok("standalone")
  );
  let res_dir = app.path().resource_dir()?;
  let node = res_dir.join("binaries").join(sidecar_binary_name());
  let server = res_dir.join("server.js");

  if !server.exists() {
    if refuses_dev_fallback {
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

  // 直接执行 sidecar 二进制本身（不经 shell 解释器）：
  // `Command::new` 在 shell 插件里是「可执行 + 参数」语义，路径由资源目录给出，
  // 不需要 `sh -c` / `cmd /C` 这层间接 —— 少一层中转就少一个孤儿来源。
  let (mut rx, child) = app
    .shell()
    .command(node.to_string_lossy().to_string())
    .args([server.to_string_lossy().to_string()])
    .env("PORT", port.to_string())
    .env("HOSTNAME", "127.0.0.1")
    .current_dir(&res_dir)
    .spawn()?;
  *SIDECAR.lock().unwrap() = Some(child);

  // sidecar 的 stdout/stderr 必须有人读：shell 插件把输出投递到事件通道，
  // 无人消费时管道写满会让 sidecar 静默卡死（表现为「服务一直不就绪」）。
  // 落进壳日志，也正好补上 standalone 脱离 launcher 时的诊断通道。
  tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) => {
          log::info!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end())
        }
        CommandEvent::Stderr(line) => {
          log::warn!("[sidecar] {}", String::from_utf8_lossy(&line).trim_end())
        }
        CommandEvent::Terminated(payload) => {
          log::info!("[sidecar] terminated: {:?}", payload.code)
        }
        _ => {}
      }
    }
  });

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
  // 启动页不可用，没有可保留的进度画面 —— 主窗会提前显示，因此占位就是这段时间
  // 唯一的界面（见 watch_main_first_paint）。
  watch_main_first_paint(handle.clone(), true);

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
        // 启动页（splash）不可用，无窗口可交换：直接显示「应用」窗口并关闭黑屏 splash。
        // 用户已放弃本次启动时止步——壳正在退出，别把主窗又显示出来。
        let abandoned = handle
          .try_state::<AppState>()
          .map(|s| s.is_abandoned())
          .unwrap_or(false);
        if !abandoned {
          show_main_window_without_focus(&handle, false);
          if let Some(splash) = handle.get_webview_window("splash") {
            let _ = splash.close();
          }
        }
        return;
      }
      std::thread::sleep(Duration::from_millis(500));
    }
    log::warn!("[ComfyAPP] 等待应用地址就绪超时：{}", url);
  });
}

/// 启动页不可用时的**唯一兜底**：等应用地址就绪后直接导航并显示主窗。
///
/// 两个调用点共用它，判据只在这里写一遍：
///   · `setup_standalone_runtime`：`splash.html` 资源没嵌入（老壳 / 构造异常）；
///   · `spawn_splash_watchdog`：资源在、**启动页的 WebView 却没起来**——现场是
///     WebView2 建窗报 `HRESULT(0x80070057) 参数错误`，窗口对象存在但
///     `url()` 永远拿不到 `splash.html`，页面 JS 从不执行，于是没人会调
///     `navigate_to_app`，主窗一直停在 `about:blank`（隐藏态没有任务栏图标，
///     从托盘唤起看到的就是白屏）。
///
/// 原先的判据是「资源有没有嵌进二进制」（`has_splash`），它看不见第二种形态，
/// 于是这一类故障没有出口。这里把它接上：**启动页跑不起来**与**启动页不存在**
/// 对用户是同一件事，走同一条路。
fn fallback_without_splash(handle: &tauri::AppHandle) {
  #[cfg(not(debug_assertions))]
  {
    let Some(state) = handle.try_state::<AppState>() else {
      return;
    };
    let url = state.app_url();
    if url.is_empty() {
      /* 应用地址还没定：没有可导航的目标。正常路径下 `LaunchContext::collect()`
       * 早已把它写进 AppState（prebuilt 的 `COMFYAPP_DEV_URL` / standalone 的
       * sidecar 端口），这里落空只说明这次启动连地址都没解析出来。 */
      log::warn!("[ComfyAPP] 启动页不可用，但应用地址尚未确定，无法回退导航");
      return;
    }
    log::warn!(
      "[ComfyAPP] 启动页不可用（资源缺失或 WebView 未生效），就绪后直接导航到 {}",
      url
    );
    navigate_when_ready(handle.clone(), url);
  }
  #[cfg(debug_assertions)]
  {
    /* debug 构建（`pnpm tauri dev`）没有这条兜底：`navigate_when_ready` 只在
     * release 编译，且那时启动页由 dev server 提供，不依赖内嵌资源。 */
    let _ = handle;
    log::warn!("[ComfyAPP] 启动页不可用（debug 构建没有「等就绪直接导航」这条兜底）");
  }
}

/// 主窗首帧看护：在应用自己渲染出界面之前，**不让 WebView2 的空白首帧露出来**。
///
/// 现场（ISSUE #730）：启动页探测到应用端口可响应后调 `navigate_to_app`，而
/// 「TCP 可连」与「首帧能画出来」之间还有一段实打实的等待——dev 模式下要等
/// next dev 编译路由（冷启动十几秒）。这段等待里的画面在一分钟内会先后呈现
/// 三种样子，看起来都像「坏了」：
///
/// 1. **WebView2 自带的「无法访问此页面 / ERR_CONNECTION_REFUSED」**：端口可连
///    但 HTTP 还没开始服务，或者请求在首编译期间被拒（与 §5 对照表里那条同族，
///    区别是它在**交接之后**发生）；
/// 2. **纯白空白**：Next 的 document 壳已下发，而骨架里的内容还在等 RSC 首帧；
/// 3. **主窗（无原生装饰）自身**：标题行由前端接管，页面没画出来时，
///    右上角的关闭按钮自然也不存在——用户看到的就是「没有关闭按钮的窗口」。
///
/// 因此把「等首帧」这段从主窗里挪走：探测期间每次 tick 往主窗注入一次加载占位
/// （`MAIN_LOADING_STUB_JS`），启动页（带进度、日志面板与关闭按钮）保持可见；
/// 一旦读到「应用已经自己渲染出文档」就立刻收手，交接仍由
/// `on_main_page_finished` 完成——那里还有 TCP 可达性二次校验，不可达就继续
/// 重导航并保持启动页，全程不会把错误页当应用显示。
///
/// `stub_visible` 由调用方按启动模式给：dev / prebuilt 恒为 true（此时应用首帧
/// 必然晚于导航），standalone 是 false（内嵌 server 随壳一起就绪，主窗很快有画面，
/// **连探测都不启动**——否则探测会在首帧之前把占位盖上去，反而白闪一下）。
///
/// 判据是 **URL 离开 about:blank** 而不是「主窗可见」：主窗在 setup 时就已创建，
/// `is_visible()` 在交接前后都是 false，拿它当界标会让探测提前退出。
fn watch_main_first_paint(handle: tauri::AppHandle, mut stub_visible: bool) {
  if handle.get_webview_window("main").is_none() {
    return;
  }
  std::thread::spawn(move || {
    for _ in 0..PROBE_ATTEMPTS {
      let Some(win) = handle.get_webview_window("main") else {
        return;
      };
      if handle
        .try_state::<AppState>()
        .map(|s| s.is_abandoned())
        .unwrap_or(false)
      {
        return;
      }
      if handle
        .try_state::<AppState>()
        .map(|s| s.is_main_shown())
        .unwrap_or(false)
      {
        log::info!("[ComfyAPP] main window shown, first paint watch stops");
        return;
      }
      let url = win.url().map(|u| u.to_string()).unwrap_or_default();
      if !is_app_url(&url) {
        continue;
      }
      if app_document_shown(&handle) {
        log::info!("[ComfyAPP] main first paint observed, watch stops (url={})", url);
        return;
      }
      // 占位只注入一次：eval 是**就位即执行**的，注入之后这次导航就算被错误页
      // 顶掉也无所谓——页面里开着的重试定时器会把占位重新贴回来（见
      // MAIN_LOADING_STUB_JS 里 setInterval 的注释）。
      if stub_visible {
        if let Err(e) = win.eval(MAIN_LOADING_STUB_JS) {
          log::warn!("[ComfyAPP] main loading stub eval failed: {:?}", e);
        }
        stub_visible = false;
      }
      std::thread::sleep(Duration::from_millis(PROBE_INTERVAL_MS));
    }
    log::warn!(
      "[ComfyAPP] main first paint watch timed out ({}s), splash kept",
      (PROBE_ATTEMPTS * PROBE_INTERVAL_MS) / 1000
    );
  });
}

/// 应用退出时回收 sidecar 整棵进程树。
///
/// 两道机制，缺一不可（AGENTS 硬规则 3：必须杀整棵树）：
///   1. **shell 插件自己的 `kill()`** —— 它按平台选机制（Windows 任务终止 /
///      POSIX 进程组信号），是「跨平台」这件事最不该自己手写的一段；
///   2. **编排侧的统一回收**（scripts/launcher-core/reject.mjs → 见下）——
///      插件保证「跟随平台」，统一回收保证「不漏」：Node 之下的 next-server /
///      turbopack worker 才是真正会残留成孤儿的那几层。
///
/// 此前这里写死 `taskkill /T /F`，在 Linux/macOS 上等于**什么也不做**；改成
/// 只调插件之后仍然只杀到「插件认为的那棵树」。因此把第二道补上，并让**唯一
/// 判据**留在 `scripts/reap-process.mjs`（与编排器、Python 启动器同一入口），
/// 而不是在 Rust 里再写一遍平台分支。
#[cfg(not(debug_assertions))]
fn kill_sidecar(project_root: &str) {
  let child = SIDECAR.lock().unwrap().take();
  let Some(child) = child else { return };
  // 插件用的 sidecar pid：先记下来，交给统一回收做第二道。
  let pid = child.pid();
  match child.kill() {
    Ok(()) => log::info!("[ComfyAPP] sidecar killed via shell plugin (pid {pid})"),
    Err(e) => log::warn!("[ComfyAPP] sidecar kill via shell plugin failed: {e:?}"),
  }
  reap_process_tree(project_root, pid);
}

/// 用编排侧的统一回收补一刀（`scripts/reap-process.mjs`）。
///
/// 为什么复用脚本而不是在 Rust 里再写一套：平台判据（Windows `taskkill /T /F`
/// 与 POSIX 进程组）只允许有一份。Rust 侧再写一遍，就是历史上「各写各的、
/// POSIX 上退化成单杀」那条老路的翻版。
#[cfg(not(debug_assertions))]
fn reap_process_tree(project_root: &str, pid: u32) {
  if project_root.is_empty() || pid == 0 {
    return;
  }
  let script = std::path::Path::new(project_root)
    .join("scripts")
    .join("reap-process.mjs");
  if !script.is_file() {
    log::warn!(
      "[ComfyAPP] 统一回收脚本不存在（{}），本次只靠 shell 插件回收 sidecar",
      script.display()
    );
    return;
  }
  let mut command = std::process::Command::new("node");
  command.arg(&script).arg(pid.to_string()).arg("--force");
  #[cfg(windows)]
  {
    // 不弹控制台窗口（POSIX 上无此常量，故走 cfg 门控而不是运行时判据）。
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  match command.output() {
    Ok(out) => log::info!(
      "[ComfyAPP] sidecar 进程树统一回收：{}",
      String::from_utf8_lossy(&out.stdout).trim()
    ),
    Err(e) => log::warn!("[ComfyAPP] 统一回收未能执行（{e}）；sidecar 可能残留，见 log/nextjs/"),
  }
}

/// 该路径是否像一个「本检出」的项目根。
///
/// 判据刻意**不看平台专属文件**：此前校验的是 `scripts/dev-launcher.ps1`
/// 是否存在，于是 Linux/macOS 上 `resolve_project_root()` 永远返回空串 ——
/// 启动页读不到 `run/launch-status.json`、壳日志落不到 `log/shell/`，
/// 表现为「启动页一直转圈 + 没有日志可查」，而根因只是判据绑在了 Windows 上。
/// 现在认两个**跨平台都存在**的仓库标识文件：`package.json`（必需）+
/// `scripts/dev-launcher.mjs`（启动编排器的唯一实现；`.ps1` 只是它的 Windows
/// 调用入口，因此**不再**作为判据 —— 判据绑在入口形态上，就会在换入口时又静默
/// 失效一次）。
fn looks_like_project_root(dir: &std::path::Path) -> bool {
  dir.join("package.json").is_file() && dir.join("scripts").join("dev-launcher.mjs").is_file()
}

/// 从某个起点向上找最近的检出根（含起点自身）。
///
/// **必须逐级上溯，不能只看起点这一层**：规范里唯一入口的落位是
/// `src-tauri/target/release/app.exe`（§1，`start-tauri.ps1` 也据此拼路径），
/// 而 `package.json` 在**上溯三级**的地方。旧实现只查 `exe.parent()`（= `target/release`），
/// 于是「按文档落位双击」这条**唯一**的启动路径永远推不出项目根 —— 表现是本文件的
/// `get_launch_status` 回「项目根未推导出来」、启动页永远停在 0%、壳日志也落不了盘，
/// 而根因只是这一层没往上走（ISSUE #784 手验反馈：反复出现同一句提示）。
///
/// 上溯而不是「拼 `../..`」：拼死层数等于把「壳产物落在哪儿」这条会变的形态
/// 写进判据 —— 换一次产物布局（或 cargo 的 target-dir 被改）就静默失效一次，
/// 正是 `looks_like_project_root` 上一条注释里踩过的坑。上溯的代价是每层两次
/// `is_file`，而它只在启动时跑一次。
fn find_project_root_from(start: &std::path::Path) -> Option<std::path::PathBuf> {
  let mut dir = Some(start);
  while let Some(current) = dir {
    if looks_like_project_root(current) {
      return Some(current.to_path_buf());
    }
    dir = current.parent();
  }
  None
}

/// 尝试从 launcher 传入的环境变量读取项目根目录；
/// 失败则回退到**从 exe 所在目录逐级上溯**，再退到当前工作目录。
///
/// cwd 作为候选的意义：`tools/start/start-tauri.ps1` 用
/// `Start-Process -WorkingDirectory $root` 拉起壳，因此「双击 .ps1 能进、双击 exe 卡住」
/// 这类差异里 cwd 是一条**真实**的项目根来源（双击 exe 时 cwd 通常是
/// `C:\Windows\System32`，命中不了）。环境的候选顺序刻意是
/// 「注入 → exe 位置 → cwd」：注入最权威，exe 位置与本检出绑定最紧（同一份 exe
/// 不论从哪儿双击都认得出自己的检出），cwd 则是「壳被谁在哪儿拉起」的旁证。
fn resolve_project_root() -> String {
  if let Ok(root) = std::env::var("COMFYAPP_PROJECT_ROOT") {
    if looks_like_project_root(std::path::Path::new(&root)) {
      return root;
    }
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      if let Some(found) = find_project_root_from(dir) {
        return found.to_string_lossy().to_string();
      }
    }
  }
  if let Ok(cwd) = std::env::current_dir() {
    if let Some(found) = find_project_root_from(&cwd) {
      return found.to_string_lossy().to_string();
    }
  }
  String::new()
}

/// 把推导出的检出根**回填进自己的环境变量**，供「比它更早的读取点」使用。
///
/// 为什么必须有这一步：`single_instance::identity_root()`（单实例身份 + 端口推导的
/// 锚点）在 `run()` 的**第一行**就被读走 —— 那时还没有人给过它项目根，它只能退回
/// cwd；而双击场景的 cwd 往往是 `C:\Windows\System32`（explorer 启动），于是
/// 身份锚点与端口推导**双双落在一个与检出无关的路径上**：同一检出双击第二次
/// 认不出第一次（单实例失效、叠加窗口），推导端口也不是 dev server 真正在听的
/// 那个（启动页永远等不到就绪）。原先这两个值由 Python 启动器注入，启动器随
/// ISSUE #784 移除后就成了无主字段。
///
/// 回填的语义是「壳自己就是那个注入者」：只在变量**缺席**时才写，不覆盖外部显式
/// 注入的值 —— `COMFYAPP_PROJECT_ROOT` 仍是「谁起的壳」的一手证据
/// （`LaunchContext::self_launch` 的判据就挂在它缺席与否上）。
///
/// 因此调用点必须是「先捕获 `self_launch` → 再回填」（见 `run()`）：
/// 顺序反过来会把那条判据变成永远为假的常量，双击链路于是不再自编排。
fn publish_project_root_env(root: &str) {
  if root.is_empty() {
    return;
  }
  if let Ok(existing) = std::env::var("COMFYAPP_PROJECT_ROOT") {
    if !existing.trim().is_empty() {
      return; // 外部注入优先：不覆盖「谁起的壳」这条一手证据
    }
  }
  // SAFETY：启动期单线程（事件循环与窗口都还没建），没有并发读环境变量的路径。
  std::env::set_var("COMFYAPP_PROJECT_ROOT", root);
}

/// 把壳自己的 exe 路径发布给下游（编排器 → dev server → 服务生命周期）。
///
/// 保活服务必须经壳的 CLI 形态拉起才能逃出 `KILL_ON_JOB_CLOSE` 的 job（见
/// `detached_spawn` 模块头），而「壳在哪」只有壳自己知道：编排器由壳拉起、dev
/// server 由编排器拉起，因此这一行写下的变量会顺着链传下去。
///
/// 与 `publish_project_root_env` 同一时机（启动期、建窗口之前）写入。
fn publish_shell_exe_env() {
  if let Ok(exe) = std::env::current_exe() {
    // SAFETY：同 publish_project_root_env —— 启动期单线程。
    std::env::set_var("COMFYAPP_SHELL_EXE", exe);
  }
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
  // 时区固定 UseLocal：插件的默认策略是 UTC（`DEFAULT_TIMEZONE_STRATEGY`），
  // 壳 stderr 被 launcher 重定向进 log/launcher/ 后面板直接展示——UTC 会让
  // 同一份面板里的行与其余本地时钟的行差 8 小时。
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
    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
    .targets(targets)
    .build()
}

#[cfg(debug_assertions)]
fn build_log_plugin(_project_root: &str) -> tauri::plugin::TauriPlugin<Wry> {
  // dev 模式：壳日志由 launcher 把 stderr 重定向进 log/launcher/，无需壳自持文件。
  // 时区同样固定 UseLocal（理由见 release 分支的注释）。
  tauri_plugin_log::Builder::new()
    .level(log::LevelFilter::Info)
    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
    .targets([
      tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
      tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
    ])
    .build()
}

/// 窗口状态插件要记忆 / 还原的维度。
///
/// 保存与还原**必须同源**：壳自己在建窗那一刻调 `restore_state` 时传的就是它
/// （见 `apply_saved_main_window_state`），这里分叉会出现「记得住、还原不回来」
/// 这种最难查的形态。
fn window_state_flags() -> WindowStateFlags {
  WindowStateFlags::SIZE | WindowStateFlags::POSITION | WindowStateFlags::MAXIMIZED
}

/// 窗口状态持久化：记忆 main / comfyui 窗口的位置、尺寸与最大化，重启后还原。
/// 刻意排除 VISIBLE——本壳的 main 窗由「启动页 → 导航 → 交换」流程控制显隐，
/// 交给插件自动 show 会破坏隐藏待命语义（见 run() 里对 main 的 visible(false)）。
/// splash 只做进度展示，无记忆需求，deny 掉。
///
/// **main 的初始还原也交给壳自己做**（`skip_initial_state`）：插件的还原发生在
/// 「窗口就绪」那一刻，而它的 `maximized` 分支是 `window.maximize()` —— Windows
/// 上这个调用**自带显示语义**，会把一个还该隐藏的主窗显示出来。实测
/// （2560x1600）：t=+2.7s 出现一个铺满屏幕的可见主窗（(-11,-11,2582,1550)），
/// 95ms 后被建窗流程重新隐藏，用户看到的就是「启动页之外整屏闪一下」。
/// 套用几何的位置改到建窗那一刻并由壳立刻收回隐藏态，见
/// `apply_saved_main_window_state`。
fn build_window_state_plugin() -> tauri::plugin::TauriPlugin<Wry> {
  tauri_plugin_window_state::Builder::default()
    .with_denylist(&["splash"])
    .skip_initial_state("main")
    .with_state_flags(window_state_flags())
    .build()
}

/// 壳层单实例保护已按检出隔离（src-tauri/src/single_instance.rs）：launcher
/// （CreateMutexW）只保护「双击启动」这一层；当 app.exe 被直接拉起（standalone
/// 双击、launcher 已退而壳还活着）时仍可能叠加窗口。把单实例下沉到壳进程，
/// 二次实例在 run() 早期退出并通知首实例唤起主窗口。

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

/// 启动页窗口尺寸（逻辑像素）：**窗口即内容**，不铺满屏幕。
///
/// 为什么要收成一条窄条（ISSUE #412）：启动页此前按「窗口越大、日志一行越
/// 能放全」的思路给到 1680×1000 并带原生标题栏，于是在 2K/4K 屏上启动时
/// 会出现一大片既没有内容、也没有用途的空白（卡片只有 720/1400 宽，垂直方向
/// 更是大片留白），观感上像「弹了个空窗口」。现在的取向是：
///
/// - 窗口初始尺寸 = 内容卡片的宽度（+ 窗口内边距），高度 = 收起日志时的
///   卡片高度，位置居中——启动期只占屏幕一小块，不打扰后面的工作；
/// - 关掉原生装饰（`decorations: false`），最小化 / 关闭由**启动页自身的
///   标题行**提供（页面右上角），不再为三个系统按钮多留一条标题栏；
/// - 上限仍取当前显示器可用区域（宽高各留 48px 边距，与页面自身的
///   `min(100vw - 48px)` 同口径）：小屏不越界，尺寸不够时由页面继续收；
/// - 展开日志后页面会把窗口调到 SPLASH_WINDOW_SIZE_EXPANDED，仍是「内容多大、
///   窗口多大」。
const SPLASH_WINDOW_SIZE: (f64, f64) = (744.0, 216.0);

/// 展开日志后的窗口尺寸（对应页面里「展开日志」那一档，见 splash.html）。
const SPLASH_WINDOW_SIZE_EXPANDED: (f64, f64) = (1424.0, 788.0);

/// 主窗首帧看护的节奏与上限（见 watch_main_first_paint 的注释）。
/// 两者类型取同一档（u64）：上限与节奏会相乘，跨类型相乘直接编译不过
/// （`u32 * u64` 无实现）——「间隔是 u64 / 次数是 u32」这种看着像随手写的
/// 组合，代价是 release 壳根本编不出来。
const PROBE_INTERVAL_MS: u64 = 250;
const PROBE_ATTEMPTS: u64 = 480;

/// 注入主窗的加载占位（**纯 ASCII**：与 splash-assets 同一条约束——Tauri 的
/// asset 处理器按字节切响应体补 nonce，多字节字符会让切片落到字符内部）。
///
/// 为什么占位由壳注入而不是让应用自己渲染：导航一发起，WebView2 就已把主窗
/// 画面切到空白/错误页，应用那一端此刻连首帧都还没画出来；能抢在它前面的只有
/// 壳侧注入。注入时机是**首帧看护**发现「应用文档还没出现」时（见
/// watch_main_first_paint）；占位自带的重贴定时器由应用在根布局挂载时收掉
/// （`clearLaunchLoadingStub`，见 src/lib/shell/desktop-shell-client.ts），
/// 因此它不会盖住真界面。
const MAIN_LOADING_STUB_JS: &str = r#"
(function () {
  function paint() {
    try {
      var doc = document;
      if (!doc || !doc.documentElement || !doc.body) return;
      if (doc.getElementById('__comfyapp_loading_stub')) return;
      doc.documentElement.style.background = '#151320';
      var box = doc.createElement('div');
      box.id = '__comfyapp_loading_stub';
      box.style.cssText =
        'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;' +
        'justify-content:center;flex-direction:column;gap:12px;background:#151320;' +
        'color:#E5E5E7;font-family:"Microsoft YaHei",system-ui,sans-serif;font-size:13px';
      box.innerHTML =
        '<div style="font-size:15px;font-weight:600;color:#7C5CFC">Comfy APP</div>' +
        '<div id="__comfyapp_loading_text">Application is loading, please wait...</div>';
      doc.body.appendChild(box);
    } catch (e) {}
  }
  paint();
  // The embedded error page replaces the whole DOM (taking the stub with it)
  // while WebView2 still reports a finished navigation - without repainting the
  // user sees that error page again. The timer belongs to the navigation that
  // got the stub; the real app page clears it on mount (see the Rust comment
  // above main_window_clear_loading_stub).
  try {
    if (window.__comfyappStubTimer) clearInterval(window.__comfyappStubTimer);
    window.__comfyappStubTimer = setInterval(paint, 400);
    setTimeout(function () {
      if (window.__comfyappStubTimer) clearInterval(window.__comfyappStubTimer);
      window.__comfyappStubTimer = 0;
    }, 20000);
  } catch (e) {}
})();
"#;


/// 让**应用自己**清掉注入的加载占位。
///
/// 注入的开头开了一个每 400ms 重新贴一次占位的定时器（内嵌错误页会换掉整个
/// DOM），它属于**被注入的那次导航**；应用页面加载之后必须把它关掉，否则占位
/// 会在应用首帧画好之后又盖回来。应用侧无从知道这个定时器的存在（它只认一个
/// 固定在窗口上的标记），而清理代码只有一行，因此放在前端根布局里——
/// 判据与调用点见 src/app/layout.tsx 的 clearLaunchLoadingStub。
fn main_window_clear_loading_stub(win: &tauri::WebviewWindow, phase: &str) {
  // 清理脚本用 concat! 分组拼出来，避免在源码里出现一行的超长字符串字面量
  // （可读性差，且编辑器/格式化工具会把行折得看不出结构）。
  let clear_js = concat!(
    "try { if (window.__comfyappStubTimer) { ",
    "clearInterval(window.__comfyappStubTimer); window.__comfyappStubTimer = 0; } ",
    "var el = document.getElementById('__comfyapp_loading_stub'); ",
    "if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}",
  );
  if let Err(e) = win.eval(clear_js) {
    log::debug!("[ComfyAPP] clear loading stub failed at {}: {:?}", phase, e);
  }
}

/// 探测主窗 URL 是否已经换成应用地址。
///
/// 判据是 **URL 离开 about:blank**，而不是「匹配某个端口」：把 URL 判据写死成
/// 某个端口，换端口 / 换模式（standalone 自选端口）就会静默失效，而这里真正要
/// 区分的只有「还没导航过去」与「已经在应用上了」两种。
fn is_app_url(url: &str) -> bool {
  url.starts_with("http://") || url.starts_with("https://")
}

/// 主窗是否已经渲染出应用文档（而不是空白 / 内嵌错误页）。
fn app_document_shown(handle: &tauri::AppHandle) -> bool {
  handle
    .get_webview_window("main")
    .map(|w| w.eval("1").is_ok())
    .unwrap_or(false)
}

/// 按当前显示器可用区域收一次尺寸（不越界）。
fn clamp_to_monitor(app: &tauri::AppHandle, size: (f64, f64)) -> (f64, f64) {
  let (mut width, mut height) = size;
  let Ok(Some(monitor)) = app.primary_monitor() else {
    log::warn!("[ComfyAPP] primary monitor unavailable, keeping requested splash size");
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

/// 启动页初始尺寸：紧凑的一条，受显示器约束（见 SPLASH_WINDOW_SIZE）。
fn splash_window_size(app: &tauri::AppHandle) -> (f64, f64) {
  clamp_to_monitor(app, SPLASH_WINDOW_SIZE)
}

/// 本次启动的形态：项目根、应用 URL、启动模式与前台开关。
///
/// 收成一个结构而不是在 `run()` 里摊开四个局部量：这些值**互相**决定解读方式
/// （`launch_mode` 缺席才谈得上自编排；自编排又决定前台默认值），摊平写会让
/// 「谁先谁后」只能靠阅读顺序维持。读环境变量这件事也在这里收口。
struct LaunchContext {
  project_root: String,
  app_url: String,
  /// 启动模式（standalone / prebuilt / tauri）。只在 release 的
  /// `setup_standalone_runtime` 里读（debug 下那段整体 cfg 掉了），因此这里
  /// 显式说明「不是死字段」——它的用途是决定「要不要拉起内嵌 server」。
  #[allow(dead_code)]
  /// 主窗「首帧看护」要不要注入加载占位：dev / prebuilt 下应用首帧必然晚于
  /// 导航（要等 next dev 首编译），而 standalone 的内嵌 server 随壳一起就绪，
  /// 注入占位只会白闪一下（见 `watch_main_first_paint`）。
  expect_slow_first_paint: bool,
  /// 本次是不是「双击壳」这条链路（= 没有人替壳做过编排决策）。
  ///
  /// 判据是 `COMFYAPP_PROJECT_ROOT` 缺席：它是**壳内所有编排决策的前置条件**
  /// （端口推导、单实例按检出隔离、编排脚本与日志路径都以它为锚点），只有壳自己
  /// 从 exe 位置推导出项目根时才会缺席 —— 那正是「双击 `target/release/app.exe`」。
  /// 用它而不是「`COMFYAPP_LAUNCH_MODE` 缺席」，是因为后者现在由壳自己写
  /// （`ensure_launch_mode`），在 `collect()` 之后才存在，判据会随写入顺序漂。
  self_launch: bool,
  foreground: bool,
}

impl LaunchContext {
  /// 按「单实例 → 路径 → 环境」的顺序收集。
  ///
  /// 双击壳时编排由壳自己补：起 dev-launcher.mjs、等它把服务拉起来、再把主窗
  /// 导航过去（见 `start_own_orchestrator`）。判据见 `self_launch` 字段。
  /// **release 才做**：debug 下的壳归 `pnpm tauri dev` 管，那时 dev server 由
  /// beforeDevCommand 起着，壳再抢一次编排就会两边争同一个端口。
  ///
  /// `self_launch` 由 `run()` 在**回填环境变量之前**捕获后传进来（见
  /// `publish_project_root_env`）：判据是「本次双击有没有外部注入者」，
  /// 而回填之后这个判据就永远为假了 —— 在 collect 里重算等于把判据变成常量。
  fn collect(self_launch: bool) -> Self {
    let project_root = resolve_project_root();
    // 开发模式默认跳本地 Next.js dev server；脚本 / 终端调用可经环境变量注入。
    // 生产模式在 spawn_sidecar 中更新为实际 sidecar 端口。
    let app_url = std::env::var("COMFYAPP_DEV_URL")
      .unwrap_or_else(|_| default_dev_url("localhost"));
    // 启动模式（standalone / prebuilt）此时可能还没定：`ensure_launch_mode`
    // 在 setup 里按「编排器在不在」写它（那是**唯一读取点**）。这里只在
    // 显式传入时用它推导首帧看护。
    let launch_mode = std::env::var("COMFYAPP_LAUNCH_MODE").unwrap_or_default();
    if self_launch {
      log::info!(
        "[ComfyAPP] no external launcher owns this process (COMFYAPP_PROJECT_ROOT absent): \
         the shell orchestrates the dev stack itself (single-exe double click, ISSUE #784)"
      );
    }
    // 是否允许启动完成时把应用窗口顶到前台。默认 false（不打断用户正在看的
    // 内容：启动要几十秒，用户常已切去别处）；脚本 / 终端调用可注入
    // COMFYAPP_FOREGROUND=1 覆盖。真正的「唤起」走壳自己的第二个进程
    // （single_instance 的 focus 通道），见 docs/standards/launch-and-build.md §1.3。
    let foreground = shell_launch::read_foreground_env()
      .unwrap_or_else(shell_launch::decide_front_when_self_launched);
    Self {
      expect_slow_first_paint: launch_mode != "standalone",
      project_root,
      app_url,
      self_launch,
      foreground,
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  /* CLI 形态（保活拉起的中介）必须在**任何**壳初始化之前分叉出去：它只做一次
   * CreateProcess 就退出，不该建窗口、不该认领单实例身份、也不该去拉编排器
   * （见 `detached_spawn` 模块头）。 */
  if let Some(code) = detached_spawn::run_from_args() {
    std::process::exit(code);
  }
  // 「本次是不是双击壳」必须在回填项目根**之前**判定：判据挂在
  // COMFYAPP_PROJECT_ROOT 缺席上（见 LaunchContext::self_launch），而下面这行
  // 回填会让它永远不再缺席。先取判据、再回填，顺序反过来就是把判据变成常量。
  let resolved_root = resolve_project_root();
  let self_launch = cfg!(not(debug_assertions))
    && std::env::var("COMFYAPP_PROJECT_ROOT").is_err()
    && !resolved_root.is_empty();
  // 项目根必须在**任何**后续读取点之前定下来：单实例身份与端口推导
  // （single_instance::identity_root）在下一行就要用，而双击场景下这是唯一一次
  // 机会（见 publish_project_root_env 的注释）。
  publish_project_root_env(&resolved_root);
  publish_shell_exe_env();

  // 按检出单实例（§1.4）：同一检出的壳已在跑时，向其发送「唤起前台」事件后
  // 退出；不同检出的壳互不可见、各自独立运行。必须在建窗口之前判定。
  if single_instance::another_instance_running() {
    log::info!(
      "[ComfyAPP] another instance of this checkout is running, focus requested and exiting \
       (this launch did not start a window; the running instance was brought to front)"
    );
    return;
  }
  let LaunchContext {
    project_root,
    app_url,
    expect_slow_first_paint,
    self_launch,
    foreground,
  } = LaunchContext::collect(self_launch);

  // 先写本次启动的会话标记，日志面板随后据此只展示本次启动内容。
  // 必须在 build_log_plugin 之前：该函数不依赖日志插件，直接写 shell-launch.log。
  shell_launch::log_session_start(&project_root);

  let log_plugin = build_log_plugin(&project_root);

  let app = tauri::Builder::default()
    .plugin(build_window_state_plugin())
    .plugin(log_plugin)
    // 应用自更新：设置页「检测更新 / 更新并重启」入口（见 app-update-client.ts）。
    // 更新源与签名公钥在 tauri.conf.json 的 plugins.updater 配置；无有效端点时
    // check() 会返回无更新，前端据此降级提示。
    .plugin(tauri_plugin_updater::Builder::new().build())
    // 进程重启：更新安装完成后调 relaunch 使新版本生效；也供「重启应用」按钮用。
    .plugin(tauri_plugin_process::init())
    // 子进程管理（standalone sidecar 的拉起与回收）：官方 shell 插件按平台
    // 选择机制，跨平台回收不必自己写两套（见 spawn_sidecar / kill_sidecar）。
    // 安全取向：**不把 shell 命令暴露给前端**（caps 里不授 shell:allow-execute /
    // allow-spawn），只有壳内 Rust 代码经 ShellExt 使用，前端窗口拿不到执行能力。
    .plugin(tauri_plugin_shell::init())
    // 两份 project_root：一份进 AppState（命令与 sidecar 回收用），一份留给
    // setup 闭包（自编排要按项目根拼编排脚本路径）。`clone` 是**必要的**——
    // 上面那条 `let LaunchContext { project_root, .. } = ...` 把所有权拆出来了，
    // 而 manage 会把它移进状态里，闭包再引用就是 use-after-move。
    .manage(AppState::new(project_root.clone(), app_url, foreground))
    .invoke_handler(tauri::generate_handler![
      get_launch_status,
      navigate_to_app,
      get_app_url,
      get_launch_log,
      set_splash_compact,
      win_close,
      win_minimize,
      open_comfyui_window,
      activate_main_window,
      should_activate_on_launch
    ])
    // setup 闭包要求 `'static`：它要活到应用退出，因此引用的局部变量必须**捕获
    // 所有权**（`move`），否则 `expect_slow_first_paint` 这类按值传入的局部量会在
    // 闭包借用检查时直接编译不过（`closure may outlive the current function`）。
    // `launch_mode` 只走引用（见下方的 `&launch_mode`），`move` 一并捕获所有权，
    // 两者都在此之后不再被用到。
    .setup(move |app| {
      // run() 只做装配，启动编排按职责拆成命名步骤（原先整段塞在 setup 闭包里，
      // 单函数近 300 行，而 Rust 侧没有函数长度门禁——见 §12.13 / ISSUE #536 P4）。
      // 顺序是契约：先收二次启动事件并定启动页尺寸，再建隐藏的 main 窗并挂其加载
      // 完成回调，接着挂「关启动页 = 放弃启动」与看门狗，最后才是生产模式
      // sidecar 与托盘。
      setup_splash_window(app);

      if self_launch {
        start_self_orchestration(app, &project_root);
      }

      // ── 方向 B：启动页与「应用」窗口分离 ──
      // 配置里的 splash 窗口仅显示启动进度；「应用」窗口（label="main"）在此创建
      // 为隐藏窗口，先停在 about:blank，由启动页探测后端就绪后经 navigate_to_app
      // 导航到应用 URL，加载完成后由 create_main_window 里挂的回调交换窗口。
      create_main_window(app)?;
      watch_main_first_paint(app.handle().clone(), expect_slow_first_paint);

      install_splash_close_handler(app);
      spawn_splash_watchdog(app);

      #[cfg(not(debug_assertions))]
      setup_standalone_runtime(app)?;

      // 托盘是「窗口只在任务栏、用户又切走了」时的兜底唤起入口：创建失败
      // （缺图标资源 / 系统限制）只记 WARN，绝不能让整个应用起不来。
      if let Err(e) = build_tray(app.handle()) {
        log::warn!("[ComfyAPP] tray icon not created: {:?}", e);
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(handle_run_event);
}

/// 双击壳（唯一的启动入口形态）：承担原先 Python 启动器的那一段编排。
///
/// 顺序是契约，抽成一个命名步骤而不是塞在 `setup` 闭包里（Rust 侧同维度阈值
/// 120 行，见规范 §12.13）：
///   1. **先定运行模式**（编排器在 = prebuilt，不在 = standalone）—— 它在
///      `setup_standalone_runtime` 之前定好，否则 standalone 壳不会去拉内嵌 server；
///   2. **再在磁盘上留痕**：「壳已接手」这一时刻必须可查（编排器写第一份
///      run/launch-status.json 之前有 1~2 秒空档，而 release 壳没有控制台，
///      那时启动页与日志面板会**什么都读不到**，ISSUE #784 手验反馈）。
///      写的是 fallback 快照（带启动报告）+ 编排链路日志，编排器一旦写自己的
///      状态就把快照顶掉，因此它不会与权威进度争；
///   3. **回收上一次的残留**：壳被强杀时 job 与进程组都可能落空，遗留的编排器
///      会占着端口 → 表现为双击没反应；
///   4. **最后起编排器**。**不留「命中的就跳过」的捷径**：两个 `app.exe` 同时
///      双击的场景已由 run() 早期的单实例判定拦下（第二个进程不建窗口就退出）。
fn start_self_orchestration(app: &mut tauri::App, project_root: &str) {
  shell_launch::ensure_launch_mode(project_root);
  const PHASE_NOTE: &str = "壳已接手（双击 app.exe）";
  shell_launch::write_idle_status(
    project_root,
    "shell-prepare",
    "桌面壳已接手启动编排，正在检查这个检出能不能自己起…",
    Some(shell_launch::startup_report_json(project_root, PHASE_NOTE)),
  );
  shell_launch::log_startup_report(project_root, PHASE_NOTE);
  if let Some(pid) = shell_launch::find_owned_orchestrator() {
    log::warn!(
      "[ComfyAPP] 上一次运行遗留的编排器仍在跑（pid {pid}），先回收它再启动本次编排"
    );
    shell_launch::reap_pid(project_root, pid);
  }
  start_own_orchestrator(app.handle(), project_root);
}

/// 自编排：由壳自己起 dev-launcher.mjs，并把「服务就绪」这一步接到启动页那条
/// 现成的链上（启动页轮询 `get_launch_status` → 就绪后调 `navigate_to_app`）。
///
/// 为什么不等别的启动器：**没有别的启动器了**（Python 启动器已随本 ISSUE 移除）。
/// 旧行为是「直接双击 `target/release/app.exe` 时没人编排，壳加载
/// `tauri.conf.json` 的静态 devUrl（兜底 127.0.0.1:3100），没服务就显示 Edge
/// 错误页」，用户看到的是「双击了，弹了个坏页面」。
///
/// 编排器起不来时**不发导航**：主窗始终停在 `about:blank`，启动页把原因写在面板上
/// （`mark_launch_failed`），日志面板里就是 node 打印的第一现场（`[orchestrator] …`）。
/// 关键是别再犯旧行为那一步——把主窗导航到一个必然连不上的地址，等于把
/// 「还在启动」说成「坏了」。
fn start_own_orchestrator(app: &tauri::AppHandle, project_root: &str) {
  if !shell_launch::can_self_launch(project_root) {
    // 自编排是**唯一**的启动路径：这里起不来就没有第二条路可退。把原因与修法
    // 写到启动页上（原先由 Python 启动器的 msgbox 承担这个出口），别让用户对着
    // 一个停在「正在启动」的窗口猜。
    shell_launch::mark_launch_failed(
      project_root,
      "找不到启动编排器（scripts/dev-launcher.mjs）或依赖未安装。\n\
       请确认 app.exe 位于项目根的 src-tauri/target/release/ 下，并先执行 pnpm install。",
    );
    return;
  }
  match shell_launch::spawn_orchestrator(app, project_root) {
    Ok(()) => {
      log::info!(
        "[ComfyAPP] 壳已自行启动编排器（node scripts/dev-launcher.mjs --mode prebuilt），\
         这份编排器随壳退出一起回收"
      );
      // 编排器已拉起、还没写第一份状态：把快照推进到这一档，启动页于是能说出
      // 「在等谁」，而不是让用户对着「暂时读不到日志」猜。
      shell_launch::write_idle_status(
        project_root,
        "shell-orchestrating",
        "编排器已启动，正在等待本地服务就绪（诊断见「查看日志」）…",
        None,
      );
      shell_launch::log_launch_line(project_root, "info", "编排器已拉起，等待它写第一份状态");
      shell_launch::attach_kill_on_close_job();
    }
    Err(e) => {
      log::warn!(
        "[ComfyAPP] 壳自编排未能启动（{e}）；故障原因见本行之上的日志"
      );
      shell_launch::mark_launch_failed(
        project_root,
        &format!(
          "无法启动本地服务（node scripts/dev-launcher.mjs 未能拉起）：{e}\n\
           请确认已安装 Node.js / pnpm，详见 log/launcher/ 与 log/shell/shell.log。"
        ),
      );
    }
  }
}

/// 收二次启动的「唤起前台」事件，并把配置里的 splash 窗口收成「刚好装下内容」
/// 的一条后居中。
///
/// 尺寸为什么要收窄（ISSUE #412）：窗口即内容，启动期只在屏幕中央占一小块，
/// 不铺满屏幕留出大片空白；展开日志时由页面调 set_splash_compact(false) 放大。
fn setup_splash_window(app: &mut tauri::App) {
  // 按检出单实例：等待二次启动实例发来的「唤起前台」事件（见 run() 早期
  // 判定与 single_instance 模块注释）。
  single_instance::spawn_focus_waiter(app.handle().clone());

  let Some(splash) = app.get_webview_window("splash") else {
    return;
  };
  /* **只在显示器上限真的收窄了尺寸时才动窗口。**

   * 声明式窗口（tauri.conf.json 的 width/height/center）已经按同一档尺寸建好
   * 并居中过，这里无条件再 `set_size` + `center()` 一次就是**第二次居中** ——
   * 而两次居中的口径不同：配置那条按**客户区**居中，`center()` 用**外框**
   * （resizable 窗口的不可见边框，本机 150% 缩放下一侧 11px）。实测
   * 2560x1600：启动页 t=+0.25s 显示在 (722,602)，setup 执行到这一步时
   * （t=+1.6s）被挪到 (711,595) —— 差值正是边框，用户看到的是「黑框出现
   * 一会儿后自己挪了一下」。同一个坑在页面侧已经修过一次（见 splash.html
   * 的 applyCompact 注释）：**不允许出现第二个人去摆这个窗口**。
   *
   * 尺寸也只有收窄这一种情形需要壳出手；不收窄时连 `set_size` 都不该调
   * （同尺寸的 set_size 仍会走一次窗口重排）。 */
  let requested = SPLASH_WINDOW_SIZE;
  let (width, height) = splash_window_size(app.handle());
  if (width, height) != requested {
    log::info!(
      "[ComfyAPP] splash size clamped to monitor: {:.0}x{:.0} (requested {:.0}x{:.0})",
      width,
      height,
      requested.0,
      requested.1
    );
    let _ = splash.set_size(tauri::LogicalSize::new(width, height));
    let _ = splash.center();
  }
  bring_splash_to_front(&splash);
}

/// 启动页首次出现时把它带到前台。
///
/// 启动页与「应用」窗口是两种不同的语义，不能共用同一套「不抢前台」策略：
///
/// - **应用窗口**：启动要几十秒，用户完全可能切去干别的，加载完成再弹到最前面
///   就是打断（ISSUE #359）。所以它默认只 `show()` + 任务栏闪烁；
/// - **启动页**：它是用户**刚刚双击/点击启动**的直接反馈，此刻不给前台，
///   用户看到的就是「双击了没反应」，启动页被文件资源管理器之类的窗口压住
///   ——「双击后画面在资源管理器之后」正是这么来的（ISSUE #576）。一次启动
///   只抢这一次，且是**显示之后立即**抢，不是几十秒后突然冒出来。
///
/// 用 `set_focus()` 而不是 `always_on_top`：置顶是**持续**语义（窗口会一直压在
/// 别人上面，用户在启动期想切走也切不掉），而这里要的只是「出现的那一刻在前面」。
/// Windows 的前台锁定可能让 `set_focus()` 落空（用户刚在别的窗口上点过），
/// 此时补一次任务栏闪烁作为可见提醒，与主窗的策略保持一致。
fn bring_splash_to_front(splash: &tauri::WebviewWindow) {
  // 声明式窗口（tauri.conf.json 的 windows[0]）默认已可见，但显式 `show()` 一次
  // 更稳：某些窗口状态插件/系统还原会把首次显示推迟，未显示的窗口 set_focus 无意义。
  if !splash.is_visible().unwrap_or(true) {
    let _ = splash.show();
  }
  if let Err(e) = splash.set_focus() {
    log::warn!("[ComfyAPP] splash set_focus failed: {:?}", e);
    let _ = splash.request_user_attention(Some(tauri::UserAttentionType::Informational));
    return;
  }
  if splash.is_focused().unwrap_or(false) {
    log::info!("[ComfyAPP] splash window brought to front");
  } else {
    log::warn!("[ComfyAPP] splash window shown but foreground not granted");
    let _ = splash.request_user_attention(Some(tauri::UserAttentionType::Informational));
  }
}

/// 为什么 main 窗上必须调 `disable_drag_drop_handler`：不调，应用内拖不进图片 /
/// 工作流，而浏览器整窗打开同一个 ComfyUI 地址却是好的（ISSUE #616 的现场）。
///
/// 成因：宿主窗口默认挂着 **WebView2 的原生拖放处理器**（wry 的
/// `drag_drop_handler_enabled`，默认 true；tauri 的
/// `WebviewWindowBuilder::disable_drag_drop_handler` 的官方说明就是
/// 「Disables the drag and drop handler. **This is required to use HTML5 drag and
/// drop APIs on the frontend on Windows.**」）。它一接手，Chromium 就不再走自己
/// 的拖放路径：`dragover` / `drop` **不派发到 DOM**，文件被换成 wry 的回调
/// `on_drag_drop` —— 而本应用没有注册它，于是「拖进去一点反应都没有」。
/// 页签里的 ComfyUI 完全靠 `drop` 事件的 `dataTransfer.files`，它自己并不知道
/// 被壳托管着，所以看起来就是这个功能在应用里坏了（浏览器整窗打开没有这层壳，
/// 因此正常——这条对照就是最好的判据）。
///
/// 为什么在**宿主**窗口上关：命中测试落在宿主那个 WebView（`main`）上，iframe
/// 只是它内部的一块区域，被拖进来的文件由宿主这一层决定交给 DOM 还是交给原生
/// 处理器。ComfyUI 自己的独立窗口（`open_comfyui_window` 建的 `comfyui` 窗）
/// 不承载 iframe，保留默认。
///
/// 为什么可以放心关（本应用的壳侧**不消费**原生拖放）：窗口内没有一处需要原生
/// 文件拖入——项目画布与工作流库的拖放都是页内拖元素（自定义 dataTransfer），
/// 与文件拖入无关；壳侧也没有注册 `on_drag_drop`，`tauri://drag-drop` 事件
/// 无人监听。关掉它是纯收益：DOM 恢复正常拖放语义，同时少一层原生处理器。
/// **改回默认值 = 重新引入本缺陷**，门禁把它钉在
/// `tests/comfyui-embed-csp.test.ts`（同族还有页签内嵌的 CSP 放行断言）。

/// 把上一次运行记住的几何（尺寸 / 位置 / 最大化）套用到主窗。
///
/// **调用点必须是「窗口本来就要显示」的那一刻**（见 `show_main_window_without_focus`
/// 的首次显示分支），不能在窗口还该隐藏时提前调：插件的 `maximized` 分支是
/// `window.maximize()`，Windows 上这个调用**自带显示语义**，会当场把窗口显示出来
/// —— 实测启动期整屏闪一下。
///
/// 「提前套用、随后马上 hide 回去」这条看似可行的绕法实测**更差**：`maximize()`
/// 自身要跑几百毫秒（要等窗口过程与 WebView2 宿主应答），实测窗口可见 379ms
/// （原缺陷是 95ms）。判据钉在 `window_startup_tests` 里，别把它改回去。
///
/// 为什么不自己存一份几何：窗口几何是用户的偏好，插件已经记着（本机实测 main
/// 记着 maximized + 1920x1200），再存一份就又多了一个事实源（§12.18）。
fn apply_saved_main_window_state(win: &tauri::WebviewWindow) {
  use tauri_plugin_window_state::WindowExt;
  if let Err(e) = win.restore_state(window_state_flags()) {
    log::warn!("[ComfyAPP] restore main window geometry failed: {:?}", e);
  }
  log::info!(
    "[ComfyAPP] main window geometry restored (visible={} maximized={})",
    win.is_visible().unwrap_or(false),
    win.is_maximized().unwrap_or(false)
  );
}

/// 创建隐藏待命的「应用」窗口（label="main"），并挂上「页面加载完成即交换窗口」回调。
///
/// main 停在 about:blank，等启动页探测到后端就绪后经 navigate_to_app 导航；真正
/// 导航到应用 URL 且加载完成（on_page_load Finished）时才显示 main、关闭 splash，
/// 启动页因而会一直显示到应用首屏真正可见（不再出现「启动完成却还要等很久」）。
fn create_main_window(app: &mut tauri::App) -> tauri::Result<()> {
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
    // 首次显示必须「不激活」：tao 对 focused(false) 的窗口在首次 show() 时走
    // ShowWindow(SW_SHOWNOACTIVATE)（见 tao window_state.rs 的
    // MARKER_DONT_FOCUS），窗口进任务栏但不向前台要焦点——否则交接瞬间
    // show() 自带的激活语义会由 Windows 把前台放行给主窗，「不打断用户」
    // 的策略在启动页关闭那一刻被架空（表现为双击启动完成后窗口弹到最前）。
    // 显式唤起（托盘 / 二次启动 / 启动器判决给前台）仍走 set_focus()，
    // 不受本标记影响。
    .focused(false)
    // 关掉 WebView2 的**原生拖放拦截**：不关，页签里的 ComfyUI 收不到 HTML5
    // 拖放事件，图片/工作流拖进去毫无反应（浏览器整窗打开同一地址却正常）。
    // 判据与查证方式见 `main_window_native_drag_disabled`（函数注释里写全了
    // 「为什么 wry 的默认值是 true」与改回默认值的后果）。
    .disable_drag_drop_handler()
    .on_page_load(move |_win, payload| {
      if payload.event() == tauri::webview::PageLoadEvent::Finished {
        on_main_page_finished(&app_handle_for_page, payload.url().clone());
      }
    })
    .build()?;
  Ok(())
}

/// main 窗口「加载完成」时的交接判定。
///
/// 只在页面**真正**是应用 URL（http/https）时才交换：忽略初始 about:blank /
/// 空 URL / 内部错误页，避免主窗提前显示在黑屏的 about:blank 上。导航失败
/// （连接被拒 / 服务又挂掉）时 WebView2 也会以 http URL 触发 Finished，页面内容
/// 是内嵌的 Edge「无法访问此页面」错误页——历史上它曾被当成「应用加载完成」直接
/// 顶给用户，因此交换前用 TCP 可达性做二次校验：不可达就不交换，交给重导航循环，
/// 保持启动页可见。
fn on_main_page_finished(handle: &tauri::AppHandle, url: tauri::Url) {
  let url_str = url.as_str();
  log::info!("[ComfyAPP] main window Finished: {}", url_str);
  if url_str.is_empty()
    || url_str.starts_with("about:blank")
    || url_str.starts_with("tauri://")
    || url_str.starts_with("https://tauri.localhost")
    || (!url_str.starts_with("http://") && !url_str.starts_with("https://"))
  {
    log::debug!("[ComfyAPP] ignoring initial/non-app page load");
    return;
  }
  log::info!("[ComfyAPP] app page loaded, swapping windows");
  // 用户已在启动期关闭启动页（放弃本次启动）：壳正在退出，别再把主窗显示出来
  // （否则用户关闭后过一会儿窗口又自己冒出来）。
  let abandoned = handle
    .try_state::<AppState>()
    .map(|s| s.is_abandoned())
    .unwrap_or(false);
  if abandoned {
    log::info!("[ComfyAPP] launch abandoned by user, skip window swap");
    return;
  }
  if !url_reachable(&url) {
    log::warn!("[ComfyAPP] swap aborted, app url unreachable: {}", url_str);
    // 页面是内嵌错误页时占位会被导航冲掉：再补一次，直到重导航把真页面带回来
    watch_main_first_paint(handle.clone(), true);
    spawn_renavigate(handle.clone(), url);
    return;
  }
  // 交接的这一刻就把占位清掉，别让它多压一帧真界面；应用侧在根布局挂载时
  // 还会再清一次（两道都失败时占位最多自存 20s，见 MAIN_LOADING_STUB_JS）。
  if let Some(main) = handle.get_webview_window("main") {
    main_window_clear_loading_stub(&main, "swap");
  }
  // 启动期可能已过了几十秒，用户很可能切到了别的窗口：这里只把应用显示到
  // 任务栏并做闪烁提醒，不把窗口顶到前台（见 show_main_window_without_focus）。
  show_main_window_without_focus(handle, false);
  if let Some(s) = handle.get_webview_window("splash") {
    let _ = s.close();
  }
}

/// 启动页关闭 = 放弃本次启动，整个应用直接退出。
///
/// 主窗在 setup 时就已创建（隐藏待命）：只关 splash 会让壳带着一个看不见的主窗
/// 继续活着（任务栏图标挂着、dev server 继续被拉起，还会在服务就绪后把主窗又弹
/// 出来）。因此启动页的关闭请求到达而主窗仍未显示时，标记「已放弃」并退出整个壳
/// 进程——dev server 整棵树随壳一起被回收（编排器就是壳的子进程，见 `shell_launch`），
/// 任务栏不再残留。
/// 正常交接（壳自己关启动页）时主窗已经显示，走不到这条退出路径。
fn install_splash_close_handler(app: &mut tauri::App) {
  let handle_for_splash_close = app.handle().clone();
  if let Some(splash_for_close) = app.get_webview_window("splash") {
    splash_for_close.on_window_event(move |event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        let main_visible = handle_for_splash_close
          .get_webview_window("main")
          .map(|m| m.is_visible().unwrap_or(false))
          .unwrap_or(false);
        if main_visible {
          return;
        }
        if let Some(state) = handle_for_splash_close.try_state::<AppState>() {
          state.mark_abandoned();
        }
        log::info!(
          "[ComfyAPP] splash closed while main window hidden, exiting app (launch abandoned)"
        );
        handle_for_splash_close.exit(0);
      }
    });
  }
}

/// 启动页看门狗（仅 custom-protocol 构建）。
///
/// custom-protocol 关闭时（tauri dev），tauri 的 cfg(dev) 开启，窗口相对 URL
/// 解析到 build.devUrl——启动页由 dev server 提供，那是 dev 模式的预期。
/// custom-protocol 开启时（正式壳，cargo build --release --features
/// custom-protocol），启动页加载编译期内嵌资源；页面一旦被任何导航带走
/// （错误页 / 其它地址），页内 JS 全部失效，进度/日志界面无法自愈，只能干等
/// main 加载完成后交换窗口。看门狗每秒检查启动页当前 URL，偏离内嵌资源地址就
/// 导航回去，保证进度界面必然恢复。
#[cfg(feature = "custom-protocol")]
fn spawn_splash_watchdog(app: &mut tauri::App) {
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
      /* 启动页的 WebView 没起来（现场：WebView2 建窗报 0x80070057 参数错误）：
       * 窗口对象在、但 `url()` 永远是空 / about:blank，页面 JS 从不执行，于是
       * 没人会调 `navigate_to_app`。此时再等下去也没有出口，改走「无启动页」
       * 兜底（等应用端口就绪 → 导航主窗 → 显示主窗）。 */
      log::warn!(
        "[ComfyAPP] splash watchdog: base url not seen in 5s（启动页 WebView 未生效），回退到「无启动页」兜底"
      );
      fallback_without_splash(&handle);
      return;
    };
    log::info!("[ComfyAPP] splash watchdog: base url {}", splash_url);
    for _ in 0..300 {
      std::thread::sleep(Duration::from_millis(1000));
      let Some(s) = handle.get_webview_window("splash") else { return };
      // 判据只有一条：当前 URL 不是内嵌的启动页地址。**必须排除「窗口已不可用」**
      // ——url() 出错（窗口正在销毁）时不能当作「漂移了」再导航回去，否则交接
      // 瞬间的关闭动作会被这条看门狗抢回去。
      match s.url() {
        Ok(cur) if cur == splash_url => {}
        Ok(cur) => {
          log::warn!("[ComfyAPP] splash watchdog: url drifted to {}, restoring", cur);
          if let Err(e) = s.navigate(splash_url.clone()) {
            log::warn!("[ComfyAPP] splash watchdog: restore failed: {:?}", e);
          }
        }
        Err(e) => {
          log::debug!("[ComfyAPP] splash watchdog: url unavailable ({:?})", e);
        }
      }
    }
  });
}

/// custom-protocol 关闭时（tauri dev）不需要看门狗：启动页由 dev server 提供，
/// URL 漂移即预期行为。留同名空实现，使启动编排调用点无需按 feature 分叉。
#[cfg(not(feature = "custom-protocol"))]
fn spawn_splash_watchdog(_app: &mut tauri::App) {}

/// 生产模式（release）启动编排：按启动模式决定是否拉起内嵌 standalone server，
/// 并在启动页资源缺失时走「等应用就绪直接导航」的兜底，避免永久黑屏。
#[cfg(not(debug_assertions))]
fn setup_standalone_runtime(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
  // 启动模式的**唯一读取点**就在本函数里（原先由 run() 读一次再传进来，于是
  // 同一个环境变量在两处被解读，改一处判据就会悄悄分叉）。
  let launch_mode = std::env::var("COMFYAPP_LAUNCH_MODE").unwrap_or_default();
  if launch_mode == "standalone" {
    // standalone（检出里没有编排器）：必须启动内嵌 server（缺失时 spawn_sidecar 会报错）。
    spawn_sidecar(app.handle())?;
  } else {
    // prebuilt：壳直接加载 COMFYAPP_DEV_URL（由 dev-launcher.mjs 起 dev server），
    // 不启动 standalone sidecar。
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
    log::warn!("[ComfyAPP] splash.html 未嵌入，启动页不可用，走「无启动页」兜底");
    fallback_without_splash(app.handle());
  }
  Ok(())
}

/// 应用运行期事件回调。
///
/// 退出时回收 sidecar 进程树；退出请求时对「窗口只显示到任务栏、用户从未点开过」
/// 的情形补一条日志，便于对照「双击了却没看到界面」的反馈。关窗即退出，不做
/// 「最小化到托盘」。
fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
  match event {
    tauri::RunEvent::Exit => {
      let root = app.state::<AppState>().project_root();
      // 先收自己起的编排器（它下面还挂着 dev server 整棵树），再收 standalone
      // sidecar：前者是 dev/prebuilt 链路的根，后者只在内嵌 server 模式存在。
      if shell_launch::is_owning() {
        log::info!("[ComfyAPP] exiting, reaping the orchestrator started by this shell");
        shell_launch::reap(&root);
      }
      #[cfg(not(debug_assertions))]
      kill_sidecar(&root);
    }
    tauri::RunEvent::ExitRequested { code, .. } => {
      /* 壳的退出码是「谁结束了这次启动」在壳侧唯一可靠的出口：prebuilt 链路里
       * dev server 的退出码对三种成因完全一样（见 dev-launcher.mjs 的
       * downstreamExitKind），而壳写下的这一行会随 stderr 进
       * log/launcher/dev-launcher-stderr.log，启动器能据此把「壳自己退出」与
       * 「壳被杀」分开。异常码（0 以外的）一律记 warn：正常路径是交接完成后
       * 关主窗（code=None）与「关掉启动页 = 放弃启动」（exit(0)）。 */
      match code {
        Some(c) if c != 0 => log::warn!(
          "[ComfyAPP] exiting with non-zero code {c} (kernel/user forced termination or startup failure)"
        ),
        None => {
          if let Some(state) = app.try_state::<AppState>() {
            if state.take_attention() {
              log::info!(
                "[ComfyAPP] exiting while the window was only shown in the taskbar (never opened by the user)"
              );
            }
          }
        }
        _ => {}
      }
    }
    _ => {}
  }
}

/// 项目根推导的回归测试（ISSUE #784 手验反馈）。
///
/// 这组用例存在的理由：**唯一入口的落位与「项目根在哪儿」差着三层目录**，
/// 而判据一旦退回「只看 exe 同级」，表现不是崩溃而是启动页永远停在 0% + 一句
/// 指向不存在文件的提示 —— 从用户视角看是「双击没反应」，从代码视角看每一行
/// 都「是对的」。因此这里用真实临时目录把**目录层数**钉住：假检出放在
/// `<tmp>/src-tauri/target/release/` 下，与规范 §1 的落位同形。
#[cfg(test)]
mod project_root_tests {
  use super::*;

  /// 造一个「假检出」：含 `package.json` 与 `scripts/dev-launcher.mjs`
  /// （`looks_like_project_root` 认的两个标识）。
  fn make_checkout(dir: &std::path::Path) {
    std::fs::create_dir_all(dir.join("scripts")).unwrap();
    std::fs::write(dir.join("package.json"), "{}").unwrap();
    std::fs::write(dir.join("scripts").join("dev-launcher.mjs"), "").unwrap();
  }

  fn temp_root(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("comfyapp-projroot-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn walks_up_from_the_exe_directory_to_the_checkout_root() {
    // 这一条就是 ISSUE #784 的现场：exe 在 `target/release` 下，
    // 项目根在上溯三级的地方。只看同级 = 永远推不出来。
    let tmp = temp_root("walk");
    let checkout = tmp.join("checkout");
    let release = checkout.join("src-tauri").join("target").join("release");
    std::fs::create_dir_all(&release).unwrap();
    make_checkout(&checkout);

    assert_eq!(
      find_project_root_from(&release),
      Some(checkout.clone()),
      "从 exe 所在目录必须能上溯到检出根"
    );
    // 起点本身就是检出根时应原样返回（standalone 情形：exe 与检出同层）。
    assert_eq!(find_project_root_from(&checkout), Some(checkout.clone()));
    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn returns_none_outside_any_checkout() {
    // 反例必须真的返回 None：否则「随便哪个目录都能当项目根」，
    // 编排器路径、日志目录、端口推导全都会指到无关位置。
    let tmp = temp_root("none");
    let stray = tmp.join("somewhere").join("else");
    std::fs::create_dir_all(&stray).unwrap();
    assert_eq!(find_project_root_from(&stray), None);
    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn needs_both_marker_files() {
    // 两个标识缺一不可：只有 `scripts/` 的目录（比如某个工具仓库）
    // 不能被当成检出 —— 认错了就会去它那儿找编排器与日志目录。
    let tmp = temp_root("markers");
    let half = tmp.join("half");
    std::fs::create_dir_all(half.join("scripts")).unwrap();
    std::fs::write(half.join("package.json"), "{}").unwrap();
    assert_eq!(find_project_root_from(&half), None, "缺 dev-launcher.mjs 不算检出");

    make_checkout(&half);
    assert_eq!(find_project_root_from(&half), Some(half.clone()));
    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn documented_entry_location_resolves_root_and_port() {
    // 端到端复现用户现场：exe 就在规范 §1 的**唯一入口落位**
    // （`<检出>/src-tauri/target/release/`）下。修好前这一步推出的是空串 ——
    // 于是启动页写着「项目根未推导出来」并停在 0%，壳日志与状态文件全无去处。
    let tmp = temp_root("e2e");
    let checkout = tmp.join("comfy-app-t3");
    let release = checkout.join("src-tauri").join("target").join("release");
    std::fs::create_dir_all(&release).unwrap();
    make_checkout(&checkout);

    let found = find_project_root_from(&release).expect("唯一入口的落位必须能推出检出根");
    assert_eq!(found, checkout);

    // 项目根同时也是端口推导的锚点：推不出来时端口会落在与检出无关的值上，
    // dev server 与启动页于是各自等一个不同的端口（「一直卡住」的另一半原因）。
    let port = crate::single_instance::derive_app_port_for_root(&found.to_string_lossy());
    assert!(
      (3200..4000).contains(&port),
      "推导端口必须落在约定区间，实际 {port}"
    );
    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn port_matches_node_side_for_same_root() {
    // 与 Node 侧 scripts/app-port.mjs 的 derivePortFromPath 同输入同输出。
    assert_eq!(crate::single_instance::derive_app_port_for_root("/x/comfy-app-t3"), 3723);
  }

  #[test]
  fn root_resolution_never_only_looks_at_one_level() {
    // 形态判据（源码级）：`resolve_project_root` 必须经过上溯函数，
    // 而不是回到「只看 `exe.parent()` 一层」的老写法。
    let src = include_str!("lib.rs");
    let body = &src[src.find("fn resolve_project_root()").unwrap()..];
    let body = &body[..body.find("\n}\n").unwrap()];
    assert!(
      body.contains("find_project_root_from"),
      "项目根推导必须逐级上溯：{body}"
    );
    assert!(
      !body.contains("looks_like_project_root(dir)"),
      "不得退回「只查 exe 同级目录」的写法：{body}"
    );
  }
}

/// 启动期窗口行为的回归测试。
///
/// 这两条缺陷的共同点：**判据没法用运行期断言表达**——「启动页有没有被挪
/// 一下」「主窗有没有闪一下」需要一个真实窗口、一块真实显示器与一双眼睛
/// （实测手段见本节各用例的注释：一个 20ms 采样的窗口矩形探针）。因此判据
/// 落在**源码形态**上：把「谁来摆这个窗口」「谁在什么时候套用几何」钉死，
/// 改回旧写法即在 `cargo test` 阶段被拦下。
#[cfg(test)]
mod window_startup_tests {
  use super::*;

  /// 取 `include_str!("lib.rs")` 里从 `marker` 到下一个顶层 `}` 的源码片段
  /// （与 `root_resolution_never_only_looks_at_one_level` 同一手法）。
  fn fn_body(marker: &str) -> String {
    let src = include_str!("lib.rs");
    let start = src.find(marker).unwrap_or_else(|| panic!("找不到 {marker}"));
    let rest = &src[start..];
    rest[..rest.find("\n}\n").unwrap()].to_string()
  }

  #[test]
  fn splash_is_never_recentered_after_the_config_placed_it() {
    // 现场（2560x1600，150% 缩放）：启动页 t=+0.25s 由声明式窗口显示在 (722,602)，
    // 而 setup 到 t=+1.6s 才执行 —— 那里的 `set_size` + `center()` 是**第二次
    // 居中**：配置那条按客户区算，`center()` 按外框算（一侧 11px 边框），
    // 于是窗口在用户眼前挪到 (711,595)。
    let body = fn_body("fn setup_splash_window");
    let guard = body.find("!= requested").expect(
      "尺寸没被显示器收窄时必须整段跳过窗口调整（重新居中 = 肉眼可见地挪一下）",
    );
    // 认**调用形态**（带接收者），不认裸标识符：本函数的注释里就写着 `set_size` /
    // `center()` 这两个词，按裸词找会命中注释、把判据变成永远通过（第一版实测如此）。
    let resize = body
      .find("splash.set_size(")
      .expect("收窄分支仍要能调尺寸");
    let center = body.find("splash.center()").expect("收窄分支仍要能重新居中");
    assert!(resize > guard, "set_size 必须在「收窄了」判断之后：{body}");
    assert!(center > guard, "center() 必须在「收窄了」判断之后：{body}");
  }

  #[test]
  fn main_window_geometry_is_applied_at_the_handover_moment() {
    // 现场：插件在「窗口就绪」时还原几何，其 `maximized` 分支 `window.maximize()`
    // 在 Windows 上会把隐藏窗口显示出来 —— 实测 t=+2.7s 出现一个铺满屏幕的可见
    // 主窗（(-11,-11,2582,1550)），95ms 后被建窗流程重新隐藏。
    let plugin = fn_body("fn build_window_state_plugin");
    assert!(
      plugin.contains("skip_initial_state(\"main\")"),
      "插件不得在窗口就绪时还原 main 的几何（maximize() 会把隐藏窗口显示出来）：{plugin}"
    );

    let show = fn_body("fn show_main_window_without_focus");
    assert!(
      show.contains("if first_show {") && show.contains("apply_saved_main_window_state(&win)"),
      "套用几何必须发生在「首次显示」这一刻：{show}"
    );

    // 「提前套用 + 随后 hide 回去」这条绕法实测更差（maximize() 自身要跑几百
    // 毫秒，窗口可见 379ms > 原缺陷的 95ms），不许再改回去。
    let apply = fn_body("fn apply_saved_main_window_state");
    assert!(
      apply.contains("restore_state"),
      "套用几何必须经窗口状态插件（不许自己再存一份几何）：{apply}"
    );
    assert!(
      !apply.contains(".hide()"),
      "不许用「先显示再藏回去」绕：maximize() 的显示窗口期实测 379ms，比原缺陷更久：{apply}"
    );
  }

  #[test]
  fn splash_config_size_matches_the_shell_constant() {
    // 声明式窗口的尺寸与壳里的常量必须同值：壳只在「显示器上限把尺寸收窄了」
    // 时才动窗口（见 setup_splash_window），两者一旦分叉，正常屏幕上就会变成
    // 「建窗按配置、判断按常量」—— 每次启动都白走一次调整（= 挪一下）。
    let conf: String = include_str!("../tauri.conf.json")
      .chars()
      .filter(|c| !c.is_whitespace())
      .collect();
    assert!(conf.contains(r#""label":"splash""#), "splash 窗口不见了：{conf}");
    assert!(
      conf.contains(&format!(r#""width":{}"#, SPLASH_WINDOW_SIZE.0 as u32)),
      "tauri.conf.json 的 splash 宽度必须等于 SPLASH_WINDOW_SIZE.0"
    );
    assert!(
      conf.contains(&format!(r#""height":{}"#, SPLASH_WINDOW_SIZE.1 as u32)),
      "tauri.conf.json 的 splash 高度必须等于 SPLASH_WINDOW_SIZE.1"
    );
  }

  #[test]
  fn unavailable_splash_falls_back_to_navigate_when_ready() {
    // 现场（2026-09-23）：WebView2 建启动页的 webview 失败（HRESULT
    // 0x80070057「参数错误」），资源在（`has_splash == true`）但页面 JS 从不执行
    // → 没人调 `navigate_to_app` → 主窗停在 `about:blank`（隐藏态没有任务栏图标，
    // 从托盘唤起看到的就是白屏）。「资源存在性」这条判据看不见这种形态，因此
    // 「启动页跑不起来」必须与「启动页不存在」走同一条兜底。
    let watchdog = fn_body("fn spawn_splash_watchdog");
    assert!(
      watchdog.contains("base url not seen in 5s") && watchdog.contains("fallback_without_splash"),
      "启动页 WebView 没起来时必须走「无启动页」兜底，而不是打一条日志就返回：{watchdog}"
    );

    let setup = fn_body("fn setup_standalone_runtime");
    assert!(
      setup.contains("fallback_without_splash"),
      "「资源缺失」与「WebView 没起来」必须共用同一条兜底：{setup}"
    );

    let fallback = fn_body("fn fallback_without_splash");
    assert!(
      fallback.contains("navigate_when_ready") && fallback.contains("app_url"),
      "兜底必须落到 navigate_when_ready（等应用就绪 → 导航主窗 → 显示主窗），并取到应用地址：{fallback}"
    );
  }
}

#[cfg(test)]
mod log_filter_tests {
  use super::*;

  fn temp_log(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-log-filter-{name}-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("test.log")
  }

  #[test]
  fn tail_since_marker_returns_only_lines_after_last_marker() {
    let path = temp_log("since-marker");
    std::fs::write(
      &path,
      "[2026-09-22 11:00:00.000] [INFO] 旧的日志\n\
       === 启动会话开始（shell_pid: 1）===\n\
       [2026-09-22 11:01:00.000] [INFO] 上一次启动\n\
       === 启动会话开始（shell_pid: 2）===\n\
       [2026-09-23 04:15:00.000] [INFO] 本次启动\n",
    )
    .unwrap();

    let tail = tail_log_file_since_marker(&path, "=== 启动会话开始", 1024, 10).unwrap();
    assert!(!tail.contains("旧的日志"), "不应包含最旧启动的日志：{tail}");
    assert!(!tail.contains("上一次启动"), "不应包含上一次启动的日志：{tail}");
    assert!(tail.contains("本次启动"), "必须包含本次启动的日志：{tail}");
  }

  #[test]
  fn tail_since_marker_falls_back_to_plain_tail_when_no_marker() {
    let path = temp_log("no-marker");
    std::fs::write(
      &path,
      "[2026-09-22 11:00:00.000] [INFO] 第一行\n\
       [2026-09-22 11:01:00.000] [INFO] 第二行\n",
    )
    .unwrap();

    let tail = tail_log_file_since_marker(&path, "=== 启动会话开始", 1024, 1).unwrap();
    assert!(
      !tail.contains("第一行"),
      "无标记时应退回尾部截断：{tail}"
    );
    assert!(tail.contains("第二行"), "应保留最尾部的行：{tail}");
  }

  #[test]
  fn tail_since_marker_handles_empty_file() {
    let path = temp_log("empty");
    std::fs::write(&path, "").unwrap();
    let tail = tail_log_file_since_marker(&path, "=== 启动会话开始", 1024, 10).unwrap();
    assert!(tail.is_empty());
  }
}
