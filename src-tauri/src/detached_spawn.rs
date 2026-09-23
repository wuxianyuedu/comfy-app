//! 「脱离 Job Object 的保活拉起」——同一个 exe 的 **CLI 形态**。
//!
//! ## 为什么需要它
//!
//! keepAlive 的语义是「勾选它，应用关掉后这个服务继续跑」。两个平台各有各的
//! 拦路者：
//!
//! * POSIX：子进程与编排器同组时会被组回收带走 —— 用 `spawn({detached:true})`
//!   自建进程组解决（`src/lib/process/process-launch.ts`）。
//! * Windows：树级 `taskkill /T` 与 **Job Object** 两道。前者已被
//!   powershell `Start-Process` 中介规避（目标成为孤儿，`/T` 遍历不到）；
//!   后者躲不掉 —— **job 成员身份在进程创建时继承**，而壳给编排器挂了
//!   `KILL_ON_JOB_CLOSE` 的 job（见 [`crate::shell_launch::attach_kill_on_close_job`]），
//!   于是壳一退出、job 关闭，**整棵树（含被保活的服务）当场终止**。
//!
//! ## 为什么是 CLI 形态而不是 Tauri 命令
//!
//! 服务是被 **Next server（Node）** 拉起的，而 Tauri 的命令面只有 webview 够得着
//! ——服务端叫不到「壳帮忙起个进程」。于是让壳多一个入口：**同一个 exe 带标志启动
//! 时不做 GUI，只当一次中介**。
//!
//! ```text
//! Next server ──spawn──> app.exe --spawn-detached --cmd <exe> --arg … --out … --err …
//!                            └─ CreateProcess(CREATE_BREAKAWAY_FROM_JOB) ──> 服务（自由身）
//! ```
//!
//! ## 逃出 job 需要两半配合（缺一不可）
//!
//! 1. **父 job 允许**：`JOB_OBJECT_LIMIT_BREAKAWAY_OK`（在 `shell_launch.rs`）；
//! 2. **创建时请求**：`CREATE_BREAKAWAY_FROM_JOB`（在本模块）。
//!
//! 标志走标准库的 `std::os::windows::process::CommandExt::creation_flags`，
//! 因此不需要额外的 windows crate feature。
//!
//! ## 与硬规则 3 的关系
//!
//! 硬规则 3（子进程一律经平台统一出口回收）约束的是**回收**，本模块只管**起**，
//! 且这里恰恰要的是「不被调用方的树回收带走」——那正是 keepAlive 的语义。
//! 回收仍由 `kill-process-tree`（调用方明确按 pid 发起）负责。
//!
//! ## 调用方看到什么
//!
//! 成功：stdout 打 `pid=<n>`，退出码 0；失败：stderr 打可行动原因，退出码 1。
//! 调用方（`process-launch.ts` 的 Windows keepAlive 分支）按退出码判定拉起
//! 是否被拒，与旧的 powershell 中介契约一致。

use std::process::{Command, Stdio};

/// CLI 形态的判别标志。**只有**第一个参数恰好是它时才走本模块 —— 正常的 GUI
/// 启动（含双击、`pnpm tauri dev`）参数表里不会有它。
pub const MODE_FLAG: &str = "--spawn-detached";

/// Windows：逃出 job 的创建标志（`winbase.h` 的 `CREATE_BREAKAWAY_FROM_JOB`）。
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
/// 目标自建进程组（与 PowerShell 中介的孤儿语义一致，且便于按组回收）。
#[cfg(windows)]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
/// 目标不开控制台窗口（本模块自身是 GUI 子系统，没有可继承的控制台）。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 解析后的拉起请求。
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SpawnRequest {
  pub cmd: String,
  pub args: Vec<String>,
  pub cwd: Option<String>,
  pub out: Option<String>,
  pub err: Option<String>,
}

/// 解析 `--cmd <exe> [--arg <值>]… [--cwd <目录>] [--out <文件>] [--err <文件>]`。
///
/// 参数是**逐项**给的（`--arg` 可重复），不是拼一个命令行字符串：拼串要处理引号
/// 与空格的转义，而调用方（Node）手里本来就是 argv 数组，多一次拼接就多一处
/// 「路径带空格 / 含引号」的失败面。
pub fn parse_request(args: &[String]) -> Result<SpawnRequest, String> {
  /// 取某个标志的取值（下一个位置）；缺值即调用方拼错了参数表。
  fn take(args: &[String], i: usize, flag: &str) -> Result<String, String> {
    args
      .get(i + 1)
      .cloned()
      .ok_or_else(|| format!("{flag} 缺少取值"))
  }

  let mut req = SpawnRequest::default();
  let mut i = 0;
  while i < args.len() {
    let flag = args[i].as_str();
    match flag {
      "--cmd" => {
        req.cmd = take(args, i, flag)?;
        i += 2;
      }
      "--arg" => {
        req.args.push(take(args, i, flag)?);
        i += 2;
      }
      "--cwd" => {
        req.cwd = Some(take(args, i, flag)?);
        i += 2;
      }
      "--out" => {
        req.out = Some(take(args, i, flag)?);
        i += 2;
      }
      "--err" => {
        req.err = Some(take(args, i, flag)?);
        i += 2;
      }
      other => return Err(format!("不认识的参数：{other}")),
    }
  }
  if req.cmd.is_empty() {
    return Err("缺少 --cmd：没有要拉起的可执行文件".to_string());
  }
  Ok(req)
}

/// 本次启动是不是 CLI 形态：是则执行并返回退出码，否则 `None`（继续正常的 GUI 启动）。
///
/// 调用点必须在 `run()` 的**最前面** —— CLI 形态不该建窗口、不该认领单实例身份、
/// 也不该去拉编排器。
pub fn run_from_args() -> Option<i32> {
  let argv: Vec<String> = std::env::args().skip(1).collect();
  if argv.first().map(String::as_str) != Some(MODE_FLAG) {
    return None;
  }
  Some(match parse_request(&argv[1..]) {
    Ok(req) => spawn_detached(&req),
    Err(e) => {
      eprintln!("error={e}");
      1
    }
  })
}

/// 建一次进程，成功返回 0 并打 `pid=`；失败返回 1 并把原因写 stderr。
///
/// `breakaway` 会**试两次**：带标志的那次在「当前进程不在任何 job 里」或「所在
/// job 没有 BREAKAWAY_OK」时会被 CreateProcess 直接拒（`ERROR_ACCESS_DENIED`）。
/// 这两种环境本来就没有 job 要逃（例如 `pnpm tauri dev`），去掉标志重试即可 ——
/// 不把「环境里没有 job」变成拉起失败。
fn spawn_detached(req: &SpawnRequest) -> i32 {
  let attempt = |breakaway: bool| -> std::io::Result<std::process::Child> {
    let mut command = Command::new(&req.cmd);
    command.args(&req.args);
    if let Some(cwd) = &req.cwd {
      command.current_dir(cwd);
    }
    command.stdin(Stdio::null());
    command.stdout(redirect(&req.out)?);
    command.stderr(redirect(&req.err)?);
    #[cfg(windows)]
    {
      use std::os::windows::process::CommandExt;
      let mut flags = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;
      if breakaway {
        flags |= CREATE_BREAKAWAY_FROM_JOB;
      }
      command.creation_flags(flags);
    }
    #[cfg(not(windows))]
    {
      let _ = breakaway;
    }
    command.spawn()
  };

  match attempt(true) {
    Ok(child) => {
      println!("pid={}", child.id());
      0
    }
    Err(first) => match attempt(false) {
      Ok(child) => {
        println!("pid={}", child.id());
        0
      }
      Err(second) => {
        eprintln!("error=拉起失败：{first}（去掉 {MODE_FLAG} 的脱离标志后仍失败：{second}）");
        1
      }
    },
  }
}

/// 输出重定向：给了文件就写文件（沿用调用方的按次命名），没给就丢弃。
fn redirect(path: &Option<String>) -> std::io::Result<Stdio> {
  match path {
    Some(p) => Ok(Stdio::from(std::fs::File::create(p)?)),
    None => Ok(Stdio::null()),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn argv(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn parses_command_args_and_redirection() {
    let req = parse_request(&argv(&[
      "--cmd", "python.exe", "--arg", "-s", "--arg", "/x/main.py", "--cwd", "D:\\Comfy", "--out",
      "o.log", "--err", "e.log",
    ]))
    .unwrap();
    assert_eq!(req.cmd, "python.exe");
    assert_eq!(req.args, vec!["-s", "/x/main.py"]);
    assert_eq!(req.cwd.as_deref(), Some("D:\\Comfy"));
    assert_eq!(req.out.as_deref(), Some("o.log"));
    assert_eq!(req.err.as_deref(), Some("e.log"));
  }

  #[test]
  fn keeps_values_that_look_like_flags() {
    // 参数值本身可能是 `--out` 这类字面量：只按**位置**取值，不再二次解析。
    let req = parse_request(&argv(&["--cmd", "a.exe", "--arg", "--out"])).unwrap();
    assert_eq!(req.args, vec!["--out"]);
  }

  #[test]
  fn rejects_missing_command_and_dangling_value() {
    assert!(parse_request(&argv(&["--arg", "x"])).unwrap_err().contains("--cmd"));
    assert!(parse_request(&argv(&["--cmd"])).unwrap_err().contains("缺少取值"));
    assert!(parse_request(&argv(&["--cmd", "a.exe", "--nope", "x"]))
      .unwrap_err()
      .contains("不认识的参数"));
  }

  #[test]
  fn mode_flag_is_not_treated_as_a_gui_launch() {
    // 判据只认第一个参数：GUI 启动（空参数表）不返回退出码。
    assert!(run_from_args().is_none());
  }
}
