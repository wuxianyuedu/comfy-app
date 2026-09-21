//! 按检出隔离的单实例保护与端口推导（launch-and-build.md §1.4 多检出并行）。
//!
//! 为什么不用 tauri-plugin-single-instance：它的互斥量 / 消息窗口名取自**编译期**
//! identifier（com.comfyapp.desktop），是全机共享的——同一项目检出两份并行开发时，
//! 后启动的壳会把「已有实例」信号发给**另一份检出**的壳然后自己退出，永远起不来。
//! 这里把身份锚点换成「本检出」（COMFYAPP_PROJECT_ROOT，缺省 tauri dev 下的
//! cwd 父目录）：互斥量与焦点事件名都带检出哈希，单实例语义按检出隔离——
//! 同检出二次启动 → 唤起已有窗口；不同检出 → 各自独立运行。
//!
//! 端口解析与本模块同源（同一身份锚点）：与 scripts/app-port.mjs（Node）、
//! scripts/app-port.ps1（PowerShell）、scripts/app_port.py（Python）是同一
//! 算法的多语言实现，改动必须四处同步。取值优先级（launch-and-build.md §1.1）：
//!   1. 检出 `.env` 显式 `COMFYAPP_PORT`（**壳必须自己读**：它不经过 Node，
//!      只看 OS 环境变量就会漏掉用户写死在 `.env` 里的端口，见下）；
//!   2. 按检出绝对路径稳定推导——对「绝对路径、反斜杠转正斜杠、转小写」的
//!      UTF-8 字节取 FNV-1a 32 位哈希，映射到 3200..3999：
//!      port = 3200 + (fnv1a32(path) % 800)；
//!   3. 兜底 3100（仅在路径推导不可用的异常情况）。
//!
//! **为什么 `.env` 这一条不能只由 Node 一侧读**（ISSUE #821）：双击链路里壳是
//! 启动编排的**宿主**，编排器（`dev-launcher.mjs` → `dev.mjs`）继承的是壳注入的
//! 环境。壳若只认路径推导，用户在 `.env` 里写的固定端口就对壳不可见：编排器按
//! `.env` 在 3100 起 dev server，壳按路径推导在 3809 死等 —— 两边永远对不上，
//! 现象是启动页卡在「等 dev server」而服务其实已经在另一个端口上跑着。
//! 因此壳与 Node 侧读**同一处、同一优先级**，上游显式注入（`COMFYAPP_PORT`
//! 环境变量）仍然最权威。

use std::sync::OnceLock;

use tauri::Manager;

// Windows 侧的具名内核对象（互斥量 + 焦点事件）——
// 平台判据收在模块边界：lib.rs 只调 `another_instance_running()` /
// `spawn_focus_waiter()`，不自己摸 cfg（与 Node 侧 kill-process-tree 同一取向）。
#[cfg(windows)]
use windows::core::{HSTRING, PCWSTR};
#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0};
#[cfg(windows)]
use windows::Win32::System::Threading::{
  CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE,
  INFINITE,
};

/// POSIX 侧的单实例判据：检出内的锁文件（内容 = 持有者 PID）。
///
/// 为什么不用 `flock`：它的锁随**文件描述符**存活，而本壳在启动早期判定、
/// 之后要长期持有——一旦 fd 被 fork 出的子进程继承或意外关闭，锁会静默失效。
/// 改成「写 PID + 存活性探测」后，判据是**可读的**：崩了留下的锁文件会被
/// `proc_alive()` 判定为陈旧并覆盖，用户也能一眼看懂锁里是谁。
#[cfg(not(windows))]
fn lock_file_path(project_root: &str) -> std::path::PathBuf {
  let root = if project_root.trim().is_empty() {
    std::env::temp_dir().join("comfyapp-shell")
  } else {
    std::path::PathBuf::from(project_root)
  };
  let name = format!(
    "shell-{:08x}.pid",
    fnv1a32(normalize_root_for_port(&root.to_string_lossy()).as_bytes())
  );
  root.join("run").join(name)
}

/// HANDLE 是裸指针包装，非 Send/Sync；跨 OnceLock / 线程传递用 isize 中转
///（与 tauri-plugin-single-instance 的 MutexHandle(isize) 同做法）。
#[cfg(windows)]
fn store_handle(cell: &OnceLock<isize>, handle: HANDLE) {
  let _ = cell.set(handle.0 as isize);
}

#[cfg(windows)]
fn load_handle(cell: &OnceLock<isize>) -> Option<HANDLE> {
  cell.get().map(|v| HANDLE(*v as *mut std::ffi::c_void))
}

#[cfg(windows)]
static INSTANCE_MUTEX: OnceLock<isize> = OnceLock::new();
#[cfg(windows)]
static FOCUS_EVENT: OnceLock<isize> = OnceLock::new();

/// POSIX 侧：是否需要把「唤起前台」转给已存在的实例。
///
/// 记录的是**首次启动判定之后**的结论——`another_instance_running()` 在首实例
/// 分支里置 false、在二次启动分支里置 true，`spawn_focus_waiter()` 据此决定
/// 要不要起等待线程（POSIX 没有内核事件对象，改由下一次启动**直接**把信号
/// 打给首实例的 PID）。
#[cfg(not(windows))]
static FOCUS_REQUESTED: OnceLock<bool> = OnceLock::new();

/// 单实例 / 端口推导共用的身份锚点：本检出的绝对路径。
/// 优先 COMFYAPP_PROJECT_ROOT（启动器注入）；tauri dev 下壳的 cwd 是
/// src-tauri，取其父目录；再取不到退回当前目录。
fn identity_root() -> String {
  if let Ok(root) = std::env::var("COMFYAPP_PROJECT_ROOT") {
    if !root.trim().is_empty() {
      return root;
    }
  }
  if let Ok(cwd) = std::env::current_dir() {
    let cwd = cwd.to_string_lossy().to_string();
    if cwd.to_ascii_lowercase().ends_with("\\src-tauri") {
      if let Some(parent) = std::path::Path::new(&cwd).parent() {
        return parent.to_string_lossy().to_string();
      }
    }
    return cwd;
  }
  String::new()
}

/// 从一段 `.env` 文本里取单个变量的值（本模块需要的**最小**子集，不引 dotenv）。
///
/// 形态与另三侧实现严格对齐（Node `readEnvFileValue` / Python `read_env_port` /
/// PowerShell `Get-DotEnvAppPort`，ISSUE #821）：行首允许空白、值去掉成对引号与
/// 行尾注释（`# 固定端口` 是 dotenv 的常见写法）、只取第一个匹配行。四侧对同一份
/// `.env` 必须读出同一个值，否则「同一处配置、两侧端口一致」又是文档承诺而非可
/// 失败断言（对齐判据在 `tests/app-port-cross-language.test.ts` 的 `.env` 用例组）。
pub fn read_dot_env_value(content: &str, key: &str) -> Option<String> {
  for raw_line in content.lines() {
    let line = raw_line.trim();
    // 整行注释直接跳过 —— 否则 `# COMFYAPP_PORT=1` 这种「示例行」会被当成配置。
    if line.starts_with('#') {
      continue;
    }
    // 判据是「行首（允许空白）就是 KEY=」，不是「行里出现过它」：后者会把
    // `OTHER_COMFYAPP_PORT=` / `#PORT=` 这类行一起收进来。
    let Some(rest) = line.strip_prefix(key) else {
      continue;
    };
    let Some(after_eq) = rest.trim_start().strip_prefix('=') else {
      continue;
    };
    // 行尾注释：只认「空白 + `#`」，`abc#def` 里的 `#` 是值的一部分。
    let value = match after_eq.find(" #") {
      Some(idx) => &after_eq[..idx],
      None => after_eq,
    };
    let value = value.trim();
    let bytes = value.as_bytes();
    if bytes.len() >= 2
      && (bytes[0] == b'"' || bytes[0] == b'\'')
      && bytes[bytes.len() - 1] == bytes[0]
    {
      return Some(value[1..value.len() - 1].to_string());
    }
    return Some(value.to_string());
  }
  None
}

/// 读检出 `.env` 的 `COMFYAPP_PORT`（文件缺失 / 未配置 / 非法一律返回 None）。
///
/// 「非法」的定义与 Node 侧 `readEnvPort` 一致：必须能解析成整数且落在
/// 1..=65535。解析不出来时返回 None 而**不是**报错——那与「没写这一行」在语义上
/// 等价（退回路径推导），而报错会挡死启动。
pub fn read_env_app_port(project_root: &str) -> Option<u16> {
  if project_root.trim().is_empty() {
    return None;
  }
  let content = std::fs::read_to_string(std::path::Path::new(project_root).join(".env")).ok()?;
  let raw = read_dot_env_value(&content, "COMFYAPP_PORT")?;
  raw.trim().parse::<u16>().ok().filter(|p| *p >= 1)
}

/// FNV-1a 32 位哈希（字节级与 Node / PowerShell / Python 实现对齐）。
pub fn fnv1a32(bytes: &[u8]) -> u32 {
  let mut h: u32 = 0x811c_9dc5;
  for b in bytes {
    h ^= *b as u32;
    h = h.wrapping_mul(0x0100_0193);
  }
  h
}

/// 按检出路径推导应用端口（`resolve_app_port` 的第 ② 步，见模块注释的多语言约定）。
pub fn derive_app_port() -> u16 {
  derive_app_port_for_root(&identity_root())
}

/// 规范化检出路径：转正斜杠 + 转小写 + 去尾斜杠（跨四语言约定，§1.1）。
/// 本函数**不做**路径解析（不像 Node 的 path.resolve / Python 的 abspath
/// 会拼 cwd）——绝对路径原样处理，保证同一检出恒定同端口，与
/// scripts/app-port.mjs 的 normalizeRootForPort 行为一致。
pub fn normalize_root_for_port(root: &str) -> String {
  root.replace('\\', "/").to_lowercase().trim_end_matches('/').to_string()
}

pub fn derive_app_port_for_root(root: &str) -> u16 {
  let normalized = normalize_root_for_port(root);
  3200 + (fnv1a32(normalized.as_bytes()) % 800) as u16
}

/// 指定检出的应用端口来源。
///
/// 只用于日志 / 启动报告：把「哪一侧错了」变成一行可读的归因。数字本身由
/// `resolve_app_port_for_root` 给，两者必须同源同优先级（这里与它共用一份判据
/// 顺序，不另写一套）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortSource {
  /// 进程环境 `COMFYAPP_PORT`
  Env,
  /// 检出 `.env` 的 `COMFYAPP_PORT`
  DotEnv,
  /// 按检出绝对路径推导
  Derived,
}

impl PortSource {
  /// 给人看的中文标签（日志 / 启动报告用）。
  pub fn label(self) -> &'static str {
    match self {
      PortSource::Env => "环境变量 COMFYAPP_PORT",
      PortSource::DotEnv => "检出 .env 的 COMFYAPP_PORT",
      PortSource::Derived => "按检出路径推导（3200~3999）",
    }
  }
}

/// 指定检出的最终应用端口：`COMFYAPP_PORT` 环境变量 → 检出 `.env` → 路径推导。
///
/// **这是端口解析的唯一出口**（ISSUE #821），所有需要「应用端口是多少」的地方都调
/// 它（`default_dev_url` / 壳给编排器注入 `COMFYAPP_PORT` / 启动报告）。
/// 各处自己按 `derive_app_port_for_root()` 推导 = 又长出第二份口径，而 `.env` 一旦
/// 被写死端口，两份口径立刻分叉：编排器按 `.env` 在 3100 起 dev server，壳按路径
/// 推导在 3809 死等 —— 两边永远对不上（现象是启动页卡在「等 dev server」）。
///
/// 优先级与 `scripts/app-port.mjs` 的 `resolveAppPort` 逐条对齐：
///   ① 进程环境 `COMFYAPP_PORT` —— 上游显式注入最权威（终端 / 脚本传进来的值
///      不该被 `.env` 覆盖）；非法值按「没给」处理，继续往下走；
///   ② 检出 `.env` 的 `COMFYAPP_PORT`；
///   ③ 按检出路径推导。
///
/// 「非法」不报错：与「没写这一行」语义等价（退回路径推导），而报错会挡死启动。
/// 这与另三侧 `resolveAppPort` / `resolve_app_port` / `Get-AppPort` 的口径一致。
pub fn resolve_app_port_for_root(root: &str) -> u16 {
  resolve_app_port_with_source_for_root(root).0
}

/// 与 `resolve_app_port_for_root` 同一次计算同时给出端口与来源 —— 两者分两次
/// 各算一遍（一次取值、一次判来源）时，任一侧的判据被改就会被静默拉开，而表现是
/// 「日志说 .env、实际用的是路径推导」这种**比没有日志更坏**的现场。
pub fn resolve_app_port_with_source_for_root(root: &str) -> (u16, PortSource) {
  // ① 进程环境：上游显式注入最权威（终端 / 脚本传进来的值不该被 .env 覆盖）；
  //    非法值按「没给」处理，继续往下走（不报错 —— 报错会挡死启动）。
  if let Some(port) = env_app_port() {
    return (port, PortSource::Env);
  }
  // ② 检出 `.env`：**壳必须自己读**，否则用户写死的端口只对编排器可见。
  if let Some(port) = read_env_app_port(root) {
    return (port, PortSource::DotEnv);
  }
  // ③ 按检出路径推导（推导本身不会失败）。
  (derive_app_port_for_root(root), PortSource::Derived)
}

/// 进程环境里的 `COMFYAPP_PORT`（缺失 / 空串 / 非法一律 None）。
fn env_app_port() -> Option<u16> {
  std::env::var("COMFYAPP_PORT")
    .ok()
    .and_then(|raw| raw.trim().parse::<u16>().ok())
    .filter(|p| *p >= 1)
}

/// 端口来自哪一条（数字请用 `resolve_app_port_for_root` 取 —— 它与本函数读同一份
/// 判据顺序）。
pub fn port_source_for_root(root: &str) -> PortSource {
  resolve_app_port_with_source_for_root(root).1
}

/// 本检出的最终应用端口（身份锚点 = `identity_root()`，双击场景也拿得到真值，
/// 见 `publish_project_root_env`）。
pub fn resolve_app_port() -> u16 {
  resolve_app_port_for_root(&identity_root())
}

#[cfg(windows)]
fn mutex_name() -> HSTRING {
  HSTRING::from(format!(
    "Local\\ComfyAppShell-{:08x}-sim",
    fnv1a32(identity_root().replace('\\', "/").to_lowercase().as_bytes())
  ))
}

#[cfg(windows)]
fn focus_event_name() -> HSTRING {
  HSTRING::from(format!(
    "Local\\ComfyAppShell-{:08x}-focus",
    fnv1a32(identity_root().replace('\\', "/").to_lowercase().as_bytes())
  ))
}

/// 在窗口 / 事件循环创建之前调用。返回 true = 本检出已有壳在跑：
/// 已向其发送「唤起前台」事件，调用方应立即退出（不建窗口）。
/// 互斥量创建失败时不拦截启动——宁可极端情况下双开，也不把启动挡死。
#[cfg(windows)]
pub fn another_instance_running() -> bool {
  unsafe {
    let mutex_name = mutex_name();
    let created = CreateMutexW(None, false, PCWSTR(mutex_name.as_ptr()));
    let handle = match created {
      Ok(h) => h,
      Err(_) => return false,
    };
    if GetLastError() == ERROR_ALREADY_EXISTS {
      // 已有实例：置焦点事件后退出。句柄立即关闭，不占住命名对象。
      let event_name = focus_event_name();
      if let Ok(ev) = OpenEventW(EVENT_MODIFY_STATE, false, PCWSTR(event_name.as_ptr())) {
        let _ = SetEvent(ev);
        let _ = CloseHandle(ev);
      }
      let _ = CloseHandle(handle);
      return true;
    }
    // 首实例：创建焦点事件（auto-reset），句柄留到 setup 阶段起等待线程。
    // 进程退出时句柄随内核对象一并消亡，无需显式清理（Windows 语义）。
    let event_name = focus_event_name();
    match CreateEventW(None, false, false, PCWSTR(event_name.as_ptr())) {
      Ok(ev) => {
        store_handle(&INSTANCE_MUTEX, handle);
        store_handle(&FOCUS_EVENT, ev);
        false
      }
      Err(_) => {
        // 焦点事件建不出来：单实例互斥仍生效（二次启动会直接退出），
        // 只是「唤起前台」这一步没人应答。不因此拦截启动。
        store_handle(&INSTANCE_MUTEX, handle);
        false
      }
    }
  }
}

/// setup 阶段调用：常驻线程等待焦点事件，收到后把主窗口带到前台。
/// 与原插件回调同语义——启动期（splash 还开着）不抢，避免把还在
/// about:blank 的隐藏主窗顶出来；二次启动是用户显式意图，必须给前台。
#[cfg(windows)]
pub fn spawn_focus_waiter(app: tauri::AppHandle) {
  let Some(event) = load_handle(&FOCUS_EVENT) else {
    return;
  };
  // HANDLE（裸指针）非 Send；线程闭包里用 isize 中转后还原。
  let event_raw = event.0 as isize;
  std::thread::spawn(move || {
    let event = HANDLE(event_raw as *mut std::ffi::c_void);
    loop {
      unsafe {
        if WaitForSingleObject(event, INFINITE) != WAIT_OBJECT_0 {
          return; // 等待异常时退出线程，不再响应唤起
        }
      }
      let handle = app.clone();
      let inner = handle.clone();
      let _ = handle.run_on_main_thread(move || {
        if inner.get_webview_window("splash").is_none() {
          crate::show_main_window_without_focus(&inner, true);
        }
      });
    }
  });
}

// ── POSIX（Linux / macOS）实现 ──────────────────────────────────────────────
//
// Windows 侧用「具名互斥量 + 事件对象」，POSIX 没有等价的内核对象可用
// （命名信号量要 -lrt、共享内存要 tmpfile 语义，且都需要在崩溃时保证清理），
// 因此改为**检出内锁文件**：内容 = 首实例 PID。
//
// 二次启动的处理是「读完 PID → 给首实例发唤起信号 → 自己退出」：
// 信号用 SIGUSR1（POSIX 保留给应用自定义），首实例在 setup 阶段起的等待线程
// 收到后把窗口带到前台——与 Windows 的事件对象同一语义，只是通道换成信号。
// 拿不到 PID / 进程已死时**不拦截启动**（宁可极端情况下双开，也不把启动挡死，
// 与 Windows 侧「互斥量创建失败不拦截」同一取向）。

/// 进程是否还活着（`kill(pid, 0)` 只做权限与存在性检查，不发信号）。
#[cfg(not(windows))]
fn proc_alive(pid: i32) -> bool {
  if pid <= 0 {
    return false;
  }
  unsafe { libc::kill(pid, 0) == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM) }
}

/// 读锁文件里的持有者 PID（缺失 / 损坏返回 None）。
#[cfg(not(windows))]
fn read_lock_pid(path: &std::path::Path) -> Option<i32> {
  std::fs::read_to_string(path)
    .ok()?
    .trim()
    .parse::<i32>()
    .ok()
}

/// POSIX 单实例判定：返回 true = 本检出已有壳在跑（已请它把窗口带到前台）。
#[cfg(not(windows))]
pub fn another_instance_running() -> bool {
  let path = lock_file_path(&identity_root());
  if let Some(dir) = path.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  if let Some(existing) = read_lock_pid(&path) {
    if existing != std::process::id() as i32 && proc_alive(existing) {
      // 已有实例：请它把窗口带到前台，本次启动随即退出（不建窗口）。
      // 信号失败不改变结论——「实例在跑」这个事实与「能不能提醒到它」无关，
      // 重要的是本次不要叠加第二个窗口。
      unsafe {
        libc::kill(existing, libc::SIGUSR1);
      }
      let _ = FOCUS_REQUESTED.set(true);
      return true;
    }
    // 陈旧锁（上次崩溃 / 被 SIGKILL 留下的）：覆盖之，不阻塞启动。
  }
  match std::fs::write(&path, std::process::id().to_string()) {
    Ok(()) => {
      let _ = FOCUS_REQUESTED.set(false);
      false
    }
    Err(e) => {
      // 写不进去（只读检出 / 权限）：单实例保护失效，但绝不把启动挡死。
      log::warn!("[ComfyAPP] single-instance lock not writable: {:?} ({})", path, e);
      let _ = FOCUS_REQUESTED.set(false);
      false
    }
  }
}

/// POSIX：等待「唤起前台」信号（SIGUSR1），收到后把主窗口带到前台。
/// 与 Windows 侧的 focus 事件等待线程同语义、同判据（启动期不抢，二次启动必给）。
#[cfg(not(windows))]
pub fn spawn_focus_waiter(app: tauri::AppHandle) {
  if FOCUS_REQUESTED.get().copied().unwrap_or(false) {
    // 本次本身就是被顶掉的二次启动：不等待，壳会立刻退出。
    return;
  }
  let waiter = std::sync::Arc::new(app);
  std::thread::spawn(move || {
    // 用 signal-hook 之外的零依赖做法：阻塞等待信号需要 unsafe 的 sigwait，
    // 这里改用「轮询唤起标记」——信号处理器只置位，线程负责落地。
    // 轮询而非阻塞的原因：信号处理器里不能调 tauri API（非异步信号安全），
    // 而 crossbeam 等通道会引入新依赖；100ms 粒度的可见延迟对「唤醒窗口」足够。
    loop {
      if FOCUS_FLAG.swap(false, std::sync::atomic::Ordering::SeqCst) {
        // run_on_main_thread 借 &self，而闭包里还要用同一个 AppHandle
        // 查窗口/give focus —— 因此再 clone 一份给闭包，避免 move 出借用的对象。
        let outer = waiter.clone();
        let inner = waiter.clone();
        let _ = outer.run_on_main_thread(move || {
          if inner.get_webview_window("splash").is_none() {
            crate::show_main_window_without_focus(&inner, true);
          }
        });
      }
      std::thread::sleep(std::time::Duration::from_millis(100));
    }
  });
  // 信号处理器：只置位，不做任何其它事（异步信号安全约束）。
  unsafe {
    let mut action: libc::sigaction = std::mem::zeroed();
    // 函数项直接 as usize 在最新 Rust 上会报
    // `direct cast of function item into an integer`（fn 指针的大小并非必然
    // 等于 usize）—— 分两步：先取 fn 指针（as extern "C" fn），再转整数。
    action.sa_sigaction = handle_focus_signal as extern "C" fn(libc::c_int) as usize;
    action.sa_flags = 0;
    libc::sigemptyset(&mut action.sa_mask);
    libc::sigaction(libc::SIGUSR1, &action, std::ptr::null_mut());
  }
}

/// 唤起请求标记（信号处理器置位 → 等待线程消费）。
#[cfg(not(windows))]
static FOCUS_FLAG: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// SIGUSR1 处理器：只置位。
#[cfg(not(windows))]
extern "C" fn handle_focus_signal(_sig: libc::c_int) {
  FOCUS_FLAG.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
  // 四语言端口一致性：共享校验向量（ISSUE #489 缺陷 4）。
  //
  // 背景：本模块的 `normalize_root_for_port` **不做路径解析**（绝对路径原样
  // 处理），而 Node / Python / PowerShell 侧对**相对路径**会拼 cwd —— 于是
  // `rel/p` 四侧端口不同。对绝对路径（真实检出的形态）不影响，但此前没有任何
  // 测试会发现某一侧漂移：「四侧一致」只是文档承诺，不是可失败断言。
  //
  // 这里读 `tests/fixtures/app-port-vectors.json`（与 Node / Python /
  // PowerShell 侧读同一份），断言同一批 input→port。任一侧漂移 → 本测试失败。
  use std::path::PathBuf;

  fn vectors_path() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/src-tauri
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .join("tests")
      .join("fixtures")
      .join("app-port-vectors.json")
  }

  #[test]
  fn fnv1a32_anchor_matches_node_side() {
    // 锚点：与 scripts/app-port.mjs 对同一输入必须逐字节一致（§1.1 多语言约定）。
    assert_eq!(
      super::fnv1a32(b"f:/ai/other/comfy-app-t3-branch"),
      0x97ec_b3a9
    );
  }

  #[test]
  fn shared_vectors_agree_across_languages() {
    let raw = std::fs::read_to_string(vectors_path())
      .expect("tests/fixtures/app-port-vectors.json 必须存在（四语言共享校验向量）");
    let json: serde_json::Value = serde_json::from_str(&raw).expect("向量文件必须是合法 JSON");
    let vectors = json["vectors"]
      .as_array()
      .expect("向量文件必须含 vectors 数组");
    assert!(
      vectors.len() >= 5,
      "向量文件至少要有 5 条（防止误删后测试静默全绿）"
    );
    for v in vectors {
      let input = v["input"].as_str().expect("input 必须是字符串");
      let want_normalized = v["normalized"].as_str().unwrap();
      let want_fnv = v["fnv1a32"].as_u64().unwrap() as u32;
      let want_port = v["port"].as_u64().unwrap() as u16;
      assert_eq!(
        super::normalize_root_for_port(input),
        want_normalized,
        "规范化不一致：{input}"
      );
      assert_eq!(
        super::fnv1a32(want_normalized.as_bytes()),
        want_fnv,
        "FNV-1a 不一致：{input}"
      );
      assert_eq!(
        super::derive_app_port_for_root(input),
        want_port,
        "端口不一致：{input}"
      );
    }
  }

  /// `.env` 单值解析：四侧共用的最小子集（ISSUE #821）。
  ///
  /// 这些形态不是「顺手多测几条」—— 它们全是对齐判据的一部分：另三侧读的是
  /// 同一份 `.env`，任一侧对「带引号 / 行尾注释 / 注释行 / 空串」的理解不一致
  /// 都会让「同一处配置、两侧端口一致」当场失效，而现场表现只是「启动页一直等」。
  #[test]
  fn dot_env_value_parsing_matches_the_other_three_sides() {
    // 成对引号（.env.example 与 prepare 脚本都写成 KEY="..."）。
    assert_eq!(
      super::read_dot_env_value("COMFYAPP_PORT=\"3100\"", "COMFYAPP_PORT").as_deref(),
      Some("3100")
    );
    assert_eq!(
      super::read_dot_env_value("COMFYAPP_PORT='3100'", "COMFYAPP_PORT").as_deref(),
      Some("3100")
    );
    // 行首空白 + 行尾注释（dotenv 常见写法）。
    assert_eq!(
      super::read_dot_env_value("  COMFYAPP_PORT=3100   # 固定端口", "COMFYAPP_PORT").as_deref(),
      Some("3100")
    );
    // `abc#def` 里的 `#` 是值的一部分，不能当注释切掉。
    assert_eq!(
      super::read_dot_env_value("COMFYAPP_PORT=abc#def", "COMFYAPP_PORT").as_deref(),
      Some("abc#def")
    );
    // 整行注释（`.env.example` 里的示例行）必须被跳过。
    assert_eq!(super::read_dot_env_value("# COMFYAPP_PORT=3100\n", "COMFYAPP_PORT"), None);
    // 只认「行首就是 KEY=」：别的键里含同名子串不算（否则 OTHER_COMFYAPP_PORT 会串台）。
    assert_eq!(
      super::read_dot_env_value("OTHER_COMFYAPP_PORT=3100", "COMFYAPP_PORT"),
      None
    );
    // 键名后允许空白（`COMFYAPP_PORT = 3100`）。
    assert_eq!(
      super::read_dot_env_value("COMFYAPP_PORT = 3100", "COMFYAPP_PORT").as_deref(),
      Some("3100")
    );
    // 空文件 / 空串。
    assert_eq!(super::read_dot_env_value("", "COMFYAPP_PORT"), None);
  }

  /// 「壳与 Node 侧读同一处」的本地回归：`.env` 显式端口必须被壳认出来，
  /// 而不是退回路径推导（ISSUE #821 根因 —— 壳只看 OS 环境变量）。
  ///
  /// 用临时目录造 `.env`，不依赖开发者本机的配置（用例的可通过性只能取决于
  /// 用例自己造的东西）。
  #[test]
  fn env_port_wins_over_derived_port_and_is_read_from_dot_env() {
    let dir = std::env::temp_dir().join(format!("app-port-env-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let root = dir.to_string_lossy().to_string();
    let env_path = dir.join(".env");

    // 未配置 → 路径推导。
    let _ = std::fs::remove_file(&env_path);
    assert_eq!(super::read_env_app_port(&root), None);

    // 显式 4321 → 读得到它，且**不等于**该路径的推导值。
    std::fs::write(&env_path, "COMFYAPP_PORT=\"4321\"\n").unwrap();
    assert_eq!(super::read_env_app_port(&root), Some(4321));
    assert_ne!(super::derive_app_port_for_root(&root), 4321);

    // 非法值 → 当作「没写」（退回推导，不报错、不挡启动）。
    std::fs::write(&env_path, "COMFYAPP_PORT=not-a-number\n").unwrap();
    assert_eq!(super::read_env_app_port(&root), None);

    // 超范围 → 同样视为未配置（与 Node 侧 readEnvPort 的 1..=65535 判据一致）。
    std::fs::write(&env_path, "COMFYAPP_PORT=70000\n").unwrap();
    assert_eq!(super::read_env_app_port(&root), None);

    // 整行被注释掉 → 未配置。
    std::fs::write(&env_path, "# COMFYAPP_PORT=4321\n").unwrap();
    assert_eq!(super::read_env_app_port(&root), None);

    let _ = std::fs::remove_dir_all(&dir);
  }

  /// 端口来源判据与端口本体的顺序必须一致（分家 = 日志说一套、实际用另一套）。
  #[test]
  fn port_source_is_consistent_with_resolved_port() {
    let dir = std::env::temp_dir().join(format!("app-port-src-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let root = dir.to_string_lossy().to_string();
    let _ = std::fs::remove_file(dir.join(".env"));

    // 无 .env → 路径推导（环境变量在本进程里可能已设，故只在它缺席时判这一条）。
    if std::env::var("COMFYAPP_PORT").is_err() {
      assert_eq!(super::port_source_for_root(&root), super::PortSource::Derived);
      assert_eq!(
        super::resolve_app_port_for_root(&root),
        super::derive_app_port_for_root(&root)
      );
    }

    // 有 .env 且环境变量缺席 → .env 优先。
    std::fs::write(dir.join(".env"), "COMFYAPP_PORT=4321\n").unwrap();
    if std::env::var("COMFYAPP_PORT").is_err() {
      assert_eq!(super::port_source_for_root(&root), super::PortSource::DotEnv);
      assert_eq!(super::resolve_app_port_for_root(&root), 4321);
    }

    let _ = std::fs::remove_dir_all(&dir);
  }

  /**
   * 跨语言一致性：Rust 侧的 **.env 解析** 与另三侧读同一份 .env 得出同一个值。
   *
   * 这条由 `tests/app-port-cross-language.test.ts` + `scripts/check-app-port-vectors.cjs`
   * 从外部复核（它们只能断言本文件引用了向量文件），真正的执行判据在这里。
   */
  #[test]
  fn env_port_vectors_agree_across_languages() {
    let raw = std::fs::read_to_string(vectors_path())
      .expect("tests/fixtures/app-port-vectors.json 必须存在（四语言共享校验向量）");
    let json: serde_json::Value = serde_json::from_str(&raw).expect("向量文件必须是合法 JSON");
    let env_vectors = json["envVectors"]
      .as_array()
      .expect("向量文件必须含 envVectors 数组（.env 解析的四侧一致性，ISSUE #821）");
    assert!(env_vectors.len() >= 4, "envVectors 至少 4 条（防止误删后静默全绿）");
    for v in env_vectors {
      let content = v["content"].as_str().expect("content 必须是字符串");
      // `port: null` = 「未配置」（注释行 / 键名不匹配 / 空值 / 非数字），
      // 与 Node 侧 `readEnvFileValue` + `Number.parseInt` 的落点一致。
      let want = v["port"].as_i64();
      let got = super::read_dot_env_value(content, "COMFYAPP_PORT")
        .and_then(|raw| raw.trim().parse::<u16>().ok())
        .map(i64::from);
      assert_eq!(got, want, ".env 解析不一致：{content:?}");
    }
  }

  #[test]
  fn derived_port_in_designated_range() {
    let port = super::derive_app_port_for_root("F:\\AI\\Other\\comfy-app-t3-branch");
    assert_eq!(port, 3305);
    assert!((3200..=3999).contains(&port));
  }

  #[test]
  fn normalize_is_platform_and_cwd_independent() {
    // 反斜杠/正斜杠、大小写、尾斜杠三种写法必须归一到同一个值——端口才谈得上
    // 「同一检出恒定同端口」（多检出并行的前提，§1.4）。
    let want = "f:/ai/other/comfy-app-t3-branch";
    assert_eq!(super::normalize_root_for_port("F:\\AI\\Other\\comfy-app-t3-branch"), want);
    assert_eq!(super::normalize_root_for_port("F:/AI/Other/comfy-app-t3-branch/"), want);
    assert_eq!(super::derive_app_port_for_root("F:/AI/Other/comfy-app-t3-branch/"), 3305);
    // POSIX 路径（含尾斜杠）同样稳定。
    assert_eq!(super::normalize_root_for_port("/workspace/"), "/workspace");
  }
}
