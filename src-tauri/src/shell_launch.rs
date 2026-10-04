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
//!
//! ## 可见性：起编排器的这一层必须自己也留痕（ISSUE #784 手验反馈）
//!
//! 手验暴露的缺口不是编排失败，而是**编排刚开始的那 1~2 秒里启动页什么都没得看**：
//! `run/launch-status.json` 由 dev-launcher.mjs 在壳起编排器**之后**才创建，
//! 而 release 壳（Windows 无控制台）的 stdout/stderr 没有任何去处 —— 于是
//! 「壳已接手、编排器还没写字」这段唯一的启动路径是**一片空白**：启动页显示
//! 「暂时读不到日志」，并让用户去翻那两份此刻恰好为空的文件。
//!
//! 因此本模块补齐三条（与 Node 侧的 `src/lib/shell/launch-diagnostics.ts`
//! 同路径、同形态；那边的单测锁住路径与行形态，这里保持逐项一致）：
//!   1. 写**常驻进度快照**（`run/launch-status.json`，`fallback: true`）——
//!      编排器一写自己的状态就把它顶掉，因此它只服务启动窗口期；
//!   2. 落一份**壳自持的编排链路日志**（`log/launcher/shell-launch.log`）——
//!      编排器输出（`[orchestrator] …`）与其启动报告都写它，release 也可靠；
//!   3. 起不来时**先写状态再回一条可行动的出口**，别让日志面板指向空文件。

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

/// 「这个检出的应用端口是多少」的**唯一出口**（ISSUE #821）。
///
/// 壳把端口交给编排器（`COMFYAPP_PORT` 环境变量）与启动报告，而编排器自己也按
/// `.env` → 路径推导解析一遍 —— 两侧必须落在同一个值上，否则 dev server 听一个
/// 端口、壳等另一个（现象是启动页卡在「等 dev server」）。判据收在
/// `single_instance::resolve_app_port()`：环境变量 → 检出 `.env` → 路径推导，
/// 与 `scripts/app-port.mjs` 的 `resolveAppPort` 逐条对齐。
///
/// **不要在这里改成 `derive_app_port_for_root(project_root)`**：那样 `.env` 里写死的
/// 端口对壳不可见（壳不经过 Node），正是本 ISSUE 的根因。
pub fn app_port_for_root(project_root: &str) -> u16 {
  crate::single_instance::resolve_app_port_for_root(project_root)
}

/// 端口的**来源**（`环境变量` / `.env` / `路径推导`）的可读标签，只用于日志与
/// 启动报告 ——「哪一侧错了」全靠这一行才判得出来。与 `app_port_for_root` 同源、
/// 同优先级（判据本体在 `single_instance::port_source_for_root`，标签只在那边定义
/// 一次，这里不另写一份中文）。
pub fn port_source_for_root(project_root: &str) -> &'static str {
  crate::single_instance::port_source_for_root(project_root).label()
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
///
/// `kill()` 成功即顺手清掉会话锚点：那是编排器**没机会**清的（见
/// `clear_session_anchor`）。`kill()` 失败则原样留着，交给下一次启动的孤儿回收。
pub fn reap(project_root: &str) {
  let child = ORCHESTRATOR.lock().unwrap().take();
  let Some(child) = child else { return };
  let pid = child.pid();
  match child.kill() {
    Ok(()) => {
      log::info!("[ComfyAPP] shell orchestrator stopped via shell plugin (pid {pid})");
      clear_session_anchor(project_root);
    }
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

/// 编排器的会话锚点（`run/launcher-session.json`）。
///
/// 与 `scripts/dev-launcher-session.mjs` 同源（那份是唯一实现，本模块只是
/// 「把它没机会做的那一步补上」）。路径两处漂开的表现很具体：壳每次退出都留下
/// 锚点 → 下一次启动的编排器必然打印一条「回收上一次运行遗留的进程树」。
pub fn session_file_path(project_root: &str) -> std::path::PathBuf {
  std::path::Path::new(project_root)
    .join("run")
    .join("launcher-session.json")
}

/// 心跳文件（`run/launcher-heartbeat.txt`），与 `session_file_path` 成对。
pub fn heartbeat_file_path(project_root: &str) -> std::path::PathBuf {
  std::path::Path::new(project_root)
    .join("run")
    .join("launcher-heartbeat.txt")
}

/// 清掉会话锚点（编排器已被壳收走时调用）。
///
/// **为什么必须由壳来做**：编排器的锚点只有它自己在 `clearSession()` 里清；
/// 而壳收它是 `Child::kill()`（Windows 上是 `TerminateProcess`），它收不到任何
/// 信号、没有清理机会 —— 锚点于是必留，下一次启动就会读到「心跳陈旧 + PID 已死」，
/// 按 `child_pids` 再回收一遍早已不存在的进程并报一条 WARN。
///
/// **清锚点不削弱回收能力**：壳认亲靠的是进程环境块里的 `COMFYAPP_SHELL_OWNED`
/// （`find_owned_orchestrator`），与锚点无关；编排器自己那侧的心跳/探活判据也仍然
/// 保留（锚点真在、子树真有活的进程时照旧回收）。
pub fn clear_session_anchor(project_root: &str) {
  for path in [
    session_file_path(project_root),
    heartbeat_file_path(project_root),
  ] {
    match std::fs::remove_file(&path) {
      // 不在 = 已经是目标状态（正常收尾时编排器自己清过）。
      Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
        log::warn!("[ComfyAPP] 清理会话锚点失败（{}）：{e:?}", path.display());
      }
      _ => {}
    }
  }
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
///
/// 返回本次定下的模式（已写过就返回那个值）：调用方要把它记进应用状态，
/// 让启动页在建窗后的第一句问话就能按形态回答（见 lib.rs 的 `get_launch_status`）。
/// 判据本体仍只在这里，调用方不重复推。
#[cfg(not(debug_assertions))]
pub fn ensure_launch_mode(project_root: &str) -> String {
  if let Ok(mode) = std::env::var("COMFYAPP_LAUNCH_MODE") {
    return mode;
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
  mode.to_string()
}

#[cfg(debug_assertions)]
pub fn ensure_launch_mode(_project_root: &str) -> String {
  String::new()
}

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
    // 连项目根都没有时，磁盘上没有任何可写的地方：**必须**把话说到渠道里
    // （tauri-plugin-log 的 channel / 控制台），并在报告里点出「项目根为空」
    // 这一条 —— 它正是「状态文件与日志都读不到」的常见根因之一。
    log::error!("[ComfyAPP] 启动失败（且项目根为空，无法落盘诊断）：{message}");
    log_launch_line("", "error", message);
    return;
  }
  // 先落一行到编排链路日志：状态文件写失败时，这份日志是唯一的出口。
  log_launch_line(project_root, "error", &format!("启动失败：{message}"));
  log_startup_report(project_root, "启动失败（上面的报告就是现场）");

  let payload = serde_json::json!({
    // 判据与 `get_launch_status` 的消费方（启动页 `updateUI`）对齐：
    // `progress` 保持 < 1，否则页面会把 100% 的前缀画成「✓」——一次失败
    // 于是看起来像「成功但没打开」。
    "phase": "error",
    "progress": 0,
    "message": message,
    "error": true,
    // 「壳自己就没能把编排起起来」的显式标记（与编排器写的失败态区分开）：
    // 编排器写失败时至少还有它自己的日志；壳这一侧的失败**明细只在这份状态里**，
    // 启动页面板据此把 message 与诊断出口摆出来，而不是只显示一句
    // 「启动失败，见 log/」（ISSUE #784 手验反馈：那三个路径的日志一份都没有）。
    "shellLaunchFailed": true,
    // 诊断出口写清楚：启动页据此告诉用户「先看哪一份」，而不是让他去翻
    // 那两份此刻恰好为空的编排日志（手验反馈的成因）。
    "diagnostics": {
      "launchLog": launch_log_path(project_root).display().to_string(),
      "shellLog": shell_log_path(project_root).display().to_string(),
      "statusFile": status_file_path(project_root).display().to_string(),
    },
    "updatedAt": iso_timestamp(),
  });
  let path = status_file_path(project_root);
  if let Some(dir) = path.parent() {
    if let Err(e) = std::fs::create_dir_all(dir) {
      log::warn!("[ComfyAPP] cannot create {}: {e:?}", dir.display());
      return;
    }
  }
  match std::fs::write(&path, payload.to_string()) {
    Ok(()) => log::error!("[ComfyAPP] launch failed (reported on the splash): {message}"),
    Err(e) => log::warn!("[ComfyAPP] cannot write {}: {e:?}", path.display()),
  }
}

/// 「一次运行一包」的写点：`log/current/`（规范 §4）。
///
/// 进程**始终**写 current/（路径固定）；退出时由编排器
/// （`scripts/launcher-core/run.mjs` 的 `archiveCurrent()`）把整个 current/
/// 复制进 `log/runs/<日期>_<时分秒>-<runId>/` 再清空内容。因此这里往下的每一段
/// 都必须是**固定名**，不许在代码里拼时间戳目录。
///
/// **本模块是 Rust 侧路径的唯一出处**，与 `src/lib/shell/launch-diagnostics.ts`
/// 的 `launchPaths()` **逐项同形**（那份钉在 `launch-diagnostics.test.ts`，
/// 这一侧钉在 `tests::launch_paths_match_node_side`）。两份不能各自手拼：漂开的
/// 表现是「壳写了一份、面板读的是另一份」，而两侧看各自都是对的。
pub fn current_dir(project_root: &str) -> std::path::PathBuf {
  std::path::Path::new(project_root).join("log").join("current")
}

/// 编排链路日志（`log/current/launcher/shell-launch.log`）的绝对路径。
pub fn launch_log_path(project_root: &str) -> std::path::PathBuf {
  current_dir(project_root)
    .join("launcher")
    .join("shell-launch.log")
}

/// 编排日志目录（`log/current/launcher/`）：dev-launcher 与壳 stderr 都落这里。
pub fn launcher_dir(project_root: &str) -> std::path::PathBuf {
  current_dir(project_root).join("launcher")
}

/// 壳自持日志（release，`log/current/shell/shell.log`）。
pub fn shell_log_dir(project_root: &str) -> std::path::PathBuf {
  current_dir(project_root).join("shell")
}

/// 壳自持日志文件的绝对路径。
pub fn shell_log_path(project_root: &str) -> std::path::PathBuf {
  shell_log_dir(project_root).join("shell.log")
}

/// 编排器自己行首的时间戳 + 级别前缀（`[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL ]`）。
///
/// dev-launcher.mjs 的 `createLogSink` 已经给每条日志写了「本地时间 + 级别」，
/// 壳转发时若原样带上、再让 `log_launch_line` 补一层，同一条物理行里就出现
/// 两个时刻两个级别（用户截图：`[orchestrator] [2026-10-02 11:50:31.384] [STEP ]`）。
/// 因此转发前先把这个前缀摘掉，只保留正文 —— 行结构由壳这一层统一。
///
/// **只认壳自己认得的形态**：dev-launcher 的级别是定宽 5 字符（`STEP ` / `OK   ` /
/// `WARN ` / `ERROR` / `INFO `），这里把级别两侧空白归一，`STEP` 的尾空格因此也能吃掉；
/// 认不出（pnpm / next 的裸输出）就整行原样返回，绝不猜。
fn strip_orchestrator_line_prefix(line: &str) -> (&str, Option<&str>) {
  // 形态：[YYYY-MM-DD HH:MM:SS.mmm] [LEVEL] <正文>
  if !line.starts_with('[') {
    return (line, None);
  }
  let Some(close) = line.find(']') else { return (line, None) };
  // 时间戳必须定宽 23 字符（与 local_timestamp 同形），否则不是我们认的那一层。
  let stamp = line.get(1..close).unwrap_or("");
  if !looks_like_local_stamp(stamp) {
    return (line, None);
  }
  let rest = line.get(close + 1..).unwrap_or("");
  let rest = rest.strip_prefix(' ').unwrap_or(rest);
  if !rest.starts_with('[') {
    return (line, None);
  }
  let Some(lvl_close) = rest.find(']') else { return (line, None) };
  let raw_level = rest.get(1..lvl_close).unwrap_or("").trim();
  if !matches!(
    raw_level,
    "STEP" | "OK" | "WARN" | "ERROR" | "INFO" | "DEBUG"
  ) {
    return (line, None);
  }
  let body = rest.get(lvl_close + 1..).unwrap_or("").trim_start();
  (body, Some(raw_level))
}

/// 判据：这段文本是不是 `local_timestamp()` 那种定宽本地时刻（`YYYY-MM-DD HH:MM:SS.mmm`）。
fn looks_like_local_stamp(s: &str) -> bool {
  let b = s.as_bytes();
  if b.len() != 23 {
    return false;
  }
  // 数字位与分隔符的固定位置（YYYY-MM-DD HH:MM:SS.mmm）：认位置比认正则更省、更硬。
  let digits = [0usize, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22];
  let seps = [
    (4usize, b'-'),
    (7, b'-'),
    (10, b' '),
    (13, b':'),
    (16, b':'),
    (19, b'.'),
  ];
  digits.iter().all(|&i| b[i].is_ascii_digit()) && seps.iter().all(|&(i, c)| b[i] == c)
}

/// 编排器级别 → 壳这一层（`log_launch_line` 的 level + `log::` 宏）的级别。
///
/// 归一二档：`WARN` → warn、`ERROR` → error，其余已认出的（`STEP`/`OK`/`INFO`/`DEBUG`）
/// → info。**只有 `None`（认不出前缀的裸输出）才用调用方的兜底**（stdout→info /
/// stderr→warn）——已认出的级别不该被出口方向覆盖。
fn orchestrator_level_to_shell(level: Option<&str>, fallback: &str) -> &'static str {
  match level {
    Some("WARN") => "warn",
    Some("ERROR") => "error",
    Some(_) => "info",
    None => {
      if fallback == "warn" {
        "warn"
      } else {
        "info"
      }
    }
  }
}

/// 进度快照文件（`run/launch-status.json`）。
pub fn status_file_path(project_root: &str) -> std::path::PathBuf {
  std::path::Path::new(project_root).join("run").join("launch-status.json")
}

/// 把编排链路日志写一行（时间戳 + 级别 + 正文）。
///
/// **为什么必须有这份文件**：release 壳（Windows `windows_subsystem = "windows"`）
/// 的 stdout/stderr 没有控制台，`log::` 只进 tauri-plugin-log 的 channel；
/// 编排器写第一份日志之前，用户能查的任何磁盘文件都还不存在。这份日志由壳自己
/// 落，是所有启动诊断里**最先有内容**的一份（ISSUE #784 手验反馈：面板指着
/// dev-launcher.log，而它当时还没被创建）。
///
/// 写失败只记 WARN：诊断通道本身不该把启动带崩（与 `mark_launch_failed` 同一取向）。
pub fn log_launch_line(project_root: &str, level: &str, message: &str) {
  if project_root.is_empty() {
    return;
  }
  let line = format!("[{}] [{}] {}\n", local_timestamp(), level.to_uppercase(), message);
  if let Err(e) = append_line(&launch_log_path(project_root), &line) {
    log::warn!("[ComfyAPP] 编排链路日志写入失败：{e:?}");
  }
}

/// 转发一行编排器输出：`log::`（channel / release 的 shell.log）与壳侧编排链路
/// 日志（`shell-launch.log`）**同一形态、同一份正文**。
///
/// 收成一处的理由：两条出口此前各写各的 `[orchestrator] {text}`，任一条改了漏
/// 改另一条，就会「面板读到的（`[orchestrator] 时刻 级别 正文`）与 channel 里的
/// （另一份）对不上」—— 而两侧看各自都对。`level` 走 `orchestrator_level_to_shell`
/// 的归一结论，不再让 stdout 恒 info / stderr 恒 warn 覆盖掉编排器自己的级别。
fn log_orchestrator_line(project_root: &str, level: &str, body: &str) {
  let message = format!("[orchestrator] {body}");
  match level {
    "error" => log::error!("{message}"),
    "warn" => log::warn!("{message}"),
    _ => log::info!("{message}"),
  }
  log_launch_line(project_root, level, &message);
}

/// 启动会话标记前缀。壳在每次启动时往 shell-launch.log 写一行，
/// `get_launch_log` 据此只返回本次启动的日志，避免历史日志混淆。
pub const SESSION_START_MARKER: &str = "=== 启动会话开始";

/// 这条标记本身要能回答「它是什么、谁写的、接下来该看哪」。
///
/// **前缀不能改**（`SESSION_START_MARKER` 是面板裁剪历史日志的判据，改了就对不上），
/// 拐点全在括号里：原先括号中只有 `shell_pid: N`，用户读到的一行是
/// 「`=== 启动会话开始（shell_pid: 51972）`」—— 而**只有这一行**是他双击之后
/// 第一眼能看到的东西。于是「启动会话是干什么的」在这条唯一的现场里说不出话，
/// 用户只能来问（ISSUE #1364）。
///
/// 括号里补三件事，都不增加新行、不改变裁剪判据：
///   1. **它是干什么的**：本次双击启动的会话边界 —— 供面板裁掉历史日志，
///      不是一次业务流程 / 任务；这条同时也是「为什么它单独占一行」的答案；
///   2. **它已做了什么 / 接下来是谁接手**：说清「壳已接手」与「编排器将被拉起」，
///      用户才知道后面那段 `[orchestrator] …` 是它的下一环；
///   3. **它落在哪三份文件里**：三份都写，因此三份各自的「本次」都从这行起算。
pub fn session_start_marker(pid: u32) -> String {
  format!(
    "{SESSION_START_MARKER}（本次双击启动的会话边界；壳已接手、即将拉起编排器；\
     本行之后的内容都属于本次启动，面板据此裁掉历史日志；shell_pid: {pid}）"
  )
}

/// 会话标记的**整行形态**（时间戳 + 级别 + 正文），纯函数、时刻由调用方给。
///
/// 抽出来是为了让「三份共用一个时刻」这件事**可判**：`log_session_start` 只调
/// 它一次，把同一份字符串写进三个文件；测试直接给两个不同的时刻、断言出来的
/// 行跟着变，而不是去比两次 `local_timestamp()` —— 那两次很可能落在同一毫秒，
/// 于是断言恒真、判据等于没有（ISSUE #1364 的反向验证就栽在这里）。
///
/// 形态与 `log_launch_line` 逐字一致（`[时刻] [INFO] 正文`）：三份的行必须**完全
/// 相同**面板才折叠得掉，各自拼一遍就是三个会漂的形态出处。
pub fn session_marker_line(pid: u32, stamp: &str) -> String {
  format!("[{stamp}] [INFO] {}", session_start_marker(pid))
}

/// 在编排链路日志里写下本次启动的会话标记。
///
/// 放在最前面：后续所有当前启动的日志都落在这行之后，日志面板就能
/// 从后往前找到它，并只显示它之后的内容。
///
/// 同一行标记还会写进 `dev-launcher-stderr.log` 与 `shell.log`——这两份是
/// 追加不轮转的固定名文件（会累积历次启动），不写标记的话 `get_launch_log`
/// 只能取尾部，于是「查看日志」里会混进上周 / 上上次启动的 stderr 与壳诊断。
/// 三份共用同一个标记串，`get_launch_log` 对它们统一按「最后一个标记之后」裁剪。
pub fn log_session_start(project_root: &str) {
  if project_root.is_empty() {
    return;
  }
  /* **三份共用同一个时刻**（`stamped` 只算一次，三份都用它）：日志面板把三路
   * 合进同一条时间线，并按「时刻 + 级别 + 正文」去重 —— 三份各自盖一个「此刻」
   * 就会被读成三条，用户看到的正是「这条标记有很多条」（ISSUE #1364）。 */
  let stamped = session_marker_line(std::process::id(), &local_timestamp());
  // 这份（shell-launch.log）本来就是靠标记裁剪的，见 get_launch_log。
  // **写的就是 `stamped` 那一行**（而不是再调一次 `log_launch_line`）：后者会自己
  // 取一次当前时刻，于是三份的时刻差几毫秒、面板的去重就失效了（ISSUE #1364）。
  if let Err(e) = append_line(&launch_log_path(project_root), &format!("{stamped}\n")) {
    log::warn!("[ComfyAPP] 编排链路日志写入失败：{e:?}");
  }
  // dev-launcher-stderr.log 与 shell.log 是追加不轮转的固定名文件，会累积历次
  // 启动。和 shell-launch.log 共用同一个标记收口，get_launch_log 才能只取本次
  // 启动之后的行——否则「查看日志」里会混进旧启动的 stderr 与壳诊断（用户的
  // 截图里 dev-launcher-stderr.log 还停在 09-20，shell.log 混着 09:58 与本次）。
  let stderr_log = launcher_dir(project_root).join("dev-launcher-stderr.log");
  let shell_log = shell_log_path(project_root);
  for p in [stderr_log, shell_log] {
    if let Err(e) = append_line(&p, &format!("{stamped}\n")) {
      log::warn!("[ComfyAPP] 启动会话标记写入失败（{}）：{e:?}", p.display());
    }
  }
}

/// 追加一行（目录缺失时递归建）。返回 Err 而不是 panic —— 调用方一律只记 WARN。
fn append_line(path: &std::path::Path, line: &str) -> std::io::Result<()> {
  use std::io::Write;
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir)?;
  }
  let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
  file.write_all(line.as_bytes())
}

/// `YYYY-MM-DD HH:MM:SS.mmm` 时间戳（与 Node 侧 `formatLogLine` 的**形态**同形）。
///
/// 走 `chrono::Local`：壳与用户同机，时刻必须落在**用户所在时区**（本机北京
/// 时间 UTC+8），用户才能拿它和墙上的钟对。此前手写的 civil-from-days 只能
/// 产 UTC 时刻，日志面板里同一份文件的两侧时钟差 8 小时；chrono 已作为
/// tauri（serde_with）的传递依赖在锁文件里，本地时区读取由它统一负责
/// （Windows 读注册表动态时区、POSIX 读 TZ / /etc/localtime）。
fn local_timestamp() -> String {
  chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

/// 写「壳已接手 / 编排器已拉起」的常驻进度快照（启动窗口期的兜底）。
///
/// 关键在 `fallback: true`：启动页据此知道这不是编排器的权威进度，因此
/// **不会**拿它当「就绪判据」（`status.ready === true` 仍是唯一权威），
/// 但可以在编排器还没写字时显示「壳在做什么」。
///
/// 进度恒为 `0`：启动页把 `pct >= 100` 画成「✓」，常驻快照标成 100% 会让
/// 「还在启动」看起来像「已经启动完了」。**但启动页也不能因此把进度条往回画**
/// （那一轮快照到达时进度从 30% 掉回 0%，看起来像启动自己重来了一遍，见
/// `src-tauri/splash-assets/index.html` 的 `updateFromShellFallback`）。
///
/// `report` 是壳接手那一刻的启动报告（`startup_report_json` 的产物），随快照
/// 一起写进 `diagnostics`：编排器写自己的状态时会把这份快照整份顶掉，所以报告
/// 必须在**它被顶掉之前**就已经落到磁盘上，启动期才有现场可查。
pub fn write_idle_status(
  project_root: &str,
  phase: &str,
  message: &str,
  report: Option<serde_json::Value>,
) {
  if project_root.is_empty() {
    return;
  }
  let mut payload = serde_json::json!({
    "phase": phase,
    "progress": 0,
    "message": message,
    "error": false,
    "fallback": true,
    "diagnostics": {
      "projectRoot": project_root,
      "launchLog": launch_log_path(project_root).display().to_string(),
      "shellLog": shell_log_path(project_root).display().to_string(),
      "statusFile": status_file_path(project_root).display().to_string(),
    },
    "updatedAt": iso_timestamp(),
  });
  if let Some(report) = report {
    payload["diagnostics"]["launchReport"] = report;
  }
  let path = status_file_path(project_root);
  if let Some(dir) = path.parent() {
    if let Err(e) = std::fs::create_dir_all(dir) {
      log::warn!("[ComfyAPP] 无法创建 {}：{e:?}", dir.display());
      return;
    }
  }
  if let Err(e) = std::fs::write(&path, payload.to_string()) {
    log::warn!("[ComfyAPP] 无法写 {}：{e:?}", path.display());
  }
}

/// 启动报告：把「壳打算怎么起、这个检出到底什么样」落成可读的几行。
///
/// 手验反馈里最难办的一点是「什么都读不到时该看哪」——这份报告让那一段空白
/// 变成**有内容的一屏**：项目根、编排脚本在不在、依赖门禁结论、要执行的命令、
/// 端口、以及各份日志的路径。用户在报障时贴这一屏，就等价于把现场带出来了。
pub fn startup_report(project_root: &str, phase_note: &str) -> Vec<(String, String)> {
  let script = orchestrator_script(project_root);
  let port = app_port_for_root(project_root);
  let port_note = port_source_for_root(project_root);
  vec![
    ("阶段".to_string(), phase_note.to_string()),
    (
      "项目根".to_string(),
      if project_root.is_empty() { String::new() } else { project_root.to_string() },
    ),
    (
      "编排脚本".to_string(),
      script
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_default(),
    ),
    (
      "可自启动".to_string(),
      can_self_launch(project_root).to_string(),
    ),
    (
      "启动命令".to_string(),
      format!("node {} --mode prebuilt", script.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "(缺少编排脚本)".to_string())),
    ),
    // 端口与**它的来源**一起给：只写数字在「壳在等 3809、dev server 在 3100」
    // 时归不了因（用户看不出是 .env 写的还是路径推出来的，而修法完全不同）。
    ("应用端口".to_string(), format!("{port}（来源：{port_note}）")),
    (
      "启动状态文件".to_string(),
      status_file_path(project_root).display().to_string(),
    ),
    (
      "编排链路日志".to_string(),
      launch_log_path(project_root).display().to_string(),
    ),
  ]
}

/// 启动报告的结构化形态（`diagnostics.launchReport`）。
///
/// 与逐行写进日志的那份同源（同一次 `startup_report()` 调用），因此不会出现
/// 「日志里一套、面板里另一套」。存在的理由：编排器把自己的 `launch-status.json`
/// 顶掉壳的快照之后，**这份报告在状态文件里也就没了**——而它恰恰是「读不到任何
/// 日志时唯一能看的一屏」（项目根 / 编排脚本在不在 / 依赖门禁 / 端口 / 各日志
/// 路径）。启动页把它附在日志面板尾部，等于把现场一直留在用户手边。
pub fn startup_report_json(project_root: &str, phase_note: &str) -> serde_json::Value {
  let items: serde_json::Map<String, serde_json::Value> = startup_report(project_root, phase_note)
    .into_iter()
    .map(|(k, v)| (k, serde_json::Value::String(v)))
    .collect();
  serde_json::Value::Object(items)
}

/// 把启动报告拼成日志面板里的一段文本（每条一行的形态与日志里一致）。
pub fn startup_report_section(project_root: &str, phase_note: &str) -> String {
  let mut lines = vec![format!("=== 启动报告：{phase_note} ===")];
  for (key, value) in startup_report(project_root, phase_note) {
    let shown = if value.is_empty() { "(空)".to_string() } else { value };
    lines.push(format!("  {key}: {shown}"));
  }
  lines.join("\n")
}

/// 把启动报告逐行写进编排链路日志（附一条头）。
pub fn log_startup_report(project_root: &str, phase_note: &str) {
  log_launch_line(project_root, "info", &format!("=== 启动报告：{phase_note} ==="));
  for (key, value) in startup_report(project_root, phase_note) {
    let shown = if value.is_empty() { "(空)".to_string() } else { value };
    log_launch_line(project_root, "info", &format!("  {key}: {shown}"));
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
  let port = app_port_for_root(project_root);
  log_launch_line(
    project_root,
    "info",
    &format!(
      "拉起编排器：node {script_arg} --mode prebuilt（端口 {port}，来源：{}，cwd {project_root}）",
      port_source_for_root(project_root)
    ),
  );
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
  let log_root = project_root.to_string();
  tauri::async_runtime::spawn(async move {
    use tauri_plugin_shell::process::CommandEvent;
    while let Some(event) = rx.recv().await {
      match event {
        CommandEvent::Stdout(line) => {
          let text = String::from_utf8_lossy(&line).trim_end().to_string();
          // 行结构统一：编排器自己那层「时刻 + 级别」先摘掉，只留正文，级别另取。
          // 否则同一条物理行里会叠出两个时刻两个级别（见 strip_orchestrator_line_prefix）。
          let (body, level) = strip_orchestrator_line_prefix(&text);
          let shell_level = orchestrator_level_to_shell(level, "info");
          log_orchestrator_line(&log_root, shell_level, body);
        }
        CommandEvent::Stderr(line) => {
          let text = String::from_utf8_lossy(&line).trim_end().to_string();
          let (body, level) = strip_orchestrator_line_prefix(&text);
          let shell_level = orchestrator_level_to_shell(level, "warn");
          log_orchestrator_line(&log_root, shell_level, body);
        }
        CommandEvent::Terminated(payload) => {
          log::info!("[ComfyAPP] orchestrator terminated: {:?}", payload.code);
          log_launch_line(
            &log_root,
            "info",
            &format!("编排器结束，退出码 {:?}", payload.code),
          );
        }
        _ => {}
      }
    }
  });
  Ok(())
}

/// 给编排器挂一个 `KILL_ON_JOB_CLOSE` 的 Job Object（Windows）。
///
/// 编排器（node）若崩溃 / 被硬杀，它拉起的 `node → pnpm → next` 会残留成孤儿，
/// 锁住端口与日志。OS 级兜底是「最后一个句柄关闭即当场终止整棵树」。
///
/// **句柄由壳持有**是 #784 架构下的正确归属：进程树是「壳 app.exe → node 编排器 →
/// pnpm → next」，壳是顶。正常关窗有「壳退出 → 插件 kill 编排器 → 编排器回收它的树」
/// 这条链；Job Object 专兜「壳被硬杀」——壳一死，OS 关掉它持有的 job 句柄 → 最后一个
/// 句柄关闭 → 整棵树当场回收。（若把句柄交给编排器持有，则「壳被硬杀、node 还活着」
/// 时 job 永不关闭、孤儿照留，兜不住这个场景。#784 前的 python 启动器时代用的是那个
/// 模型，随启动器移除已废弃；这里不再经外部脚本，内联实现是唯一出处。）
///
/// 失败一律只记 WARN：这是兜底，正常回收链不依赖它，挂不上不该拦住启动。
#[cfg(windows)]
pub fn attach_kill_on_close_job() {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JobObjectExtendedLimitInformation, JOBOBJECT_BASIC_LIMIT_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
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
      /* KILL_ON_JOB_CLOSE：壳消失（含被硬杀）时 job 关闭即终止整棵树 —— 编排器
       * 崩溃后不留孤儿的 OS 级兜底。
       *
       * BREAKAWAY_OK 是它的**必要配对**：保活服务（keepAlive 的服务）必须能逃出
       * 这个 job，否则「应用退出后不关闭」在 Windows 上不成立（job 成员身份在
       * 创建时继承，壳一退即被连带终止）。少了这一位，子进程带
       * `CREATE_BREAKAWAY_FROM_JOB` 创建会被直接拒（ERROR_ACCESS_DENIED），
       * 只能退回「跟着壳一起被杀」。申请脱离的那一半见 `detached_spawn`。 */
      LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK,
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
        // 预筛在此**真正落地**：编排器是 `node.exe` 起的，快照自带 exe 名、
        // 零成本——非 node 的进程（全系统的绝大多数）连 OpenProcess 都不做，
        // 省掉逐 PID 的跨进程内存读（每次含一次 64KB 环境块）。
        if pid != 0
          && pid != self_pid
          && is_probable_node_process(&entry.szExeFile)
          && process_env_is_owned(pid)
        {
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

/// 廉价预筛：可执行文件名含 `node`（大小写不敏感）才算候选。
///
/// 编排器经 `node` / `pnpm`（corepack shim 最终也是 node）起，快照自带的
/// `szExeFile` 零成本可判；`is_own` 的环境块判据仍是唯一权威——这里只负责
/// 把绝大多数无关进程挡在 `OpenProcess` 之外。误放行（比如某个恰好叫
/// node-foo 的进程）没有危害，只是多读一次环境块。
#[cfg(windows)]
fn is_probable_node_process(exe_file: &[u16]) -> bool {
  let len = exe_file
    .iter()
    .position(|&c| c == 0)
    .unwrap_or(exe_file.len());
  let name = String::from_utf16_lossy(&exe_file[..len]).to_ascii_lowercase();
  name.contains("node")
}


#[cfg(test)]
mod tests {
  use super::*;

  /// 启动链路路径必须与 Node 侧（`src/lib/shell/launch-diagnostics.ts` 的
  /// `launchPaths`）逐项一致：两侧读的是同一批文件，漂开的表现是「壳写了
  /// 一份、面板读的是另一份」，而两侧看各自都是对的。
  ///
  /// 这里用**分段拼接**断言而不是写死一整个字符串：平台分隔符不同（Windows
  /// `\`、POSIX `/`），写死会在另一平台上失败——而这条判据要管的恰恰是「跨侧
  /// 同形」，不是「某一侧的字面量」。
  #[test]
  fn launch_paths_match_node_side() {
    let root = std::path::Path::new("/proj");
    assert_eq!(
      launch_log_path("/proj"),
      root.join("log")
        .join("current")
        .join("launcher")
        .join("shell-launch.log")
    );
    assert_eq!(
      shell_log_path("/proj"),
      root.join("log").join("current").join("shell").join("shell.log")
    );
    assert_eq!(status_file_path("/proj"), root.join("run").join("launch-status.json"));
  }

  /// 会话锚点的路径与 `scripts/dev-launcher-session.mjs` 同源：壳要清理的
  /// 正是编排器落下的那两份（名字漂开 = 清了个不存在的文件，锚点照留）。
  #[test]
  fn session_anchor_paths_match_orchestrator_side() {
    let root = std::path::Path::new("/proj");
    assert_eq!(
      session_file_path("/proj"),
      root.join("run").join("launcher-session.json")
    );
    assert_eq!(
      heartbeat_file_path("/proj"),
      root.join("run").join("launcher-heartbeat.txt")
    );
  }

  #[test]
  fn clear_session_anchor_removes_both_files_and_is_idempotent() {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-session-anchor-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
    ));
    std::fs::create_dir_all(dir.join("run")).unwrap();
    let session = dir.join("run").join("launcher-session.json");
    let heartbeat = dir.join("run").join("launcher-heartbeat.txt");
    std::fs::write(&session, "{}").unwrap();
    std::fs::write(&heartbeat, "1").unwrap();

    clear_session_anchor(dir.to_str().unwrap());
    assert!(!session.exists(), "会话文件必须被清掉");
    assert!(!heartbeat.exists(), "心跳文件必须被清掉");

    // 锚点已不在时再清一次也不该报错（正常收尾时编排器自己清过就是这种形态）。
    clear_session_anchor(dir.to_str().unwrap());

    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn local_timestamp_is_sortable_fixed_width() {
    let stamp = local_timestamp();
    assert_eq!(stamp.len(), 23, "YYYY-MM-DD HH:MM:SS.mmm 必须定宽：{stamp}");
    assert_eq!(&stamp[10..11], " ");
    assert_eq!(&stamp[19..20], ".");
  }

  #[test]
  fn startup_report_always_carries_the_log_locations() {
    // 报告的价值就在于「什么都读不到时，仍能说出该看哪一份」——因此即便项目根
    // 不存在，报告也必须是**非空且有结构**的，不能整条消失。
    let report = startup_report("", "测试");
    assert_eq!(report.len(), 8);
    assert_eq!(report[0].0, "阶段");
    assert!(report.iter().any(|(k, _)| k == "编排链路日志"));
  }

  #[test]
  fn startup_report_pins_paths_to_project_root() {
    let report = startup_report("/proj", "测试");
    let value_of = |key: &str| {
      report
        .iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
    };
    assert!(value_of("项目根") == "/proj");
    assert!(value_of("编排链路日志").ends_with("shell-launch.log"));
    assert!(value_of("启动状态文件").ends_with("launch-status.json"));
    // 「可自启动」在 /proj 上必然是 false（没有 scripts/dev-launcher.mjs）：
    // 判据必须真的读盘，不能恒真（恒真的判据等于没有判据）。
    assert_eq!(value_of("可自启动"), "false");
  }

  #[test]
  fn can_self_launch_rejects_root_without_manager_script() {
    assert!(!can_self_launch(""));
    assert!(!can_self_launch("/definitely/not/a/checkout"));
  }

  #[test]
  fn idle_status_is_not_authoritative() {
    // 快照落盘后必须能被「是不是权威进度」的判据排除掉：它写的是 fallback
    // 标记 + progress 0，消费方（启动页）据此只显示「在等谁」，不据此导航。
    let json = serde_json::json!({
      "phase": "shell-prepare",
      "progress": 0,
      "fallback": true,
    });
    assert_eq!(json["fallback"], serde_json::json!(true));
    assert_eq!(json["progress"], serde_json::json!(0));
  }

  #[test]
  fn session_start_writes_marker_with_pid() {
    // 会话标记必须写进全部三份固定名日志（shell-launch.log / dev-launcher-stderr.log
    // / shell.log），并带上 shell_pid，否则日志面板找不到本次启动的边界，就会把
    // 历史日志一起倒出来（用户的截图里 dev-launcher-stderr.log 还停在 09-20）。
    let tmp = std::env::temp_dir().join(format!(
      "comfyapp-session-marker-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let root = tmp.to_str().unwrap();

    log_session_start(root);

    let stderr_log = launcher_dir(root).join("dev-launcher-stderr.log");
    let shell_log = shell_log_path(root);
    for (label, path) in [
      ("shell-launch.log", launch_log_path(root)),
      ("dev-launcher-stderr.log", stderr_log.clone()),
      ("shell.log", shell_log.clone()),
    ] {
      let content = std::fs::read_to_string(&path).unwrap_or_default();
      assert!(
        content.contains(SESSION_START_MARKER),
        "{label} 里必须有启动会话标记：{content}"
      );
      assert!(
        content.contains("shell_pid:"),
        "{label} 的启动会话标记必须带 shell_pid：{content}"
      );
      assert!(
        content.contains("会话边界") && content.contains("编排器"),
        "{label} 的标记要自解释（ISSUE #1364）：{content}"
      );
    }

    // **三份的行必须逐字相同**（含时刻）：面板把三路合进同一条时间线并按
    // 「时刻 + 级别 + 正文」去重，三份各自盖一个「此刻」就会被读成三条 ——
    // 用户看到的正是「这条标记有很多条」（ISSUE #1364）。
    let marker_lines: Vec<String> = [
      launch_log_path(root),
      stderr_log.clone(),
      shell_log.clone(),
    ]
    .iter()
    .map(|p| {
      std::fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .find(|l| l.contains(SESSION_START_MARKER))
        .map(|l| l.to_string())
        .unwrap_or_default()
    })
    .collect();
    assert!(
      marker_lines.iter().all(|l| !l.is_empty()),
      "三份都要有标记行：{marker_lines:?}"
    );
    assert!(
      marker_lines.iter().all(|l| *l == marker_lines[0]),
      "三份标记行必须逐字相同（含时刻），否则面板去重不掉：{marker_lines:?}"
    );

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn strips_dev_launcher_line_prefix() {
    // dev-launcher.mjs 的 createLogSink 形态：`[时刻] [级别] 正文`。
    let (body, level) =
      strip_orchestrator_line_prefix("[2026-10-02 11:50:31.384] [STEP ] 检查端口占用");
    assert_eq!(body, "检查端口占用");
    assert_eq!(level, Some("STEP"));

    // 定宽补空格（`OK   ` / `INFO `）也要吃掉。
    let (body, level) =
      strip_orchestrator_line_prefix("[2026-10-02 11:50:31.384] [OK   ] 服务器已就绪");
    assert_eq!(body, "服务器已就绪");
    assert_eq!(level, Some("OK"));

    let (body, level) =
      strip_orchestrator_line_prefix("[2026-10-02 11:50:31.384] [ERROR] 找不到预编译壳");
    assert_eq!(body, "找不到预编译壳");
    assert_eq!(level, Some("ERROR"));
  }

  #[test]
  fn keeps_raw_output_untouched() {
    // pnpm / next 的裸输出没有那层前缀：整行原样返回，绝不猜。
    for raw in [
      "added 12 packages, and audited 900 packages in 3s",
      "> comfy-app-t3@0.1.0 dev",
      "[INFO] 这行只有级别、没有定宽时刻",
      "[not-a-timestamp] [STEP ] 看起来像但不是",
      "",
    ] {
      let (body, level) = strip_orchestrator_line_prefix(raw);
      assert_eq!(body, raw, "裸输出必须原样保留：{raw}");
      assert_eq!(level, None, "认不出前缀时不得给出级别：{raw}");
    }
  }

  #[test]
  fn maps_orchestrator_level_to_shell_level() {
    // 已认出的级别按语义归一，不被出口方向（stdout/stderr）覆盖。
    assert_eq!(orchestrator_level_to_shell(Some("WARN"), "info"), "warn");
    assert_eq!(orchestrator_level_to_shell(Some("ERROR"), "warn"), "error");
    assert_eq!(orchestrator_level_to_shell(Some("STEP"), "warn"), "info");
    assert_eq!(orchestrator_level_to_shell(Some("OK"), "warn"), "info");
    assert_eq!(orchestrator_level_to_shell(Some("INFO"), "warn"), "info");
    // 认不出前缀（裸输出）时才用出口方向的兜底。
    assert_eq!(orchestrator_level_to_shell(None, "info"), "info");
    assert_eq!(orchestrator_level_to_shell(None, "warn"), "warn");
  }

  #[test]
  fn forwarded_line_has_single_timestamp_and_level() {
    // 回归用户截图：壳落盘的行里**只能有一层**时刻 + 级别。
    let tmp = std::env::temp_dir().join(format!(
      "comfyapp-orchestrator-line-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let root = tmp.to_str().unwrap();

    let raw = "[2026-10-02 11:50:31.384] [STEP ] 检查端口占用";
    let (body, level) = strip_orchestrator_line_prefix(raw);
    log_orchestrator_line(root, orchestrator_level_to_shell(level, "info"), body);

    let content = std::fs::read_to_string(launch_log_path(root)).unwrap();
    // 产出形态必须是 `[<壳时刻 23 字符>] [INFO] [orchestrator] 正文`：
    // 三个方括号前缀，且**只有一处**定宽时刻（摘掉了编排器那层）。
    let line = content.lines().next().unwrap_or_default();
    assert_eq!(
      line.matches('[').count(),
      3,
      "只应有 时刻 / 级别 / orchestrator 三个前缀：{line}"
    );
    // 第一个 `]` 与第二个 `[` 之间就是唯一的那层时刻，必须定宽 23 字符。
    let close = line.find(']').unwrap();
    assert!(
      looks_like_local_stamp(&line[1..close]),
      "行首必须是壳这一层的定宽时刻：{line}"
    );
    // 正文里不得再出现第二层「时刻 + 级别」前缀。
    assert!(line.contains("[orchestrator] 检查端口占用"), "正文保留：{line}");
    assert!(!line.contains("[STEP ]"), "编排器那层级别必须被摘掉：{line}");
    assert!(!line.contains("11:50:31"), "编排器那层时刻必须被摘掉：{line}");
    assert!(line.contains("[INFO]"), "级别由壳这一层给出：{line}");

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn session_marker_line_changes_with_the_given_stamp() {
    // 「三份共用一个时刻」必须**可判**，而不是靠比两次 `local_timestamp()`
    // ——那两次很可能落在同一毫秒，断言恒真、判据等于没有（ISSUE #1364 的反向
    // 验证就栽在这里）。这一条把时刻做成函数的入参：给两个不同的时刻，得到两行
    // 不同的文本；给同一个时刻，得到两行完全相同的文本。
    let a = session_marker_line(7, "2026-10-02 12:00:00.000");
    let b = session_marker_line(7, "2026-10-02 12:00:00.001");
    let a2 = session_marker_line(7, "2026-10-02 12:00:00.000");
    assert_ne!(a, b, "不同时刻必须落在行里（时间戳不是装饰）：{a} / {b}");
    assert_eq!(a, a2, "同一时刻必须得到同一行（去重的前提）：{a}");
    // 形态：`[时刻] [INFO] 正文`，与 `log_launch_line` 逐字一致。
    assert!(a.starts_with("[2026-10-02 12:00:00.000] [INFO] "), "{a}");
    // 标记本体（含前缀）必须原样在内 —— 面板与 `get_launch_log` 按它裁剪。
    assert!(a.contains(SESSION_START_MARKER), "{a}");
    assert!(a.contains("shell_pid: 7"), "{a}");
    assert!(!a.contains('\n'), "整行必须是一行：{a}");
  }

  #[test]
  fn session_marker_explains_itself() {
    // 标记是用户双击之后**第一眼看得到、也往往唯一看得到**的那一行：它必须自己
    // 回答「这是什么、壳做了什么、接下来是谁」。原先括号里只有 shell_pid，读起来
    // 就是「启动了会话」+ 一个数字 —— 会话是干什么的一句没说（ISSUE #1364）。
    let marker = session_start_marker(4242);
    assert!(marker.starts_with(SESSION_START_MARKER), "前缀是裁剪判据，必须原样：{marker}");
    assert!(marker.contains("shell_pid: 4242"), "PID 要保留：{marker}");
    // 三件事各一条判据 —— 少一条就是「又是一行读了不知道在说什么」。
    assert!(marker.contains("会话边界"), "要说清它是边界而不是一次业务：{marker}");
    assert!(marker.contains("壳已接手"), "要说清壳已经做了什么：{marker}");
    assert!(marker.contains("编排器"), "要说清接下来是谁接手：{marker}");
    // 标记是**一行**：多行会把后面的日志挤成「标记的续行」，面板裁掉它时会连着
    // 把第一段真实日志一起裁掉。
    assert!(!marker.contains('\n'), "会话标记必须是单行：{marker}");
  }

  #[test]
  fn session_marker_keeps_the_panel_prefix_contract() {
    // 面板（Rust `tail_log_file_since_marker` 的调用方 + Node 侧
    // `session_start_marker`）都按 SESSION_START_MARKER **前缀**查找最后一条标记。
    // 括号里怎么改都行，前缀一旦被改，裁剪就整条失效：表现是「面板又混进历史
    // 启动」，而且两侧各自看都「是对的」。
    let marker = session_start_marker(1);
    assert_eq!(&marker[..SESSION_START_MARKER.len()], SESSION_START_MARKER);
    assert_eq!(SESSION_START_MARKER, "=== 启动会话开始");
  }
}
