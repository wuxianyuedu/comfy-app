## Added

- **窗口显示链路的运行期诊断信号（ISSUE #3569，跟进 #3562）**：#3562 的事故是「同一次启动里显示动作被重放」，但既有判据全是 Rust 纯函数 + 源码形态，只能回答「代码长什么样」，回答不了「这次启动到底发了几次窗口动作」。现补一组可机器读的读数：
  - `AppState` 增三个 `AtomicU32`：`show_attempts`（每次进入 `show_main_window_without_focus()`）、`auto_show_skipped`（自动路径被 `already_shown` 早退拦下）、`focus_granted`（窗口真正聚焦到前台）。**只做诊断，不参与 `activate` 判决，也不改变任何窗口动作**。
  - 自动早退时落结构化日志 `window-show diagnostics: reason=already_shown skipped=N attempts=M`；壳退出时在日志落一行汇总 `window-show diagnostics at exit: attempts=… auto_show_skipped=… focus_granted=…`。交接完成后 `auto_show_skipped` 还在涨，就是「被重放」的直接证据。
  - 新增只读 Tauri 命令 `window_show_diagnostics`（返回 `WindowShowSnapshot` 快照，注册进 `generate_handler!`），供后续壳冒烟脚本取数；命令不推断重放是否合法，判定仍需结合 Win32 前台 / Z 序读数（ISSUE #3570）。
  - **判据**：`src-tauri/src/lib.rs` 新增 `window_show_replays_are_counted_for_diagnostics`（计数、快照、以及三个自增点在源码形态上不回退）；`tests/check-file-structure.test.ts` 新增「窗口显示运行期诊断信号（ISSUE #3569）」5 条用例。口径写进 `docs/standards/launch-and-build.md` §1.3.2，`docs/generated/` 镜像同批重生成。
  - 改动落在 `src-tauri/src/**`，按硬规则 5 必须重编 release 壳（`cargo build --release --features custom-protocol`）才对双击 exe 生效。
