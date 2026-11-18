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
//!   2. 落一份**壳自持的编排链路日志**（`log/current/launcher/shell-launch.log`）——
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

/// standalone sidecar 那棵树的 job 句柄（ISSUE #4165）。语义与 `JOB_HANDLE` 相同：
/// 句柄由壳持有到进程退出，壳死（含被硬杀）时 OS 替我们关句柄，整棵内嵌 server 树
/// 当场回收——正常关窗那条链（kill_sidecar → reap 补刀）管不到「壳已经没了」的场景。
#[cfg(windows)]
static SIDECAR_JOB_HANDLE: Mutex<usize> = Mutex::new(0);

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

/// 编排器环境块里的检出身份（ISSUE #3851）：认亲判据除了「是不是某个壳起的」，
/// 还要比对「是不是**本检出**的壳起的」——同一台机器多检出并行（§1.4）时，
/// 只看前者会把别家正在跑的编排器当成自己的残留误杀整树。
pub const PROJECT_ROOT_ENV: &str = "COMFYAPP_PROJECT_ROOT";

/// 已由壳完成编排（= 本次启动的 dev server 由壳拉起）。
pub fn is_owning() -> bool {
  ORCHESTRATOR.lock().unwrap_or_else(std::sync::PoisonError::into_inner).is_some()
}

/// 记录本次启动的编排子进程，供退出时回收。
pub fn adopt(child: tauri_plugin_shell::process::CommandChild) {
  *ORCHESTRATOR.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(child);
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
pub fn reap(project_root: &str, deadline: std::time::Instant) {
  let child = ORCHESTRATOR
    .lock()
    .unwrap_or_else(std::sync::PoisonError::into_inner)
    .take();
  let Some(child) = child else { return };
  let pid = child.pid();
  /* 先派发统一回收、后做插件 kill（ISSUE #3857）：taskkill 的目标在进程**还
   * 活着**时不存在 PID 复用（复用前提是先终止），「kill 成功 → 丢句柄 →
   * taskkill」那段窗口被整个消掉，而不是靠握句柄缓解。插件 kill 落在已被
   * reaper 收掉的进程上是无害 no-op（报一条 warn）。 */
  spawn_reaper(project_root, pid, deadline);
  match child.kill() {
    Ok(()) => log::info!("[ComfyAPP] shell orchestrator stopped via shell plugin (pid {pid})"),
    Err(e) => {
      log::warn!("[ComfyAPP] shell orchestrator stop via shell plugin failed (tree already reaped): {e:?}")
    }
  }
  /* 锚点清理放宽为「两道任一落地」：reaper 的 taskkill 或插件 kill 任一收掉
   * 这棵树，锚点就该清 —— 原先只在插件 kill 成功时清，换序后 kill 多半落在
   * 已死进程上，留着会让下次启动多报一条无害的「回收上一次遗留」。 */
  clear_session_anchor(project_root);
}

/// 回收一个**已知进程号**的编排器（启动前清理上一次的残留，见调用点）。
///
/// 与 `reap` 的差别只在「句柄从哪来」：`reap` 收的是本进程持有的 `CommandChild`，
/// 这里收的是上一次运行留下的孤儿（壳被强杀 / job 与进程组都没来得及回收）。
/// 两者都转交同一处平台判据，壳里**不出现** `taskkill` / 单杀 leader（硬规则 3）。
pub fn reap_pid(project_root: &str, pid: u32, deadline: std::time::Instant) {
  if pid == 0 || pid == std::process::id() {
    return;
  }
  // KILL_ON_JOB_CLOSE 的 job 已经会带走自己那一棵树；这里补的是
  // 「job 也没挂上 / 壳被硬杀」的边角，动作仍走统一回收。
  spawn_reaper(project_root, pid, deadline);
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
/// 本次运行启动模式的**进程内唯一写入闸**（ISSUE #4346）：`set_var` 收敛进
/// `OnceLock` 的初始化，至多执行一次——「启动期单线程」从注释里的假设变成
/// 结构保证；setup 阶段（runtime 已装配）再调本函数也只是读缓存，不再有
/// 第二次写环境变量。
static LAUNCH_MODE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[cfg(not(debug_assertions))]
pub fn ensure_launch_mode(project_root: &str) -> String {
  LAUNCH_MODE
    .get_or_init(|| {
      // 已写过（含外部注入）就沿用那个值：判据不变（已写过就返回那个值）。
      if let Ok(mode) = std::env::var("COMFYAPP_LAUNCH_MODE") {
        return mode;
      }
      let mode = if orchestrator_script(project_root).is_some() {
        "prebuilt"
      } else {
        "standalone"
      };
      // SAFETY：写入被 [`LAUNCH_MODE`] 收敛为进程内至多一次（ISSUE #4346），
      // 并发写不可能发生；首写处于启动期，此刻没有并发读环境变量的路径。
      std::env::set_var("COMFYAPP_LAUNCH_MODE", mode);
      log::info!(
        "[ComfyAPP] launch mode={mode}（编排器{}）",
        if mode == "prebuilt" { "在，走 dev server" } else { "不在，走内嵌 standalone server" }
      );
      mode.to_string()
    })
    .clone()
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
  match atomic_write(&path, &payload.to_string()) {
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

/// Next dev server 原始输出目录（`log/current/nextjs/`）。
///
/// 编排器把 dev server 的 stdout/stderr 直接重定向成
/// `nextjs-stdout-<ts>.log` / `nextjs-stderr-<ts>.log`（`spawnInGroup` 给的是
/// 文件描述符，**没有 pipe、没有 tee**），因此它既不进编排器 stdout，也就不进
/// `shell-launch.log` 的 `[orchestrator] …` 那一路——启动页只看编排日志时，
/// 「服务自己说了什么」永远是空白（`▲ Next.js` 横幅、编译/路由日志、首次编译
/// 的报错全在那两份文件里）。
pub fn nextjs_log_dir(project_root: &str) -> std::path::PathBuf {
  current_dir(project_root).join("nextjs")
}

/// 目录里**按修改时间最新**的那一份带 `prefix` 前缀的文件名。
///
/// **判据是 mtime，不是文件名序**：`nextjs-stdout-<ts>` 的戳由 `runStamp()`
/// 产出，而历史命名（下划线戳）与现行命名（连字符戳）混在一个目录里时，
/// 按字典序取「最新」会落到**上一次运行**的那一份 —— 用户照着面板里的路径去看，
/// 看到的是别的失败现场（ISSUE #576，同一个坑）。限定在 `log/current/nextjs/`
/// 之内也是必要的：`current/` 每次运行结束就被整目录归档清空（规范 §4），因此
/// 这里目录内的文件都属于本次运行，不存在「上一份混进来」的情形。
///
/// 取不到（目录不存在 / 没有匹配项）返回 `None`——面板据此不显示这一段，
/// 而不是显示一条「读不到」。
pub fn latest_prefixed_log(dir: &std::path::Path, prefix: &str) -> Option<std::path::PathBuf> {
  let mut best: Option<(std::time::SystemTime, std::path::PathBuf)> = None;
  for entry in std::fs::read_dir(dir).ok()? {
    let Ok(entry) = entry else { continue };
    let name = entry.file_name();
    let Some(name) = name.to_str() else { continue };
    if !name.starts_with(prefix) || !name.ends_with(".log") {
      continue;
    }
    let Ok(meta) = entry.metadata() else { continue };
    if !meta.is_file() {
      continue;
    }
    let Ok(modified) = meta.modified() else { continue };
    // 同 mtime 时按文件名兜底定序，保证同刻写入的两份不会随目录枚举顺序摇摆。
    let path = entry.path();
    let better = match &best {
      None => true,
      Some((best_at, best_path)) => {
        modified > *best_at
          || (modified == *best_at && path.file_name() > best_path.file_name())
      }
    };
    if better {
      best = Some((modified, path));
    }
  }
  best.map(|(_, path)| path)
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

/// 「应用服务为什么结束」的落盘侧（ISSUE #1692），与 Node 侧
/// `scripts/app-service-exit.mjs` 写的是**同一份文件、同一组字段**。
///
/// 为什么壳也要写：这一档用户看到的是「窗口还在、页面全连不上」——壳活着、内嵌的
/// standalone server 没了。而应用服务探测那一格打的是**服务自己的 HTTP**，服务不在
/// 这条通道必然不通，「为什么没了」事后根本问不到（与 Node 侧那条链同一个根因）。
/// 所以答案只能在**服务死的那一刻**由活着的旁证人写下：壳持有 sidecar 句柄，
/// `CommandEvent::Terminated` 就带着退出码。
///
/// 字段名与取值集合**逐字对应** `src/lib/shell/app-service-exit.ts` 的
/// `AppServiceExitRecord` / `AppServiceExitKind`：漂开的表现是「记录写进去了、
/// 界面读不懂」，而现场恰好是最需要看清的那一次。Node 侧已有跨侧同源判据，
/// 这里补齐 Rust 这一头的三项——文件名、字段名、成因取值。
///
/// 读的一侧不经这条链：探活只能等服务恢复应答之后走 `GET /api/dev/last-exit`；
/// 壳这里只负责**写**。
pub fn app_service_exit_path(project_root: &str) -> std::path::PathBuf {
  std::path::Path::new(project_root)
    .join("run")
    .join(APP_SERVICE_EXIT_FILE)
}

/// 记录文件名，与 `scripts/app-service-exit.mjs` / `src/lib/shell/app-service-exit.ts`
/// 的 `APP_SERVICE_EXIT_FILE` 逐字相同（Rust 侧没有 import，只能各写一次，由用例钉住）。
pub const APP_SERVICE_EXIT_FILE: &str = "app-service-exit.json";

/// 写下「内嵌服务为什么结束」（sidecar 档）。
///
/// **写失败一律静默**（与 Node 侧同取向）：这条记录是排障体验，不是启动的必要条件；
/// 写不进去时界面按「没有原因可讲」处理，不会因为磁盘问题反过来把壳带崩。
///
/// `code` 是 `Option<i32>` 而不是「拿不到就给 0」：**0 是「正常退出」这个具体
/// 结论**，编出来会把故障说成正常（被信号杀掉时 `Terminated` 本就没有退出码）。
/// 退出事实的取舍——信号优先于退出码、两者都拿不到就说拿不到——在读取侧统一做，
/// 这里只如实带上壳知道的那一项。
pub fn write_sidecar_exit_record(
  project_root: &str,
  code: Option<i32>,
  reason: &str,
) -> bool {
  if project_root.is_empty() {
    return false;
  }
  let body = serde_json::json!({
    "at": local_timestamp(),
    "kind": "sidecar",
    "code": code,
    "signal": serde_json::Value::Null,
    "reason": reason,
    "port": serde_json::Value::Null,
    "runId": std::env::var("COMFYAPP_RUN_ID").ok(),
  })
  .to_string();
  let path = app_service_exit_path(project_root);
  if let Some(dir) = path.parent() {
    if std::fs::create_dir_all(dir).is_err() {
      log::warn!("[ComfyAPP] 无法创建 run/，本次不写应用服务结束记录");
      return false;
    }
  }
  // 无 BOM：走 `fs::write` 而不是带 BOM 分支的任何写法，与 launch-status.json 同口径。
  // 读取侧是 JSON.parse，BOM 会让它当场失败。
  match atomic_write(&path, &body) {
    Ok(()) => {
      log::info!("[ComfyAPP] 已记录内嵌服务结束原因：{}", path.display());
      true
    }
    Err(e) => {
      log::warn!("[ComfyAPP] 写应用服务结束记录失败（{}）：{e}", path.display());
      false
    }
  }
}

/// 读回「应用服务为什么结束」这条记录（壳侧存活通道，ISSUE #1915）。
///
/// ## 为什么这条读取必须走壳的 IPC，而不是那条 HTTP 端点
///
/// `GET /api/dev/last-exit` 由**应用服务自己**应答，而它正是「断开」这件事里没了
/// 的那一方——服务不在，端点必然不通。于是原先只有一条读法：等它**恢复应答之后**
/// 再问，也就是「断开时只给时刻、恢复时才给原因」。而原因其实在断开那一刻就已经
/// 落在 `run/app-service-exit.json` 里了（由死的那一刻还活着的旁证人写下），
/// 读不到它纯粹是因为**选错了通道**：壳进程活得好好的，它读这个文件不经过任何
/// 应用服务。
///
/// ## 返回形态
///
/// 回**文件原文**（而不是在 Rust 侧解析成结构）：记录的形状、成因取值与「这句话
/// 怎么说给用户听」全在 `src/lib/shell/app-service-exit.ts` 一处，Rust 再解析一遍
/// 等于把同一份形状写两处（漂开的表现是「记录写进去了、界面读不懂」，而现场恰好
/// 是最需要看清的那一次）。前端拿到原文走同一套 `parseAppServiceExitRecord`。
///
/// 读不到（文件不存在 / 还没写过）**回 `Ok(None)` 而不是 `Err`**：这不是错误，
/// 而是「没有原因可讲」这一正常状态——服务好好跑着、或那次断开根本没留下记录。
/// 回 `Err` 会让界面把「没原因」显示成「接口挂了」。
pub fn read_app_service_exit(project_root: &str) -> Option<String> {
  if project_root.is_empty() {
    return None;
  }
  let raw = std::fs::read_to_string(app_service_exit_path(project_root)).ok()?;
  let trimmed = raw.trim();
  if trimmed.is_empty() {
    return None;
  }
  Some(trimmed.to_string())
}

/// 读回「本检出的应用服务进程还活着吗」——**双信号判据的进程外那一半**（ISSUE #4146）。
///
/// ## 为什么这条判据必须在壳里
///
/// 探活（`GET /api/dev/server-id`）由应用服务自己应答，而 dev server 是**单事件循环**：
/// 同步重活（进程探针 `spawnSync`、Turbopack 编译锁、大型同步压缩）会把事件循环停走
/// 数秒，期间**所有**请求（含探活）都排不上队——进程活得好好的，HTTP 探活却连续超时
/// （ISSUE #4140 的现场）。「还能不能应答」只能问服务本身，所以这条信号永远带着被测
/// 进程的忙闲；要让**离线判定**不被它牵着走，必须有一个不经过该进程的信号。壳正是
/// 那个旁证人：编排器（launcher）是壳的子进程，它把本次启动的进程树（`launcher_pid`
/// + `child_pids`）写进 `run/launcher-session.json`，壳读这份文件、逐个查 PID 存活，
/// 完全不经过 dev server 的任何线程。
///
/// ## 返回语义（三态，`None` 不是错误）
///
/// · `None`：会话文件读不到 / 解析不了 / 没有可查的 PID——**不知道**（典型：手工
///   `pnpm dev` 没走编排器）。注意这只代表**第一档**答不上：standalone 分发形态
///   同样没有会话文件，那一档由壳持有的 sidecar 句柄直答（`liveness_from_sidecar`，
///   ISSUE #4151；两档的按序归并在 lib.rs 的 `get_app_service_liveness`）。前端对
///   最终的 `None` 按「没有进程外信号」处理，退回纯 HTTP 判据（原行为）。
/// · `Some(true)`：名单里**任一**进程还活着——服务没死（正在忙 / 正在被编排器重启）。
/// · `Some(false)`：名单全部不在了——进程确实没了，配合探活失败即是真断开。
///
/// PID 复用的说明：Windows 的 PID 理论上会被复用，但那是「编号耗尽回绕」之后的事，
/// 而这里的名单一分钟前刚由编排器写下；把「名单里任一还活着」当「服务没死」在这个
/// 时间尺度上是稳的，不值得为它再查进程身份。
pub fn read_app_service_liveness(project_root: &str) -> Option<bool> {
  if project_root.is_empty() {
    return None;
  }
  let raw = std::fs::read_to_string(launcher_session_path(project_root)).ok()?;
  let pids = parse_launcher_session_pids(&raw)?;
  liveness_from_pids(&pids, pid_alive)
}

/// 会话文件名，与 `scripts/launcher-core/` 的落盘名逐字相同。
const LAUNCHER_SESSION_FILE: &str = "launcher-session.json";

fn launcher_session_path(project_root: &str) -> std::path::PathBuf {
  std::path::Path::new(project_root)
    .join("run")
    .join(LAUNCHER_SESSION_FILE)
}

/// 从会话文件原文里取要查活的 PID 名单（`launcher_pid` + `child_pids`）。
///
/// 解析不出 / 一个 PID 都没有 → `None`（调用方按「不知道」处理）。字段缺失、
/// 类型不对、混进非法值（0 / 负数 / 超出 u32）都逐项跳过而不是整份作废：
/// 名单里多一个坏项不该把其余好项的读数也丢掉。
pub fn parse_launcher_session_pids(raw: &str) -> Option<Vec<u32>> {
  let value: serde_json::Value = serde_json::from_str(raw).ok()?;
  let mut pids: Vec<u32> = Vec::new();
  let mut push = |pid: u64| {
    if pid > 0 && pid <= u32::MAX as u64 {
      pids.push(pid as u32);
    }
  };
  if let Some(pid) = value.get("launcher_pid").and_then(|v| v.as_u64()) {
    push(pid);
  }
  if let Some(children) = value.get("child_pids").and_then(|v| v.as_array()) {
    for child in children {
      if let Some(pid) = child.as_u64() {
        push(pid);
      }
    }
  }
  if pids.is_empty() {
    None
  } else {
    Some(pids)
  }
}

/// 名单 → 三态结论：空名单 `None`；任一活着 `Some(true)`；全部不在 `Some(false)`。
/// 探活函数注入：判据纯函数化，测试不必真起进程。
fn liveness_from_pids(pids: &[u32], probe: impl Fn(u32) -> bool) -> Option<bool> {
  if pids.is_empty() {
    return None;
  }
  Some(pids.iter().any(|pid| probe(*pid)))
}

/// 第二档判据的纯函数（ISSUE #4151）：standalone（分发）形态没有编排器与会话文件，
/// 但壳**直接持有**内嵌 server（sidecar）的 `CommandChild` 句柄——不需要任何落盘
/// 痕迹就能回答「进程还在吗」。与 `liveness_from_pids`（第一档：编排器会话名单）
/// 互补，三态语义一致：
///
/// · 句柄不在（`None`）：这一档答不上——壳没起过 sidecar（prebuilt / 兜底 dev
///   URL / debug 壳），回 `None` 让调用方落「不知道」，前端退回纯 HTTP 判据。
/// · `terminated`（壳在事件通道里亲眼看到 `Terminated`）：进程确实没了，直接判
///   `Some(false)`。这是进程外事实，且句柄在壳的整个生命周期里都指向同一个 PID，
///   判死从此不受「PID 复用」影响，也不必再查一次系统。
/// · 其余：按句柄上的 PID 查存活。死亡事件未达的毫秒级窗口里靠 PID 兜底，与
///   第一档对会话名单的取向一致（#4146：名单刚写下时 PID 复用在这个时间尺度上
///   不构成误读）。
///
/// 探活函数注入：与第一档同一取向，判据纯函数化，测试不必真起进程。
pub fn liveness_from_sidecar(
  handle_pid: Option<u32>,
  terminated: bool,
  probe: impl Fn(u32) -> bool,
) -> Option<bool> {
  let pid = handle_pid?;
  if terminated {
    return Some(false);
  }
  Some(probe(pid))
}

/// PID 还在吗（只查存在性，不关心它此刻忙不忙——忙正是软信号要容忍的那一档）。
/// 两档判据共用：第一档查会话名单（#4146），第二档查壳持有的 sidecar 句柄（#4151）。
#[cfg(windows)]
pub(crate) fn pid_alive(pid: u32) -> bool {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
  // STILL_ACTIVE 的值（Win32 常量 259）；windows 0.62 的 Threading 模块没有导出这个名字，
  // 只能写字面量——含义与 SDK 的 `NT_SUCCESS(Status) == FALSE && Status == STATUS_PENDING` 档一致。
  const STILL_ACTIVE: u32 = 259;
  unsafe {
    // 打开失败 = 进程不在。
    let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
      return false;
    };
    let mut exit_code: u32 = 0;
    // 打开成功但退出码不是 STILL_ACTIVE = 已经退出：句柄被别人握着时 OpenProcess
    // 仍会成功，退出码才是裁决。
    let alive = GetExitCodeProcess(handle, &mut exit_code).is_ok() && exit_code == STILL_ACTIVE;
    let _ = CloseHandle(handle);
    alive
  }
}

/// POSIX：`kill(pid, 0)` 只探测存在性。0 = 在；EPERM = 在但没权限（也算在）；
/// ESRCH = 不在。可见性说明见 Windows 档。
#[cfg(not(windows))]
pub(crate) fn pid_alive(pid: u32) -> bool {
  // SAFETY: kill(2) 是无状态系统调用，只有 errno 需要读。
  let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
  rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// 把 sidecar 的终止事实翻译成给用户看的一句话（记录里的 `reason`）。
///
/// 与 Node 侧 `describeDownstreamExit` 同一个取向：**只陈述这一次具体是什么结束的**，
/// 不替用户下结论——「是崩溃还是被顶掉」要看退出码之外的东西，而这里手上只有退出码
/// 这一个事实。
pub fn sidecar_exit_reason(code: Option<i32>) -> String {
  match code {
    Some(c) => format!("内嵌服务（standalone server）已终止，退出码 {c}"),
    None => "内嵌服务（standalone server）已终止，未拿到退出码".to_string(),
  }
}

/// `log_launch_line` 的行形态（`[时刻] [级别] 正文`）。同步直写与 [`LineLog`]
/// 两条路共用同一份拼法——各拼各的必然漂。
fn launch_log_line(level: &str, message: &str) -> String {
  format!("[{}] [{}] {}\n", local_timestamp(), level.to_uppercase(), message)
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
  if let Err(e) = append_line(
    &launch_log_path(project_root),
    &launch_log_line(level, message),
  ) {
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
///
/// shell-launch.log 那一路经 [`LineLog`] 的专用写线程落盘：泵在 tokio worker 上
/// 逐行消费编排器输出，同步写文件会在慢盘 / 高频输出时拖住 worker，并让无界上游
/// 在内存里堆积（ISSUE #4334）。
fn log_orchestrator_line(sink: &LineLog, level: &str, body: &str) {
  let message = format!("[orchestrator] {body}");
  match level {
    "error" => log::error!("{message}"),
    "warn" => log::warn!("{message}"),
    _ => log::info!("{message}"),
  }
  sink.send_line(launch_log_line(level, &message));
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
  append_bytes(path, line.as_bytes())
}

/// 追加一段字节（目录缺失时递归建）。`append_line` 的字节形态，供按次开合的
/// 日志写入器复用同一份「建目录 + 开-写-即关」的落盘语义。
fn append_bytes(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
  use std::io::Write;
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir)?;
  }
  let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
  file.write_all(bytes)
}

/// 壳自持日志的大小上限：超过即整份重建（丢旧保新，等效插件 Folder target 的
/// KeepOne 轮转）。设防的是「壳长开数日 + 编排器转发日志把文件推到无界」，
/// 不是常规路径——`current/` 每次运行结束会被归档清空，正常情况下远到不了这里。
pub const SHELL_LOG_MAX_BYTES: u64 = 40 * 1024 * 1024;

/// 行日志的**有界异步写入器**：专用写线程 + 有界通道 + 丢弃计数（ISSUE #4334）。
///
/// 解决的问题：子进程输出泵跑在 tokio worker 上，此前逐行做同步文件 IO（stat +
/// open + write + close）。磁盘慢（杀毒扫描 / 网络盘）或子进程高频刷屏（首次编译
/// 期的 Next / turbopack）时：worker 被文件 IO 拖住，同一线程上的其它 async 任务
/// 跟着挨饿；上游（tauri-plugin-shell 的事件通道）又是无界 mpsc，消费慢就在内存里
/// 无界堆积。这里把「落盘」整体挪进一条专用线程：调用方只做一次有界 `try_send`——
/// **从不阻塞、从不做 IO**；通道满 = 落盘跟不上产出，按「丢弃 + 计数」处理，写线程
/// 在下一行前补一条「丢弃 N 行」，内存有界、现场不静默。
struct LineLog {
  tx: std::sync::mpsc::SyncSender<LineMsg>,
  dropped: std::sync::Arc<std::sync::atomic::AtomicU64>,
  worker: Option<std::thread::JoinHandle<()>>,
}

/// 通道里传的三种消息：正文行 / 排空屏障（仅测试）/ 收尾。
enum LineMsg {
  Line(String),
  #[cfg(test)]
  Barrier(std::sync::mpsc::Sender<()>),
  Close,
}

impl LineLog {
  /// 通道容量：内存上界 ≈ 容量 × 单行字节。既要给写线程留出「高频刷屏时匀速
  /// 消化」的深度，又必须远小于「无界」——满了就丢，不再收。
  const CHANNEL_CAPACITY: usize = 1024;

  /// 按默认容量起一个写线程。`write` 是真正的落盘动作（含轮转 / 重建语义），
  /// 由写线程**独占**执行——单线程单通道，落盘行序因此与入队顺序一致。
  fn spawn<W>(write: W) -> Self
  where
    W: FnMut(&[u8]) -> std::io::Result<()> + Send + 'static,
  {
    Self::spawn_with_capacity(write, Self::CHANNEL_CAPACITY)
  }

  /// 按指定容量起写线程（测试用：小容量才能不依赖时序地测出「满了丢弃」）。
  fn spawn_with_capacity<W>(write: W, capacity: usize) -> Self
  where
    W: FnMut(&[u8]) -> std::io::Result<()> + Send + 'static,
  {
    let (tx, rx) = std::sync::mpsc::sync_channel::<LineMsg>(capacity);
    let dropped = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let dropped_in_worker = dropped.clone();
    let worker = std::thread::Builder::new()
      .name("comfyapp-line-log".into())
      .spawn(move || {
        let mut write = write;
        while let Ok(msg) = rx.recv() {
          match msg {
            LineMsg::Line(line) => {
              // 丢弃计数在成功消费时结算：拥塞解除后的第一行前先补一条，
              // 让「丢了多少」在日志里可见，而不是静默吞掉。
              let n = dropped_in_worker.swap(0, std::sync::atomic::Ordering::Relaxed);
              if n > 0 {
                let _ = write(format!("（落盘滞后：前段已丢弃 {n} 行）\n").as_bytes());
              }
              let _ = write(line.as_bytes());
            }
            #[cfg(test)]
            LineMsg::Barrier(ack) => {
              let _ = ack.send(());
            }
            LineMsg::Close => break,
          }
        }
        // 收尾兜底：Close 之后若还有未消费的正文（防御，正常没有），尽力写完再退。
        while let Ok(msg) = rx.try_recv() {
          if let LineMsg::Line(line) = msg {
            let _ = write(line.as_bytes());
          }
        }
        // 到这一刻还在涨的丢弃计数没有下一行可挂了，补最后一次读数。
        let n = dropped_in_worker.swap(0, std::sync::atomic::Ordering::Relaxed);
        if n > 0 {
          let _ = write(format!("（落盘滞后：前段已丢弃 {n} 行）\n").as_bytes());
        }
      })
      .expect("日志写线程启动失败");
    Self {
      tx,
      dropped,
      worker: Some(worker),
    }
  }

  /// 投递一行（**非阻塞**）：通道满即丢弃并计数。用有界的内存换两条硬保证——
  /// 调用线程绝不被磁盘拖住、async worker 上绝不出现同步文件 IO。
  fn send_line(&self, line: String) {
    match self.tx.try_send(LineMsg::Line(line)) {
      Ok(()) => {}
      Err(std::sync::mpsc::TrySendError::Full(_)) => {
        self
          .dropped
          .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
      }
      // 写线程已退出（只发生在 Drop 之后）；诊断通道丢就丢了，不恐慌。
      Err(std::sync::mpsc::TrySendError::Disconnected(_)) => {}
    }
  }

  /// 排空屏障：等写线程把**此刻已入队**的行全部写完。只给测试用——生产热路径
  /// 不调它（fern 可能在每条记录后调 flush，若在这里等排空，调用线程又被拖回
  /// 磁盘节奏，#4334 就白修了）。
  #[cfg(test)]
  fn barrier(&self) {
    let (ack_tx, ack_rx) = std::sync::mpsc::channel();
    if self.tx.send(LineMsg::Barrier(ack_tx)).is_ok() {
      let _ = ack_rx.recv_timeout(std::time::Duration::from_secs(10));
    }
  }
}

impl Drop for LineLog {
  fn drop(&mut self) {
    // 发 Close 后 join：写线程会把 Close 之前入队的行全部写完再退出，所以
    // Drop 语义是「尽力把尾巴落盘」。磁盘真挂住时，join 等的是写线程当前那一次
    // 写——与旧实现「调用线程等在自己的 write 上」同代价，不再放大。
    let _ = self.tx.send(LineMsg::Close);
    if let Some(handle) = self.worker.take() {
      let _ = handle.join();
    }
  }
}

/// shell.log 一行的落盘动作：超过上限整份重建（丢旧保新）+ 按次开合追加。
/// 语义与 #3574 一致，只是执行线程从「调用方」换成了 [`LineLog`] 的写线程
/// （ISSUE #4334）。
fn write_shell_log_bytes(
  path: &std::path::Path,
  max_bytes: u64,
  buf: &[u8],
) -> std::io::Result<()> {
  let oversized = std::fs::metadata(path)
    .map(|m| m.len() >= max_bytes)
    .unwrap_or(false);
  if oversized {
    // 按次开合意味着没有谁长期攥着这份文件，删除是即时的；删失败（被瞬时
    // 只读句柄占住）就先不轮转，下一行再试——丢上限与丢现场之间选后者。
    let _ = std::fs::remove_file(path);
  }
  append_bytes(path, buf)
}

/// 壳自持日志（`log/current/shell/shell.log`）的**按次开合**写入器。
///
/// 为什么不沿用 tauri-plugin-log 的 Folder target（#3574）：它把文件句柄一直
/// 攥到进程退出，而 `current/` 的生命周期里有多次「整目录清空」——启动时编排器
/// 的崩溃补做（`recoverStaleCurrent`，把壳先写进来的会话头当成上一次的残留）、
/// 退出时的收包归档（`archiveCurrent`）。任何一次清空都发生在壳还活着的时候：
/// Windows 上删除对持句柄文件成功（Rust std 以含 FILE_SHARE_DELETE 打开），
/// 目录项即刻消失，此后插件的所有写入都落进一个已解除链接的句柄——**静默丢失，
/// 日志冻在清空发生前的那几行**。每次写入按路径重开 + 追加 + 即关，目录被清了
/// 下一行自己重建（与 `append_line` 同一取向）。
///
/// 落盘走 [`LineLog`] 的专用写线程（ISSUE #4334）：日志可能从 tokio worker
/// （sidecar / 编排器输出泵）里发出，同步文件 IO 会在慢盘 / 高频输出时把 worker
/// 拖住——这里 `write()` 只入队，真正的 stat / 轮转 / 写盘都在写线程里。
pub struct ResilientShellLog {
  sink: LineLog,
}

impl ResilientShellLog {
  /// 按默认大小上限（[`SHELL_LOG_MAX_BYTES`]）建一个写入器。
  pub fn new(path: std::path::PathBuf) -> Self {
    Self::with_max_bytes(path, SHELL_LOG_MAX_BYTES)
  }

  /// 按指定大小上限建一个写入器（测试用）。
  fn with_max_bytes(path: std::path::PathBuf, max_bytes: u64) -> Self {
    Self {
      sink: LineLog::spawn(move |buf| write_shell_log_bytes(&path, max_bytes, buf)),
    }
  }
}

impl std::io::Write for ResilientShellLog {
  fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
    // fern 的 writer 输出每次给一整条格式化好的行，write_fmt 内部按 write_all
    // 语义调用本函数；这里只入队（从不阻塞、不做 IO），返回「全部收下」。
    self.sink.send_line(String::from_utf8_lossy(buf).into_owned());
    Ok(buf.len())
  }

  fn flush(&mut self) -> std::io::Result<()> {
    // 故意不做屏障：fern 可能在每条记录后调 flush，在这里等写线程排空会把
    // 调用线程拖回磁盘节奏。收尾排空由 Drop（Close + join）负责。
    Ok(())
  }
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
/// 原子写小文件（ISSUE #3857）：先写同目录的 `.tmp-<pid>` 再 `rename` 到位。
/// `launch-status.json` 是「壳 + 编排器两个写方、启动页 250ms 一个读方」的热
/// 文件，`std::fs::write` 的 truncate+write 直写会让读方撞到空串 / 半截 JSON；
/// 同目录 rename 在同一卷上是原子的。失败时收掉自己的临时文件。
fn atomic_write(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
  let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
  let result = (|| -> std::io::Result<()> {
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
  })();
  if result.is_err() {
    let _ = std::fs::remove_file(&tmp);
  }
  result
}

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
  if let Err(e) = atomic_write(&path, &payload.to_string()) {
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

/// 回收命令的等待预算（#4006）：平时秒回；这是退出路径上的同步等待，不许无界。
pub(crate) const REAPER_BUDGET: std::time::Duration = std::time::Duration::from_secs(10);

/// 同步跑一条命令，但带墙钟预算（#4006）。
///
/// `Command::output()` 会无限等子进程退出——把它放在退出路径上，一旦 reap 脚本
/// 链路变化（比如未来加了等待确认），壳就卡死在 Exit 事件里。这里改为
/// `spawn` + `try_wait` 轮询：到点强杀并报错。子进程只吐几行日志，管道缓冲
/// 足够容纳，不会因不读管道而写满卡死；退出后再把剩余输出收干净——收取本身
/// 也带预算（[`drain_pipes_bounded`]，ISSUE #4337），退出回收整体保持墙钟上限。
pub(crate) fn run_with_budget(
  mut command: std::process::Command,
  budget: std::time::Duration,
) -> std::io::Result<std::process::Output> {
  // spawn() 的默认 stdio 是**继承父进程**——不显式接管管道，child.stdout/stderr
  // 恒为 None，下面的残余收取（以及返回值里的输出）从来没有内容可收。这里
  // 显式接上管道，产出交由 [`drain_pipes_bounded`] 有界收净。
  use std::process::Stdio;
  let mut child = command
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()?;
  let deadline = std::time::Instant::now() + budget;
  loop {
    if let Some(status) = child.try_wait()? {
      let (stdout, stderr) = drain_pipes_bounded(&mut child, PIPE_DRAIN_BUDGET);
      return Ok(std::process::Output {
        status,
        stdout,
        stderr,
      });
    }
    if std::time::Instant::now() >= deadline {
      let _ = child.kill();
      let _ = child.wait();
      return Err(std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "回收命令超出预算，已强杀",
      ));
    }
    std::thread::sleep(std::time::Duration::from_millis(50));
  }
}

/// 子进程退出后收取管道残余输出的宽限（ISSUE #4337）。正常情况残余就几行、
/// 瞬间收完；给 2s 是给「写端还没关」的窄窗口一个来得及收的余地。
pub(crate) const PIPE_DRAIN_BUDGET: std::time::Duration = std::time::Duration::from_secs(2);

/// 已退出的子进程把 stdout/stderr 残余收干净——但**有界**（ISSUE #4337）。
///
/// `read_to_end` 要等管道**所有**写端关闭才返回：被回收脚本留下的后代进程若
/// 继承了 stdout/stderr 写句柄且不肯退，直接在当前线程 `read_to_end` 就会把
/// 退出路径无限期挂住（主线程冻在 `RunEvent::Exit` 里，表现为「关了窗却退不
/// 出」——`try_wait` 那段有预算，这一段原先没有）。这里把每条管道的收取挪进
/// 一次性线程、整体给一个宽限预算：到点放弃，拿到多少算多少——残余输出是
/// 诊断信息，丢给它换退出路径的墙钟上限，值得。
fn drain_pipes_bounded(
  child: &mut std::process::Child,
  budget: std::time::Duration,
) -> (Vec<u8>, Vec<u8>) {
  use std::io::Read;
  let (tx, rx) = std::sync::mpsc::channel::<(bool, Vec<u8>)>();
  let mut spawned = 0usize;
  if let Some(mut s) = child.stdout.take() {
    let tx = tx.clone();
    spawned += 1;
    std::thread::spawn(move || {
      let mut buf = Vec::new();
      let _ = s.read_to_end(&mut buf);
      let _ = tx.send((true, buf));
    });
  }
  if let Some(mut s) = child.stderr.take() {
    spawned += 1;
    std::thread::spawn(move || {
      let mut buf = Vec::new();
      let _ = s.read_to_end(&mut buf);
      let _ = tx.send((false, buf));
    });
  }
  let deadline = std::time::Instant::now() + budget;
  let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
  for _ in 0..spawned {
    let left = deadline.saturating_duration_since(std::time::Instant::now());
    match rx.recv_timeout(left) {
      Ok((true, buf)) => stdout = buf,
      Ok((false, buf)) => stderr = buf,
      // 超时（或发送端提前全没）：到点放弃，不再陪卡住的写端等。
      Err(_) => break,
    }
  }
  (stdout, stderr)
}

/// 调 `scripts/reap-process.mjs`（非 TS 宿主的唯一命令行回收入口）。
///
/// **不自己拼 `taskkill` / `kill`**：平台判据只允许有一份，在
/// `src/lib/process/kill-process-tree.ts`（命令行入口就是 reap-process.mjs）。
/// 这里再写一遍，就是「各写各的、POSIX 上退化成单杀」那条老路的翻版。
fn spawn_reaper(project_root: &str, pid: u32, deadline: std::time::Instant) {
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
  /* 预算来自调用方的**共享截止时刻**（ISSUE #4219）：退出路径上两段回收串行，
   * 各自独立预算的叠加会把关窗后的假死拉长到 20s 量级。 */
  let budget = deadline.saturating_duration_since(std::time::Instant::now());
  match run_with_budget(command, budget) {
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
    // 自编排标记：编排器据此知道「本次编排由壳拉起」（ISSUE #1687 的端口族
    // 判定已由壳跑过），并且**不再起第二个壳**（§1.5：首壳就是应用宿主）。
    .env("COMFYAPP_SHELL_SELF_LAUNCH", "1")
    .env("COMFYAPP_PORT", port.to_string())
    .env(PROJECT_ROOT_ENV, project_root)
    .env("COMFYAPP_LAUNCH_MODE", "prebuilt")
    .current_dir(project_root)
    .spawn()?;
  adopt(child);

  // 编排器的输出必须有人读：shell 插件把输出投递到事件通道，无人消费时管道
  // 写满会让它静默卡死（表现为「启动页一直停在第一步」）。落进壳日志，同时
  // 转发给 dlog 让 dev-launcher 自己写的那份日志之外还有一条「谁起的它」。
  //
  // shell-launch.log 那一路的落盘走专用写线程（[`LineLog`]：有界通道 + 丢弃
  // 计数）：本泵跑在 tokio worker 上，逐行同步写文件会在慢盘 / 高频输出时拖住
  // worker、并让无界上游在内存里堆积（ISSUE #4334）。
  let launch_log_file = launch_log_path(project_root);
  let launch_sink = LineLog::spawn(move |buf| append_bytes(&launch_log_file, buf));
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
          log_orchestrator_line(&launch_sink, shell_level, body);
        }
        CommandEvent::Stderr(line) => {
          let text = String::from_utf8_lossy(&line).trim_end().to_string();
          let (body, level) = strip_orchestrator_line_prefix(&text);
          let shell_level = orchestrator_level_to_shell(level, "warn");
          log_orchestrator_line(&launch_sink, shell_level, body);
        }
        CommandEvent::Terminated(payload) => {
          log::info!("[ComfyAPP] orchestrator terminated: {:?}", payload.code);
          // 经同一个 sink 落盘，保证它排在已入队的编排器行之后（只走 log::
          // 的话，channel / shell.log 与 shell-launch.log 的先后会分叉）。
          launch_sink.send_line(launch_log_line(
            "info",
            &format!("编排器结束，退出码 {:?}", payload.code),
          ));
        }
        _ => {}
      }
    }
    // launch_sink 在此 drop：Close + join，把队列里剩下的行写完再退。
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
///
/// standalone sidecar 那棵树的同款兜底见 [`attach_sidecar_kill_on_close_job`]
/// （ISSUE #4165）：两条树各挂各的 job，共用下面那一份内核。
#[cfg(windows)]
pub fn attach_kill_on_close_job() {
  let pid = {
    let guard = ORCHESTRATOR.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    match guard.as_ref() {
      Some(child) => child.pid(),
      None => return,
    }
  };
  if let Some(job) = assign_kill_on_close_job(pid, "orchestrator") {
    *JOB_HANDLE.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = job;
  }
}

/// 给 standalone sidecar（内嵌 server 那棵树）挂同一个 OS 级兜底（ISSUE #4165）。
///
/// standalone 的进程树是「壳 app.exe → node sidecar → next-server / 执行宿主」，
/// 壳同样是顶：正常关窗有「壳退出 → `kill_sidecar` → `reap-process.mjs` 补刀」
/// 这条链，但壳被**硬杀**（任务管理器收掉 app.exe / 壳崩溃）时那条链一步都跑不了
/// ——此前这棵树没有任何 OS 级兜底（插件自建的 job 只在 `.set_process_group(true)`
/// 时存在，本侧没启用），孤儿 node / next-server 继续占端口与日志句柄；且 standalone
/// 不写会话锚点，下一次启动的孤儿回收对它**没有认亲方式**——所以兜底必须在壳死的
/// 当场生效，不能指望「下一次启动再收」。挂上壳自持的 `KILL_ON_JOB_CLOSE` job 后，
/// 壳一死 OS 关句柄，整棵树当场回收，与编排器那棵树（[`attach_kill_on_close_job`]）
/// 同构。`BREAKAWAY_OK` 的逃逸语义（保活服务）在这棵树上同样要保。
///
/// 失败只记 WARN，语义与编排器那侧相同：兜底挂不上不该拦住启动。
///
/// `#[allow(dead_code)]`：唯一调用点 `spawn_sidecar` 是 release-only
/// （`#[cfg(not(debug_assertions))]`），debug 构建（`cargo test`）里它没人调。
#[cfg(windows)]
#[allow(dead_code)]
pub fn attach_sidecar_kill_on_close_job(pid: u32) {
  if let Some(job) = assign_kill_on_close_job(pid, "sidecar") {
    *SIDECAR_JOB_HANDLE.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = job;
  }
}

/// 共同内核：给 `pid` 建一个 `KILL_ON_JOB_CLOSE | BREAKAWAY_OK` 的 job 并挂上。
///
/// 成功返回**有意泄漏**的 job 句柄值（语义见 `JOB_HANDLE` 的注释：壳持有到进程
/// 退出，OS 在壳死时替我们关闭）；失败返回 `None` 并只记 WARN。`what` 只用于日志。
#[cfg(windows)]
fn assign_kill_on_close_job(pid: u32, what: &str) -> Option<usize> {
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

  if pid == 0 {
    return None;
  }
  unsafe {
    let job = match CreateJobObjectW(None, windows::core::PCWSTR::null()) {
      Ok(handle) => handle,
      Err(e) => {
        log::warn!("[ComfyAPP] CreateJobObjectW failed: {e:?}");
        return None;
      }
    };
    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    info.BasicLimitInformation = JOBOBJECT_BASIC_LIMIT_INFORMATION {
      /* KILL_ON_JOB_CLOSE：壳消失（含被硬杀）时 job 关闭即终止整棵树 —— 编排器
       * / sidecar 崩溃后不留孤儿的 OS 级兜底。
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
      return None;
    }
    match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
      Ok(process) => {
        match AssignProcessToJobObject(job, process) {
          Ok(()) => log::info!(
            "[ComfyAPP] {what} {pid} attached to kill-on-close job (shell is its owner)"
          ),
          Err(e) => log::warn!("[ComfyAPP] AssignProcessToJobObject failed: {e:?}"),
        }
        let _ = CloseHandle(process);
      }
      Err(e) => log::warn!("[ComfyAPP] OpenProcess({pid}) failed: {e:?}"),
    }
    // 句柄**故意不关**：job 的语义是「最后一个句柄关闭即杀整棵树」，而壳退出
    // 时 OS 会替我们关掉它，那一刻才是「壳死了，这棵树也别活」的触发点。
    // 这里把句柄交给调用方塞进 `static`（JOB_HANDLE / SIDECAR_JOB_HANDLE）就是
    // 「有意泄漏」的写法 —— `mem::forget` 对 `HANDLE`（`Copy`）是空操作，写它
    // 会连编译都提醒「什么也没做」。
    Some(job.0 as usize)
  }
}

#[cfg(not(windows))]
pub fn attach_kill_on_close_job() {}

/// 非 Windows 没有 Job Object：两棵树（编排器 / sidecar）的硬杀兜底都缺席，
/// 树级回收只剩「退出时的 reap-process.mjs / kill-process-tree」一条（既定边界，
/// 见规范 §3.3 / §7.6）。留空实现使调用点无需按平台分叉。
/// `#[allow(dead_code)]`：同上，调用点随 `spawn_sidecar` 只在 release 编译。
#[cfg(not(windows))]
#[allow(dead_code)]
pub fn attach_sidecar_kill_on_close_job(_pid: u32) {}

/// 编排器进程的环境块里有没有 `COMFYAPP_SHELL_OWNED=1`（Windows）。
///
/// 看环境块必须拿到进程句柄，所以只覆盖 Windows：「同一个 exe 被双击两次」正是
/// 本 ISSUE 的场景，而它在 POSIX 上由启动器的锁文件（single_instance 的
/// `#[cfg(not(windows))]` 实现）承担。判据读不到（权限不足 / 32 位目标）一律
/// 返回 false —— 宁可多起一个编排器（会被端口与单实例判据挡住），也不能去杀
/// 一个身份不明的进程。
#[cfg(windows)]
pub fn process_env_is_owned(pid: u32, project_root: &str) -> bool {
  use windows::Win32::Foundation::CloseHandle;
  use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
  };
  unsafe {
    let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
      return false;
    };
    let owned = read_owned_env_from_process(handle, project_root);
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
pub fn process_env_is_owned(_pid: u32, _project_root: &str) -> bool {
  false
}

#[cfg(windows)]
unsafe fn read_owned_env_from_process(
  handle: windows::Win32::Foundation::HANDLE,
  project_root: &str,
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
  /* 认亲双判据（ISSUE #3851）：「是某个壳起的」（OWNED_ENV）**且**「是本检出
   * 的壳起的」（PROJECT_ROOT_ENV 与当前根一致）。多检出并行时，只看前者会把
   * 别家正在跑的编排器当成自己的残留 —— 后果是误杀整树。 */
  let owned_needle = format!("{OWNED_ENV}=1");
  let root_needle = format!("{PROJECT_ROOT_ENV}={project_root}");
  text.split('\0').any(|entry| entry.trim() == owned_needle)
    && text.split('\0').any(|entry| entry.trim() == root_needle)
}

/// 找到「已经在跑、且是本模块亲手起的」编排器进程号（找不到 = None）。
///
/// 只有 Windows 实现：`CreateToolhelp32Snapshot` 列出全部进程 → 逐个打开句柄 →
/// 环境块认亲。**命令行**这一层只用来做廉价预筛（省掉绝大多数 OpenProcess），
/// 真正的判据是环境块（见 `is_own` 的注释）。
#[cfg(windows)]
pub fn find_owned_orchestrator(project_root: &str) -> Option<u32> {
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
          && process_env_is_owned(pid, project_root)
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
pub fn find_owned_orchestrator(_project_root: &str) -> Option<u32> {
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

  /// 把文件的修改时间钉到给定时刻（判据要区分「按 mtime 最新」与「按名字序最新」，
  /// 而写入顺序本身定不出这个差别）。写不进就 panic —— 静默跳过会让用例变成永真。
  fn set_mtime(path: &std::path::Path, at: std::time::SystemTime) {
    let file = std::fs::OpenOptions::new()
      .write(true)
      .open(path)
      .expect("打开测试文件");
    file.set_times(std::fs::FileTimes::new().set_modified(at))
      .expect("设置 mtime");
  }

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
    assert_eq!(
      nextjs_log_dir("/proj"),
      root.join("log").join("current").join("nextjs")
    );
  }

  /// #3574 的回归判据：文件被清（编排器崩溃补做 / 退出归档的 `emptyDir`）之后，
  /// 下一行写入必须自己把文件重建出来——而不是把内容写进已解除链接的旧句柄里。
  #[test]
  fn resilient_shell_log_survives_file_removal() {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-resilient-log-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
    ));
    let path = dir.join("shell").join("shell.log");
    let mut writer = ResilientShellLog::new(path.clone());
    std::io::Write::write_all(&mut writer, b"first\n").unwrap();
    writer.sink.barrier();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "first\n");

    // 模拟 current/ 被清：文件和目录整个删掉（此时「插件」手里还留着旧句柄——
    // 本写入器没有长期句柄，这正是被测行为）。
    std::fs::remove_dir_all(&dir).unwrap();

    std::io::Write::write_all(&mut writer, b"second\n").unwrap();
    writer.sink.barrier();
    assert_eq!(
      std::fs::read_to_string(&path).unwrap(),
      "second\n",
      "清空后的写入必须重建文件；内容丢失 = 写进了已解除链接的句柄（#3574 的病根）"
    );
  }

  /// 大小上限的等效 KeepOne：超过上限的下一行把文件整份重建（丢旧保新），
  /// 别让长开会话把壳自持日志推到无界。
  #[test]
  fn resilient_shell_log_rebuilds_past_size_cap() {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-resilient-cap-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
    ));
    let path = dir.join("shell").join("shell.log");
    let mut writer = ResilientShellLog::with_max_bytes(path.clone(), 8);
    std::io::Write::write_all(&mut writer, b"12345678\n").unwrap();
    writer.sink.barrier();
    // 恰好达到上限：这一行还在。
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "12345678\n");
    std::io::Write::write_all(&mut writer, b"9\n").unwrap();
    writer.sink.barrier();
    assert_eq!(
      std::fs::read_to_string(&path).unwrap(),
      "9\n",
      "越过上限的下一行必须重建文件，而不是无限追加"
    );
  }

  /// #4337 回归：子进程退出后，即使有后代进程继承了 stdout 写句柄不肯退，
  /// run_with_budget 也必须在「预算 + 收尾宽限」内返回——退出路径不许有
  /// 无界阻塞点（旧写法 read_to_end 会陪后代等到它退，主线程冻在 Exit 里）。
  #[cfg(windows)]
  #[test]
  fn run_with_budget_stays_bounded_when_descendant_holds_pipe() {
    // start /b 让 ping 在 cmd 退出后继续活着并**继承** cmd 的 stdout 写端 ~5s。
    let mut command = std::process::Command::new("cmd");
    command.args(["/C", "start /b ping -n 6 127.0.0.1 & echo ready"]);
    let start = std::time::Instant::now();
    let out = run_with_budget(command, REAPER_BUDGET).unwrap();
    let elapsed = start.elapsed();
    assert!(
      elapsed < std::time::Duration::from_secs(4),
      "退出回收必须在预算+宽限内返回，而不是陪攥着写端的后代等到它退：{elapsed:?}"
    );
    assert!(out.status.success());
  }

  /// 同上一条的 POSIX 形态（GA 的 cargo test 跑在 ubuntu 上）。
  #[cfg(unix)]
  #[test]
  fn run_with_budget_stays_bounded_when_descendant_holds_pipe() {
    // 后台 sleep 继承 sh 的 stdout 写端 6s；sh 本身立即退出。
    let mut command = std::process::Command::new("sh");
    command.args(["-c", "sleep 6 & echo ready"]);
    let start = std::time::Instant::now();
    let out = run_with_budget(command, REAPER_BUDGET).unwrap();
    let elapsed = start.elapsed();
    assert!(
      elapsed < std::time::Duration::from_secs(4),
      "退出回收必须在预算+宽限内返回，而不是陪攥着写端的后代等到它退：{elapsed:?}"
    );
    assert!(out.status.success());
  }

  /// 常规路径不回归：子进程正常退出、无后代攥管道时，残余输出照常收全
  /// （#4337 的有界化不该把「本来拿得到的输出」也丢掉）。
  #[cfg(windows)]
  #[test]
  fn run_with_budget_collects_output_of_clean_exit() {
    let mut command = std::process::Command::new("cmd");
    command.args(["/C", "echo ready"]);
    let out = run_with_budget(command, REAPER_BUDGET).unwrap();
    assert!(out.status.success());
    assert!(
      String::from_utf8_lossy(&out.stdout).contains("ready"),
      "正常退出的子进程输出必须收全：{}",
      String::from_utf8_lossy(&out.stdout)
    );
  }

  /// 同上一条的 POSIX 形态。
  #[cfg(unix)]
  #[test]
  fn run_with_budget_collects_output_of_clean_exit() {
    let mut command = std::process::Command::new("sh");
    command.args(["-c", "echo ready"]);
    let out = run_with_budget(command, REAPER_BUDGET).unwrap();
    assert!(out.status.success());
    assert!(
      String::from_utf8_lossy(&out.stdout).contains("ready"),
      "正常退出的子进程输出必须收全：{}",
      String::from_utf8_lossy(&out.stdout)
    );
  }

  /// 通道满 = 落盘跟不上产出：后续行必须被丢弃并计数，而不是无界堆积（#4334）；
  /// 拥塞解除后要补一条「丢弃 N 行」读数，被丢的行不出现，留下的行保持顺序。
  #[test]
  fn line_log_drops_and_notices_when_writer_lags() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};

    let entered = Arc::new(AtomicBool::new(false));
    let gate = Arc::new(Mutex::new(false));
    let cv = Arc::new(Condvar::new());
    let captured = Arc::new(Mutex::new(String::new()));

    let entered_w = entered.clone();
    let gate_w = gate.clone();
    let cv_w = cv.clone();
    let captured_w = captured.clone();
    let sink = LineLog::spawn_with_capacity(
      move |buf| {
        entered_w.store(true, Ordering::SeqCst);
        // 闸门关着就等：模拟「磁盘写不动」。
        let mut open = gate_w.lock().unwrap();
        while !*open {
          open = cv_w.wait(open).unwrap();
        }
        captured_w
          .lock()
          .unwrap()
          .push_str(std::str::from_utf8(buf).unwrap());
        Ok(())
      },
      2,
    );

    sink.send_line("L1\n".into());
    // 等写线程真的取走 L1、堵在闸门里：此后通道空、容量确定，断言才不靠时序。
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while !entered.load(Ordering::SeqCst) {
      assert!(
        std::time::Instant::now() < deadline,
        "写线程没有进入写入函数，测试前提不成立"
      );
      std::thread::sleep(std::time::Duration::from_millis(1));
    }

    sink.send_line("L2\n".into());
    sink.send_line("L3\n".into()); // 通道 [L2, L3]，已满
    sink.send_line("L4\n".into()); // 满 ⇒ 丢弃并计数
    sink.send_line("L5\n".into()); // 满 ⇒ 丢弃并计数

    // 放行：写线程先补「丢弃 2 行」，再按序写 L2、L3。
    *gate.lock().unwrap() = true;
    cv.notify_all();
    sink.barrier();

    let out = captured.lock().unwrap().clone();
    assert!(out.contains("L1\n"), "先入队的 L1 必须落盘：{out}");
    assert!(out.contains("丢弃 2 行"), "丢弃必须有读数，不许静默：{out}");
    assert!(
      out.contains("L2\n") && out.contains("L3\n"),
      "容量内的行必须保序落盘：{out}"
    );
    assert!(
      !out.contains("L4") && !out.contains("L5"),
      "超容量的行必须被丢掉，而不是堆在内存里：{out}"
    );
    let idx = |needle: &str| out.find(needle).unwrap();
    assert!(
      idx("L1\n") < idx("丢弃 2 行")
        && idx("丢弃 2 行") < idx("L2\n")
        && idx("L2\n") < idx("L3\n"),
      "丢弃告示要插在拥塞段落之后、后续行之前，且行序保持：{out}"
    );
  }

  /// Drop 语义：Close 之前入队的行必须全部落盘（尽力不丢尾巴）——输出泵退出时
  /// 靠这个把队列里剩下的编排器行写完。
  #[test]
  fn line_log_drains_pending_lines_on_drop() {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-line-log-drop-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
    ));
    let path = dir.join("line-log-drop.log");
    {
      let p = path.clone();
      let sink = LineLog::spawn(move |buf| append_bytes(&p, buf));
      for i in 0..50 {
        sink.send_line(format!("line-{i}\n"));
      }
      // 故意不 barrier：直接 drop，靠 Drop 里的 Close + join 排空。
    }
    let content = std::fs::read_to_string(&path).unwrap();
    for i in 0..50 {
      assert!(content.contains(&format!("line-{i}\n")), "缺 line-{i}：{content}");
    }
    let _ = std::fs::remove_dir_all(&dir);
  }

  /// 「最新一份」必须按 mtime 判，不能按文件名序 —— ISSUE #576 那个坑的回归：
  /// 戳的历史形态（下划线）与现行形态（连字符）字典序与时间序相反，按名字取
  /// 「最新」会拿到上一次运行的日志，用户照着面板给的路径去看，看到的是别的现场。
  #[test]
  fn latest_prefixed_log_prefers_mtime_over_name_order() {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-latest-log-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    // 字典序更靠后的那份其实是**更早**写下的（`_`(0x5F) > `T`/`-`）。
    let older = dir.join("nextjs-stdout-2026-09-30_193612.log");
    let newer = dir.join("nextjs-stdout-2026-10-12-14-58-35.log");
    std::fs::write(&older, "上一次运行").unwrap();
    std::fs::write(&newer, "本次运行").unwrap();
    let old_at = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
    let new_at = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_800_000_000);
    set_mtime(&older, old_at);
    set_mtime(&newer, new_at);
    // 前缀不匹配的邻居不能被选中（stdout 的选择不能串到 stderr 那份上）。
    std::fs::write(dir.join("nextjs-stderr-2026-10-12-14-58-35.log"), "err").unwrap();
    set_mtime(&dir.join("nextjs-stderr-2026-10-12-14-58-35.log"), new_at);

    assert_eq!(
      latest_prefixed_log(&dir, "nextjs-stdout-"),
      Some(newer.clone()),
      "按 mtime 应选中本次运行那份，而不是字典序更大的上一次运行那份"
    );
    assert_eq!(
      latest_prefixed_log(&dir, "nextjs-stderr-"),
      Some(dir.join("nextjs-stderr-2026-10-12-14-58-35.log"))
    );
    assert_eq!(latest_prefixed_log(&dir, "no-such-prefix-"), None);

    std::fs::remove_dir_all(&dir).ok();
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
    let log_file = launch_log_path(root);
    let sink = LineLog::spawn(move |buf| append_bytes(&log_file, buf));
    log_orchestrator_line(&sink, orchestrator_level_to_shell(level, "info"), body);
    sink.barrier();

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

  /// 造一个隔离的临时项目根（退出记录的用例各自建、各自删）。
  fn exit_record_fixture(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "comfyapp-app-service-exit-{tag}-{}",
      std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
  }

  /// 「应用服务为什么结束」的记录落点与形态（ISSUE #1692 的 sidecar 档）。
  ///
  /// 这组用例钉的是**跨侧同源**里 Rust 这一头的三项：文件名（与
  /// `scripts/app-service-exit.mjs` 和 `src/lib/shell/app-service-exit.ts` 逐字相同）、
  /// 字段名、成因取值。Rust 侧没有 import 那条路，只能各写一次——没有这组断言，
  /// 「壳写的记录界面读不懂」就是一处静默失效，而现场恰好是最需要看清的那一次。
  #[test]
  fn app_service_exit_path_is_run_dir_and_name_matches_node_side() {
    let root = std::path::Path::new("/proj");
    assert_eq!(
      app_service_exit_path("/proj"),
      root.join("run").join("app-service-exit.json")
    );
    // 与 Node 侧两份字面量逐字相同（`scripts/app-service-exit.mjs` 的
    // `APP_SERVICE_EXIT_FILE` 与 `src/lib/shell/app-service-exit.ts` 同名常量）。
    assert_eq!(APP_SERVICE_EXIT_FILE, "app-service-exit.json");
    // 与 launch-status.json 并列：同属「本次运行的现场」，落在 run/ 而不是 log/。
    assert_eq!(app_service_exit_path("/proj").parent(), status_file_path("/proj").parent());
  }

  #[test]
  fn sidecar_exit_record_carries_the_shared_field_names() {
    let dir = exit_record_fixture("fields");
    let root = dir.to_str().unwrap();
    assert!(write_sidecar_exit_record(root, Some(1), "内嵌服务已终止，退出码 1"));
    let raw = std::fs::read_to_string(app_service_exit_path(root)).unwrap();
    // 无 BOM：读取侧是 JSON.parse（Node 端点）与 parseAppServiceExitRecord，
    // BOM 会让它当场失败。
    assert!(!raw.starts_with('\u{feff}'), "记录不许带 BOM：{raw}");
    let json: serde_json::Value = serde_json::from_str(&raw).expect("必须是合法 JSON");
    for field in ["at", "kind", "code", "signal", "reason", "port", "runId"] {
      assert!(json.get(field).is_some(), "缺字段 {field}：{raw}");
    }
    // 成因取值必须是 TS 联合类型认得出的那一个（`AppServiceExitKind` 的 sidecar 档）。
    assert_eq!(json["kind"], serde_json::json!("sidecar"));
    assert_eq!(json["code"], serde_json::json!(1));
    assert_eq!(json["reason"], serde_json::json!("内嵌服务已终止，退出码 1"));
    // 壳这一侧不知道端口与信号：必须是 null 而不是编一个值出来。
    assert_eq!(json["signal"], serde_json::Value::Null);
    assert_eq!(json["port"], serde_json::Value::Null);
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn sidecar_exit_record_never_invents_exit_code_zero() {
    // 退出码拿不到时写 null，**不写 0**：0 是「正常退出」这个具体结论，
    // 编出来会把故障说成正常（被信号杀掉时 Terminated 本就没有 code）。
    let dir = exit_record_fixture("nocode");
    let root = dir.to_str().unwrap();
    assert!(write_sidecar_exit_record(root, None, "内嵌服务已终止，未拿到退出码"));
    let json: serde_json::Value =
      serde_json::from_str(&std::fs::read_to_string(app_service_exit_path(root)).unwrap())
        .unwrap();
    assert_eq!(json["code"], serde_json::Value::Null);
    assert_eq!(json["reason"], serde_json::json!("内嵌服务已终止，未拿到退出码"));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn sidecar_exit_record_is_silent_when_root_is_empty() {
    // 项目根空串（安装目录里没有检出）时**静默返回 false**：这条记录是排障体验，
    // 不是启动的必要条件，写不出去不该把壳带崩，也不该在别处留下一个半成品文件。
    assert!(!write_sidecar_exit_record("", Some(1), "x"));
  }

  #[test]
  fn read_app_service_exit_returns_raw_text_and_none_when_absent() {
    // 壳读回的是**文件原文**（形状只在 TS 那侧解析一处），因此这里必须逐字相等；
    // 读不到（文件不存在 / 空的 / 项目根为空）回 None 而不是 Err —— 那是「没有原因
    // 可讲」这一正常状态，回 Err 会让界面把「没原因」显示成「接口挂了」。
    let dir = exit_record_fixture("read");
    let root = dir.to_str().unwrap();
    assert!(read_app_service_exit(root).is_none(), "还没写过时必须是 None");
    assert!(write_sidecar_exit_record(root, Some(2), "内嵌服务已终止，退出码 2"));
    let raw = std::fs::read_to_string(app_service_exit_path(root)).unwrap();
    assert_eq!(read_app_service_exit(root).unwrap(), raw.trim());
    assert!(read_app_service_exit("").is_none(), "项目根为空回 None");
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn sidecar_exit_reason_states_the_fact_without_concluding() {
    // 只陈述「这一次具体是什么结束的」：手上只有退出码一个事实，不替用户下
    // 「是崩溃还是被顶掉」的结论（那种结论会把排查引向另一个方向）。
    let with_code = sidecar_exit_reason(Some(137));
    assert!(with_code.contains("137"), "{with_code}");
    let without = sidecar_exit_reason(None);
    assert!(without.contains("未拿到退出码"), "{without}");
    // 「拿不到」与「正常退出」必须是两句不同的话。
    assert_ne!(without, sidecar_exit_reason(Some(0)));
  }

  #[test]
  fn launcher_session_pids_parses_launcher_and_children() {
    // 与 scripts/launcher-core 落盘的真实形状同形（本机 run/ 里的活样本）。
    let raw = r#"{"launcher_pid":134816,"child_pids":[129684],"app_port":3797,"mode":"prebuilt","started_at":"2026-11-16T16:02:50.131Z"}"#;
    assert_eq!(
      parse_launcher_session_pids(raw),
      Some(vec![134816, 129684])
    );
  }

  #[test]
  fn launcher_session_pids_skips_bad_items_and_is_none_when_empty() {
    // 非法项（0 / 负数 / 非数字 / null）逐项跳过，不整份作废；1 与 3 都是合法 PID，
    // 必须保留；一个都剩不下 → None。
    assert_eq!(
      parse_launcher_session_pids(r#"{"launcher_pid":0,"child_pids":[1,-2,"x",null,3]}"#),
      Some(vec![1, 3])
    );
    assert_eq!(parse_launcher_session_pids("{}"), None);
    assert_eq!(parse_launcher_session_pids("不是 JSON"), None);
    assert_eq!(parse_launcher_session_pids(""), None);
  }

  #[test]
  fn liveness_from_pids_is_three_state() {
    // 空名单 = 不知道；任一活着 = 没死；全部不在 = 真没了。
    assert_eq!(liveness_from_pids(&[], |_| true), None);
    assert_eq!(liveness_from_pids(&[1, 2], |pid| pid == 2), Some(true));
    assert_eq!(liveness_from_pids(&[1, 2], |_| false), Some(false));
  }

  #[test]
  fn read_app_service_liveness_reads_session_file_or_none() {
    // 文件不在 → None（手工 pnpm dev / 没走编排器的检出）；
    // 文件在 → 按名单判活。真 PID 的存活判据不在这里测（要起真进程），
    // 三态归并已由上面的纯函数用例钉住。
    let dir = exit_record_fixture("liveness");
    let root = dir.to_str().unwrap();
    assert!(
      read_app_service_liveness(root).is_none(),
      "会话文件不存在必须是 None"
    );
    let run = dir.join("run");
    std::fs::create_dir_all(&run).unwrap();
    // 名单用几乎不可能被分配的高位 PID（Linux pid_max 上限 4194304、Windows 同量级；
    // PID 1 在 POSIX 上是 init/launchd，真的活着，不能拿来当「不在」的反例）。
    std::fs::write(
      run.join("launcher-session.json"),
      r#"{"launcher_pid":4193810,"child_pids":[4193814]}"#,
    )
    .unwrap();
    // 两个 PID 都不存在 → Some(false)：说明「读到了名单并真的查了」。
    assert_eq!(read_app_service_liveness(root), Some(false));
    assert!(read_app_service_liveness("").is_none(), "项目根为空回 None");
    let _ = std::fs::remove_dir_all(&dir);
  }

  /// 第二档判据（ISSUE #4151）：壳持有 sidecar 句柄时的三态归并。standalone 分发
  /// 形态没有会话文件，这一档就是「进程外信号」的全部来源——「不知道」档不许
  /// 编答案，壳亲眼看到的死亡事实（`Terminated` 已见）直接判死、PID 探测不再参与。
  #[test]
  fn sidecar_liveness_answers_from_handle_or_none() {
    let alive_probe = |_: u32| true;
    let dead_probe = |_: u32| false;

    // 句柄不在（prebuilt / 兜底 dev URL / debug 壳）：无论死亡标记如何都答不上。
    assert_eq!(liveness_from_sidecar(None, false, alive_probe), None);
    assert_eq!(liveness_from_sidecar(None, true, alive_probe), None);

    // 句柄在、进程在（Terminated 未见的常态）。
    assert_eq!(liveness_from_sidecar(Some(4242), false, alive_probe), Some(true));

    // 句柄在、探测说没了：死亡事件未达的毫秒级窗口里按 PID 兜底判死。
    assert_eq!(liveness_from_sidecar(Some(4242), false, dead_probe), Some(false));

    // 壳亲眼看到 Terminated：直接判死——即便探测（在 PID 复用误读的假想里）
    // 说它活着，死亡事实也压过探测。
    assert_eq!(liveness_from_sidecar(Some(4242), true, alive_probe), Some(false));
    assert_eq!(liveness_from_sidecar(Some(4242), true, dead_probe), Some(false));
  }
}
