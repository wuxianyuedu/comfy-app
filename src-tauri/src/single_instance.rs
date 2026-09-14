//! 按检出隔离的单实例保护与端口推导（launch-and-build.md §1.4 多检出并行）。
//!
//! 为什么不用 tauri-plugin-single-instance：它的互斥量 / 消息窗口名取自**编译期**
//! identifier（com.comfyapp.desktop），是全机共享的——同一项目检出两份并行开发时，
//! 后启动的壳会把「已有实例」信号发给**另一份检出**的壳然后自己退出，永远起不来。
//! 这里把身份锚点换成「本检出」（COMFYAPP_PROJECT_ROOT，缺省 tauri dev 下的
//! cwd 父目录）：互斥量与焦点事件名都带检出哈希，单实例语义按检出隔离——
//! 同检出二次启动 → 唤起已有窗口；不同检出 → 各自独立运行。
//!
//! 端口推导与本模块同源（同一身份锚点）：与 scripts/app-port.mjs（Node）、
//! scripts/dev-launcher.ps1（PowerShell）、scripts/start_tauri_launcher.py
//! （Python）是同一算法的多语言实现，改动必须四处同步——对「绝对路径、
//! 反斜杠转正斜杠、转小写」的 UTF-8 字节取 FNV-1a 32 位哈希，
//! 映射到 3200..3999：port = 3200 + (fnv1a32(path) % 800)。

use std::sync::OnceLock;

use tauri::Manager;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{
  CreateEventW, CreateMutexW, OpenEventW, SetEvent, WaitForSingleObject, EVENT_MODIFY_STATE,
  INFINITE,
};

/// HANDLE 是裸指针包装，非 Send/Sync；跨 OnceLock / 线程传递用 isize 中转
///（与 tauri-plugin-single-instance 的 MutexHandle(isize) 同做法）。
fn store_handle(cell: &OnceLock<isize>, handle: HANDLE) {
  let _ = cell.set(handle.0 as isize);
}

fn load_handle(cell: &OnceLock<isize>) -> Option<HANDLE> {
  cell.get().map(|v| HANDLE(*v as *mut std::ffi::c_void))
}

static INSTANCE_MUTEX: OnceLock<isize> = OnceLock::new();
static FOCUS_EVENT: OnceLock<isize> = OnceLock::new();

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

/// FNV-1a 32 位哈希（字节级与 Node / PowerShell / Python 实现对齐）。
pub fn fnv1a32(bytes: &[u8]) -> u32 {
  let mut h: u32 = 0x811c_9dc5;
  for b in bytes {
    h ^= *b as u32;
    h = h.wrapping_mul(0x0100_0193);
  }
  h
}

/// 按检出路径推导应用端口（缺省端口的兜底，见模块注释的多语言约定）。
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

fn mutex_name() -> HSTRING {
  HSTRING::from(format!(
    "Local\\ComfyAppShell-{:08x}-sim",
    fnv1a32(identity_root().replace('\\', "/").to_lowercase().as_bytes())
  ))
}

fn focus_event_name() -> HSTRING {
  HSTRING::from(format!(
    "Local\\ComfyAppShell-{:08x}-focus",
    fnv1a32(identity_root().replace('\\', "/").to_lowercase().as_bytes())
  ))
}

/// 在窗口 / 事件循环创建之前调用。返回 true = 本检出已有壳在跑：
/// 已向其发送「唤起前台」事件，调用方应立即退出（不建窗口）。
/// 互斥量创建失败时不拦截启动——宁可极端情况下双开，也不把启动挡死。
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
