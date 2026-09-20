//! 桌面壳自编排：「只启动一个 exe」链路（ISSUE #784）。
//!
//! 以前双击的入口是 python 启动器 exe（start-tauri.exe），它再依次拉起
//! `node scripts/dev-launcher.mjs` 与 Tauri 壳 app.exe —— 用户看到的是
//! 「双击一个程序、跑起来两个 exe」。现在让**壳自己**承担那一层编排：
//! 双击 app.exe 时，壳在同一个进程里起 dev-launcher.mjs（编排本身仍是那一份
//! 唯一实现，本模块只负责「怎么起、怎么认亲、怎么回收」三件事）。
//!
//! 附带的两个收益：
//!   1. 不再有「谁结束的这次启动」的分叉 —— 旧链路里壳只是编排器的子进程之一，
//!      python 启动器早已退出，用户关掉主窗后整棵树能否回收取决于它退出前有没有
//!      把 Job Object 句柄交出去；现在编排器是壳的子进程，「壳退出 → 回收编排器
//!      → 编排器回收它自己那棵树」是一条没有中断的链，OS 级 Job Object 也由壳
//!      自己持有（见 `attach_kill_on_close_job`）。
//!   2. 前台归属不再需要第二个进程复核：双击时「用户就是在等这个应用」，壳自己
//!      知道（判据见 `decide_front_when_self_launched`）。
//!
//! 与 python 启动器的关系（并存，不替代）：后者仍是「双击入口」，它的
//! `tools/start/start-tauri.ps1`、`--help`、环境预检与失败弹窗都还在；它拉起壳
//! 之前会先起 dev-launcher，因此新壳看到「已经认识本检出的编排器在跑」就直接
//! 复用，不会起第二份编排（双份编排会争端口、争 `run/launch-session.json`）。
//! 反过来，用户直接双击 `target/release/app.exe`（没有 python 启动器）时，壳
//! 自己把编排补齐 —— 这正是本 ISSUE 要的形态。

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Wry;

/// `KILL_ON_JOB_CLOSE` Job Object 的句柄（`usize` 存裸指针：HANDLE 不是 Send，
/// 而它要在 `attach_kill_on_close_job` 之后**一直持有到进程退出**）。
///
/// 存下来而不是 `CloseHandle`：job 的语义是「最后一个句柄关闭即杀整棵树」，
/// 壳这一侧持有到进程结束，OS 才会在壳死时替我们关掉它并终止整棵树。
#[cfg(windows)]
static JOB_HANDLE: Mutex<usize> = Mutex::new(0);

/// 本次启动的编排子进程句柄（`node scripts/dev-launcher.mjs --mode prebuilt`）。
///
/// 用 **tauri-plugin-shell 的 CommandChild** 而不是 `std::process::Command`：
/// 官方插件按平台选机制，且 `kill()` 连带回收子进程 —— 这正是跨平台启动链路里
/// 最不能自己手写的一段（AGENTS 硬规则 3）。自持 `Command::new` + `taskkill`
/// 的写法在 POSIX 上只剩单杀 leader，其下的 `pnpm` / `next` / `turbopack worker`
/// 会残留成孤儿（与 `SIDECAR` 那条注释同一个理由）。
static ORCHESTRATOR: Mutex<Option<tauri_plugin_shell::process::CommandChild>> = Mutex::new(None);

/// 本模块亲手起的编排器，其进程环境里必有这一条（认亲判据，见 `is_own`）。
pub const OWNED_ENV: &str = "COMFYAPP_SHELL_OWNED";

/// 已由壳完成编排（= 本次启动的 dev server 由壳拉起）。
pub fn is_owning() -> bool {
  ORCHESTRATOR.lock().unwrap().is_some()
}

/// 记录本次启动的编排子进程，供退出时回收。
pub fn adopt(child: tauri_plugin_shell::process::CommandChild) {
  *ORCHESTRATOR.lock().unwrap() = Some(child);
}

/// 这个进程是不是「同一个壳亲手起的那个编排器」。
///
/// 与 `process_env_is_owned` 是一对：后者从**另一个进程**的环境块里读出同样的
/// 判定（供「起之前先看看有没有」用），前者判的是**已拿到的环境变量表** ——
/// `#[allow(dead_code)]` 是因为后者已经走完读环境块那一段，这里保留成
/// 「判据只有一句」的单一出处，避免以后有人从环境表判时另写一份。
#[allow(dead_code)]
///
/// 判据刻意用**环境变量标记**而不是形态（「有没有 dev server」「有没有
/// launch-status.json」「命令行里有没有项目根」）：那三条都只能说「有个编排在
/// 跑」，认不出是**谁**起的 —— 而这里的动作是「把它当成自己的话就直接复用、
/// 不是就绝不能杀」，认错人就是误杀用户正在用的启动过程。标记只有本模块写、
/// 由本模块起的编排器继承，因此它等价于「这是我自己的孩子」。
pub fn is_own(env: &HashMap<String, String>) -> bool {
  env.get(OWNED_ENV).map(String::as_str) == Some("1")
}

/// 项目根下的 `scripts/dev-launcher.mjs`（启动编排的唯一实现）。
pub fn orchestrator_script(project_root: &str) -> Option<std::path::PathBuf> {
  if project_root.is_empty() {
    return None;
  }
  let script = std::path::Path::new(project_root)
    .join("scripts")
    .join("dev-launcher.mjs");
  script.is_file().then_some(script)
}

/// 这个检出能不能自己起来（= 有编排脚本 + 依赖装好了）。
///
/// 判据必须**只读、极快、且宁可漏判成「没有」**：它跑在 Windows 的
/// `CreateProcess` 前置检查里，决定「能不能直接执行 `dev-launcher.mjs`」，
/// 也就是零进程切换那条起法能不能成立。漏判只是退回「自己起 node」的形态，
/// 误判才是把「双击没反应」塞给用户。
pub fn can_self_launch(project_root: &str) -> bool {
  if orchestrator_script(project_root).is_none() {
    return false;
  }
  let modules = std::path::Path::new(project_root)
    .join("node_modules")
    .join(".modules.yaml");
  if !modules.is_file() {
    return false;
  }
  // 关键依赖缺一个都起不来（与 dev-launcher 的工具链门禁同口径，这里只做
  // 存在性检查，不重复实现它的探测语义）。
  ["typescript", "next"].iter().all(|name| {
    std::path::Path::new(project_root)
      .join("node_modules")
      .join(name)
      .is_dir()
  })
}

/// 「双击 app.exe」时要不要把主窗顶到前台。
///
/// 与 python 启动器的 `decide_foreground` 同一取向但不查进程表：直接双击这个
/// 壳的人就是刚点完它、正在等画面的人（ISSUE #576「双击像没反应」的另一面）。
/// `COMFYAPP_FOREGROUND` 已由启动器显式注入时以它为准（`read_foreground_env`），
/// 这里的默认值只在变量缺席时生效。
pub fn decide_front_when_self_launched() -> bool {
  true
}

/// 从环境读前台开关（三方注入：python 启动器 / 脚本 / 壳自己）。
///
/// 返回 `None` = 没人表态，由调用方按启动形态给默认值。空串按「未表态」处理：
/// 启动器在 `--background` 分支下会显式写 "0"，而 `.env` 里留个空值不该被
/// 误读成「要抢前台」。
pub fn read_foreground_env() -> Option<bool> {
  let raw = std::env::var("COMFYAPP_FOREGROUND").ok()?;
  let value = raw.trim().to_ascii_lowercase();
  if value.is_empty() {
    return None;
  }
  Some(value == "1" || value == "true" || value == "yes")
}

/// 回收本次启动拉起的编排器整棵进程树。
///
/// 两道机制与 `kill_sidecar` 同构（AGENTS 硬规则 3：必须杀整棵树）：
///   1. **shell 插件自己的 `kill()`** —— 按平台选机制；
///   2. **编排侧的统一回收**（`scripts/reap-process.mjs`）—— 插件保证「跟随
///      平台」，统一回收保证「不漏」：`node → pnpm → next → turbopack worker`
///      才是真正会残留成孤儿的那几层。
pub fn reap(project_root: &str) {
  let child = ORCHESTRATOR.lock().unwrap().take();
  let Some(child) = child else { return };
  let pid = child.pid();
  match child.kill() {
    Ok(()) => log::info!("[ComfyAPP] shell orchestrator stopped via shell plugin (pid {pid})"),
    Err(e) => log::warn!("[ComfyAPP] shell orchestrator stop via shell plugin failed: {e:?}"),
  }
  spawn_reaper(project_root, pid);
}

/// 调 `scripts/reap-process.mjs`（非 TS 宿主的唯一命令行回收入口）。
///
/// **不自己拼 `taskkill` / `kill`**：平台判据只允许有一份，在
/// `src/lib/process/kill-process-tree.ts`（命令行入口就是 reap-process.mjs）。
/// 这里再写一遍，就是「各写各的、POSIX 上退化成单杀」那条老路的翻版。
fn spawn_reaper(project_root: &str, pid: u32) {
  if project_root.is_empty() || pid == 0 {
    return;
  }
  let script = std::path::Path::new(project_root)
    .join("scripts")
    .join("reap-process.mjs");
  if !script.is_file() {
    log::warn!(
      "[ComfyAPP] 统一回收脚本不存在（{}），本次只靠 shell 插件回收编排器",
      script.display()
    );
    return;
  }
  let mut command = std::process::Command::new("node");
  command
    .arg(&script)
    .arg(pid.to_string())
    .arg("--force")
    .arg("--detach");
  #[cfg(windows)]
  {
    // 不弹控制台窗口（POSIX 上无此常量，故走 cfg 门控而不是运行时判据）。
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
  }
  match command.output() {
    Ok(out) => log::info!(
      "[ComfyAPP] 编排器进程树统一回收：{}",
      String::from_utf8_lossy(&out.stdout).trim()
    ),
    Err(e) => log::warn!("[ComfyAPP] 统一回收未能执行（{e}）；next-server 可能残留，见 log/nextjs/"),
  }
}

/// 起编排器（`node scripts/dev-launcher.mjs --mode prebuilt`）。
///
/// 与 python 启动器的 `launch_dev_server` 同一契约，但少一层宿主：那边的
/// 「隐藏窗口中的 pwsh/直接 node」是为了脱离自己的进程树，这里由壳自己持有
/// 子进程句柄 + Job Object，不需要 `DETACHED_PROCESS`（脱离反而让我们收不到
/// 它的退出、也让「壳退出即回收」失去锚点）。
pub fn spawn_orchestrator(
  app: &tauri::AppHandle<Wry>,
  project_root: &str,
) -> Result<(), Box<dyn std::error::Error>> {
  use tauri_plugin_shell::ShellExt;

  let script = orchestrator_script(project_root).ok_or_else(|| {
    format!(
      "找不到启动编排器：{}（请把壳放在项目根内，或经 start-tauri.exe 启动）",
      std::path::Path::new(project_root)
        .join("scripts")
        .join("dev-launcher.mjs")
        .display()
    )
  })?;

  let script_arg = script.to_string_lossy().to_string();
  let port = crate::single_instance::derive_app_port();
  let (mut rx, child) = app
    .shell()
    .command("node")
    .args([script_arg, "--mode".into(), "prebuilt".into()])
    .env(OWNED_ENV, "1")
    .env("COMFYAPP_SHELL_SELF_LAUNCH", "1")
    .env("COMFYAPP_PORT", port.to_string())
    .env("COMFYAPP_PROJECT_ROOT", project_root)
    .env("COMFYAPP_LAUNCH_MODE", "prebuilt")
    .current_dir(project_root)
    .spawn()?;
  adopt(child);

  // 编排器的输出必须有人读：shell 插件把输出投递到事件通道，无人消费时管道
  // 写满会让它静默卡死（表现为「启动页一直停在第一步」）。落进壳日志，同时
  // 转发给 dlog 让 dev-launcher 自己写的那份日志之外还有一条「谁起的它」。
  tauri::async_runtime::spawn(async move {
    use tauri_plugin_shell::process::CommandEvent;
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) => log::info!(
          "[orchestrator] {}",
          String::from_utf8_lossy(&line).trim_end()
        ),
        CommandEvent::Stderr(line) => log::warn!(
          "[orchestrator] {}",
          String::from_utf8_lossy(&line).trim_end()
        ),
        CommandEvent::Terminated(payload) => {
          log::info!("[ComfyAPP] orchestrator terminated: {:?}", payload.code)
        }
        _ => {}
      }
    }
  });
  Ok(())
}

/// 给编排器挂一个 `KILL_ON_JOB_CLOSE` 的 Job Object（Windows）。
///
/// 与 python 启动器里的 `scripts/win_job.py` 同一目的：编排器（node）若崩溃 /
/// 被硬杀，它拉起的 `node → pnpm → next` 会残留成孤儿，锁住端口与日志。OS 级
/// 兜底是「最后一个句柄关闭即当场终止整棵树」——句柄由壳持有，壳一死 job 就关。
///
/// 失败一律只记 WARN：这是**兜底**，正常的回收链（壳退出 → 插件 kill → 统一
/// 回收）不依赖它，挂不上不该拦住启动。
#[cfg(windows)]
pub fn attach_kill_on_close_job() {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_BASIC_LIMIT_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  };
  use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
  };

  let pid = {
    let guard = ORCHESTRATOR.lock().unwrap();
    match guard.as_ref() {
      Some(child) => child.pid(),
      None => return,
    }
  };
  if pid == 0 {
    return;
  }
  unsafe {
    let job = match CreateJobObjectW(None, windows::core::PCWSTR::null()) {
      Ok(handle) => handle,
      Err(e) => {
        log::warn!("[ComfyAPP] CreateJobObjectW failed: {e:?}");
        return;
      }
    };
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation = JOBOBJECT_BASIC_LIMIT_INFORMATION {
      LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      ..Default::default()
    };
    let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    let set = SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      &info as *const _ as *const std::ffi::c_void,
      size,
    );
    if let Err(e) = set {
      log::warn!("[ComfyAPP] SetInformationJobObject failed: {e:?}");
      let _ = CloseHandle(job);
      return;
    }
    match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
      Ok(process) => {
        match AssignProcessToJobObject(job, process) {
          Ok(()) => log::info!(
            "[ComfyAPP] orchestrator {pid} attached to kill-on-close job (shell is its owner)"
          ),
          Err(e) => log::warn!("[ComfyAPP] AssignProcessToJobObject failed: {e:?}"),
        }
        let _ = CloseHandle(process);
      }
      Err(e) => log::warn!("[ComfyAPP] OpenProcess({pid}) failed: {e:?}"),
    }
    // 句柄**故意不关**：job 的语义是「最后一个句柄关闭即杀整棵树」，而壳退出
    // 时 OS 会替我们关掉它，那一刻才是「壳死了，编排器也别活」的触发点。
    // 这里把句柄塞进一个 `static` 就是「有意泄漏」的写法 —— `mem::forget` 对
    // `HANDLE`（`Copy`）是空操作，写它会连编译都提醒「什么也没做」。
    *JOB_HANDLE.lock().unwrap() = job.0 as usize;
  }
}

#[cfg(not(windows))]
pub fn attach_kill_on_close_job() {}

/// 编排器进程的环境块里有没有 `COMFYAPP_SHELL_OWNED=1`（Windows）。
///
/// 看环境块必须拿到进程句柄，所以只覆盖 Windows：「同一个 exe 被双击两次」正是
/// 本 ISSUE 的场景，而它在 POSIX 上由启动器的锁文件（single_instance 的
/// `#[cfg(not(windows))]` 实现）承担。判据读不到（权限不足 / 32 位目标）一律
/// 返回 false —— 宁可多起一个编排器（会被端口与单实例判据挡住），也不能去杀
/// 一个身份不明的进程。
#[cfg(windows)]
pub fn process_env_is_owned(pid: u32) -> bool {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
  };
  unsafe {
    let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
      return false;
    };
    let owned = read_owned_env_from_process(handle);
    let _ = CloseHandle(handle);
    owned
  }
}

/// 非 Windows：认亲不可用（看环境块要进程句柄，机制在 Windows 上）。
///
/// 返回 false = 「不知道它是谁」——调用方据此**不起第二份也不杀任何进程**：
/// POSIX 上「同一壳被双击两次」由启动器的锁文件与 `single_instance` 的
/// `#[cfg(not(windows))]` 实现承担，不靠这里。
///
/// `#[allow(dead_code)]`：POSIX 上没人调它（`find_owned_orchestrator` 直接返回
/// None），但**必须留着** —— 缺了它调用点就要按平台分叉，而「判据只收一处」
/// 正是这条链路的地基（§9.2）。
#[cfg(not(windows))]
#[allow(dead_code)]
pub fn process_env_is_owned(_pid: u32) -> bool {
  false
}

#[cfg(windows)]
unsafe fn read_owned_env_from_process(
  handle: windows::Win32::Foundation::HANDLE,
) -> bool {
  use windows::Wdk::System::Threading::{
    NtQueryInformationProcess, ProcessBasicInformation,
  };
  use windows::Win32::System::Diagnostics::Debug::ReadProcessMemory;
  use windows::Win32::System::Threading::PROCESS_BASIC_INFORMATION;

  // PEB → ProcessParameters → Environment。这条链子与位数无关（32 位目标看不到
  // 64 位进程的 PEB，拿不到就判 false，不影响正确性）。
  let mut pbi = PROCESS_BASIC_INFORMATION::default();
  let mut ret_len = 0u32;
  let status = unsafe {
    NtQueryInformationProcess(
      handle,
      ProcessBasicInformation,
      &mut pbi as *mut _ as *mut std::ffi::c_void,
      std::mem::size_of::<PROCESS_BASIC_INFORMATION>() as u32,
      &mut ret_len,
    )
  };
  if status.is_err() || pbi.PebBaseAddress.is_null() {
    return false;
  }
  // PEB + 0x20 = ProcessParameters（x64 与 x86 上都是这个偏移）
  let params_ptr: *const u8 = unsafe { (pbi.PebBaseAddress as *const u8).add(0x20) };
  let mut params_addr = 0usize;
  if unsafe {
    ReadProcessMemory(
      handle,
      params_ptr as *const std::ffi::c_void,
      &mut params_addr as *mut usize as *mut std::ffi::c_void,
      std::mem::size_of::<usize>(),
      None,
    )
  }
  .is_err()
  {
    return false;
  }
  if params_addr == 0 {
    return false;
  }
  // RTL_USER_PROCESS_PARAMETERS + 0x80 = Environment（x64；x86 是 0x48）。
  let env_offset = if cfg!(target_pointer_width = "64") {
    0x80
  } else {
    0x48
  };
  let mut env_addr = 0usize;
  if unsafe {
    ReadProcessMemory(
      handle,
      (params_addr as *const u8).add(env_offset) as *const std::ffi::c_void,
      &mut env_addr as *mut usize as *mut std::ffi::c_void,
      std::mem::size_of::<usize>(),
      None,
    )
  }
  .is_err()
  {
    return false;
  }
  if env_addr == 0 {
    return false;
  }
  // 环境块是一串 NUL 结尾的 UTF-16 串，以空串（双 NUL）收尾。整块读一次，
  // 截断风险由「读到空串为止」兜住：这里只做**包含**判定，不需要完整块。
  const MAX_ENV_BYTES: usize = 64 * 1024;
  let mut buf = vec![0u8; MAX_ENV_BYTES];
  let mut read = 0usize;
  if unsafe {
    ReadProcessMemory(
      handle,
      env_addr as *const std::ffi::c_void,
      buf.as_mut_ptr() as *mut std::ffi::c_void,
      MAX_ENV_BYTES,
      Some(&mut read),
    )
  }
  .is_err()
  {
    return false;
  }
  buf.truncate(read);
  let units: Vec<u16> = buf
    .chunks_exact(2)
    .map(|c| u16::from_le_bytes([c[0], c[1]]))
    .collect();
  let text = String::from_utf16_lossy(&units);
  let needle = format!("{OWNED_ENV}=1");
  text.split('\0').any(|entry| entry.trim() == needle)
}

/// 找到「已经在跑、且是本模块亲手起的」编排器进程号（找不到 = None）。
///
/// 只有 Windows 实现：`CreateToolhelp32Snapshot` 列出全部进程 → 逐个打开句柄 →
/// 环境块认亲。**命令行**这一层只用来做廉价预筛（省掉绝大多数 OpenProcess），
/// 真正的判据是环境块（见 `is_own` 的注释）。
#[cfg(windows)]
pub fn find_owned_orchestrator() -> Option<u32> {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
  };

  let self_pid = std::process::id();
  let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
  let mut entry = PROCESSENTRY32W {
    dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
    ..Default::default()
  };
  let mut result = None;
  unsafe {
    if Process32FirstW(snapshot, &mut entry).is_ok() {
      loop {
        let pid = entry.th32ProcessID;
        if pid != 0 && pid != self_pid && process_env_is_owned(pid) {
          result = Some(pid);
          break;
        }
        if Process32NextW(snapshot, &mut entry).is_err() {
          break;
        }
      }
    }
  }
  let _ = unsafe { CloseHandle(snapshot) };
  result
}

#[cfg(not(windows))]
pub fn find_owned_orchestrator() -> Option<u32> {
  None
}

