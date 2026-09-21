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
//! **本模块现在是唯一的启动入口形态**：Python 启动器（`start-tauri*.exe`）已在
//! 本 ISSUE 的第二轮里整体移除，双击 `app.exe` 就是唯一的「一键启动」。随之搬进
//! 壳的三件事（原先都在 python 启动器里，删它就必须先接住）：
//!   1. **运行模式** `COMFYAPP_LAUNCH_MODE`（prebuilt / standalone）由本模块
//!      决定并写进自己的环境——原先由启动器按 exe 文件名 / 参数解析后注入；
//!   2. **双击单实例的「唤起已有实例」**：原先由启动器的具名互斥量承担（壳自己
//!      的单实例保护要在窗口创建之前判定，那时还找不到编排器）；
//!   3. **启动失败的人类可见出口**：原先靠启动器的 msgbox，现在由启动页面板 +
//!      日志面板承担（见 `mark_launch_failed`）。
//! 编排本身仍是 `scripts/dev-launcher.mjs` 那一份唯一实现 —— 本模块只回答
//! 「起什么、怎么起、怎么回收、认亲判据是什么」。

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
///
/// 双击壳时**不再需要**它（编排器只可能是壳自己起的）——留着是因为「上一次运行
/// 遗留的编排器」可能仍带着这个标记在跑（例如用户强杀壳、job 与进程组都没来得及
/// 回收），而 `reap` 之后又立刻复用会去杀它：保留标记 = 那些历史残留仍能被正确
/// 认出来并回收，不会误伤别人的启动过程（认亲判据仍只认环境块，不按形态猜）。
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
/// 判据必须**只读、极快、且宁可漏判成「没有」**：它决定「这次双击能不能把应用
/// 拉起来」，而判错的代价是不对称的——漏判只是退回「等静态 devUrl」的旧行为
/// （页面明确说没就绪），误判则是让用户对着一个必然失败的过程等下去。
/// **自编排是唯一路径后，它同时是启动失败出口的开关**：判 false 时
/// `mark_launch_failed` 会把「为什么起不来、该先做什么」写到启动页上。
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
/// 判据收在壳里（Python 启动器的 `decide_foreground` 已随它一起移除）：启动期
/// **仍然不抢**——启动要几十秒，用户常在这段时间切去别的窗口干活，几十秒后正式
/// 窗口冒出来时把前台抢走就是当场打断（ISSUE #359 的教训）；双击场景下窗口进
/// 任务栏 + 任务栏闪烁提醒。真正的「唤起」交给壳自己的第二个进程：用户再双击一次
/// `app.exe`，那时 `single_instance::another_instance_running()` 会向右跑的实例
/// 发信号，`spawn_focus_waiter` 收到后以 `request_focus = true` 把窗口带到前台
/// （用户显式意图，必须给）。
///
/// `COMFYAPP_FOREGROUND` 仍可显式覆盖（脚本 / 终端调用场景，`read_foreground_env`），
/// 这里的默认值只在变量缺席时生效。
pub fn decide_front_when_self_launched() -> bool {
  false
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

/// 回收本次启动拉起的编排器整棵进程树（**启动前**也要来一次，见调用点）。
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

/// 回收一个**已知进程号**的编排器（启动前清理上一次的残留，见调用点）。
///
/// 与 `reap` 的差别只在「句柄从哪来」：`reap` 收的是本进程持有的 `CommandChild`，
/// 这里收的是上一次运行留下的孤儿（壳被强杀 / job 与进程组都没来得及回收）。
/// 两者都转交同一处平台判据，壳里**不出现** `taskkill` / 单杀 leader（硬规则 3）。
pub fn reap_pid(project_root: &str, pid: u32) {
  if pid == 0 || pid == std::process::id() {
    return;
  }
  // KILL_ON_JOB_CLOSE 的 job 已经会带走自己那一棵树；这里补的是
  // 「job 也没挂上 / 壳被硬杀」的边角，动作仍走统一回收。
  spawn_reaper(project_root, pid);
}

/// 本次运行的启动模式（`prebuilt` / `standalone`）。
///
/// **唯一读取点**：该环境变量原先由 Python 启动器按 exe 文件名 / 参数解析后注入，
/// 启动器移除后必须有人替它决定，否则 `setup_standalone_runtime` 永远读到空串
/// （standalone 壳不拉内嵌 server，页面连不上）。决定者是壳自己，判据是「编排器
/// 在不在」，**不是** exe 的名字：用户手里只有 `target/release/app.exe` 一个文件，
/// 拿它去猜「这是哪种形态」只会把两种形态都判错。
///
/// 非 release（debug，`pnpm tauri dev`）**不写**：那里 dev server 由
/// `beforeDevCommand` 起着，壳写一个模式进去只会与 dev 链路打架。
#[cfg(not(debug_assertions))]
pub fn ensure_launch_mode(project_root: &str) {
  if std::env::var("COMFYAPP_LAUNCH_MODE").is_ok() {
    return;
  }
  let mode = if orchestrator_script(project_root).is_some() {
    "prebuilt"
  } else {
    "standalone"
  };
  // SAFETY：启动期单线程（窗口与事件循环都还没建），没有并发读环境变量的路径。
  std::env::set_var("COMFYAPP_LAUNCH_MODE", mode);
  log::info!(
    "[ComfyAPP] launch mode={mode}（编排器{}）",
    if mode == "prebuilt" { "在，走 dev server" } else { "不在，走内嵌 standalone server" }
  );
}

#[cfg(debug_assertions)]
pub fn ensure_launch_mode(_project_root: &str) {}

/// 起不来时写 `run/launch-status.json`，让启动页说清「为什么起不来、该先做什么」。
///
/// Python 启动器被删除后，这里接的是它原先的**人类可见失败出口**（msgbox）。改成
/// 启动页面板是更好的形态：窗口本来就开着（`setup_splash_window` 先建启动页），
/// 页面直接读这份状态，比弹一个系统对话框更贴近「你只是没启动成功」。
///
/// 目录不存在时递归建（全新克隆 / 清理过 `run/` 的场景），写失败只记 WARN ——
/// 失败出口本身不该再产生一个失败。
pub fn mark_launch_failed(project_root: &str, message: &str) {
  if project_root.is_empty() {
    log::error!("[ComfyAPP] launch failed: {message}");
    return;
  }
  let dir = std::path::Path::new(project_root).join("run");
  if let Err(e) = std::fs::create_dir_all(&dir) {
    log::warn!("[ComfyAPP] cannot create {}: {e:?}", dir.display());
    return;
  }
  let payload = serde_json::json!({
    // 判据与 `get_launch_status` 的消费方（启动页 `updateUI`）对齐：
    // `progress` 保持 < 1，否则页面会把 100% 的前缀画成「✓」——一次失败
    // 于是看起来像「成功但没打开」。
    "phase": "error",
    "progress": 0,
    "message": message,
    "error": true,
    "updatedAt": iso_timestamp(),
  });
  let path = dir.join("launch-status.json");
  match std::fs::write(&path, payload.to_string()) {
    Ok(()) => log::error!("[ComfyAPP] launch failed (reported on the splash): {message}"),
    Err(e) => log::warn!("[ComfyAPP] cannot write {}: {e:?}", path.display()),
  }
}

/// 极简 ISO-8601（UTC）时间戳：只为进度快照里的 `updatedAt`，不引入时间库。
fn iso_timestamp() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0);
  format!("unix:{secs}")
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
      "找不到启动编排器：{}（请把壳放在项目根内：壳要靠项目根里的 scripts/dev-launcher.mjs 起服务）",
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

/// 调 `scripts/win_job.py`，把编排器纳入一个 `KILL_ON_JOB_CLOSE` 的 job。
///
/// 为什么经命令行而不是在 Rust 里重写一遍 Win32：判据只许有一处
/// （`scripts/win_job.py` 是 Job Object 的唯一实现，规范 §3.3「平台机制」层），
/// 在壳里再抄一份 CreateJobObject / DuplicateHandle 就是「两处会漂的平台分支」。
/// 顺序（先复制句柄、后 assign）与失败语义都由那份实现保证。
///
/// 失败一律只记 WARN：这是**兜底**，正常的回收链（壳退出 → 插件 kill → 统一回收）
/// 不依赖它，挂不上不该拦住启动。
#[cfg(windows)]
fn attach_job_via_helper(project_root: &str, pid: u32) -> bool {
  use std::os::windows::process::CommandExt;
  // 候选解释器与「不弹控制台窗口」的判据都在这里一处。`py` 是 Windows 的
  // 官方启动器（Store 版 Python 常常只留它）。
  const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW
  let script = std::path::Path::new(project_root)
    .join("scripts")
    .join("win_job.py");
  if !script.is_file() {
    log::warn!(
      "[ComfyAPP] win_job.py 不存在（{}），跳过 Job Object 兜底",
      script.display()
    );
    return false;
  }
  for python in ["python", "py", "python3"] {
    let mut command = std::process::Command::new(python);
    command.arg(&script).arg(pid.to_string());
    // `creation_flags` 来自 `std::os::windows::process::CommandExt`，
    // 必须显式引入（POSIX 上这个 trait 不存在，所以整段都在 cfg(windows) 里）。
    command.creation_flags(NO_WINDOW);
    match command.output() {
      Ok(out) => {
        if out.status.success() {
          return true;
        }
        log::debug!(
          "[ComfyAPP] {python} scripts/win_job.py 退出码 {:?}，试下一个解释器",
          out.status.code()
        );
      }
      Err(e) => log::debug!("[ComfyAPP] 无法用 {python} 运行 win_job.py：{e}"),
    }
  }
  false
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
  // 壳自己持有 job 句柄在这里是**有意**的（句柄故意不关，壳一死 job 就关）。
  // 与旧链路（Python 启动器）的差别：那时句柄复制进编排器、由编排器决定生死。
  // 现在编排器是壳的孩子，「壳退出 → 回收编排器 → 编排器回收它那棵树」是一条
  // 没有中断的链，job 只是「壳被硬杀」时的兜底，因此句柄归壳最自然。
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
  if let Ok(root) = std::env::var("COMFYAPP_PROJECT_ROOT") {
    if attach_job_via_helper(&root, pid) {
      log::info!("[ComfyAPP] orchestrator {pid} attached to kill-on-close job (via win_job.py)");
      return;
    }
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

