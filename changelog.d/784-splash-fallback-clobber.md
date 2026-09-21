## Fixed

- **启动页不再被编排器的状态顶掉壳的现场，也不再卡着不动**（ISSUE #784 手验反馈：
  「点击 start-tauri.ps1 加载提示有问题，但是能进入应用界面 / 双击 app.exe 会一直卡在
  加载界面」）。手验暴露的还是同一族问题：**两个来源共用一个状态文件、而页面只按
  「最后写的那个人」渲染**。三处修正：

  ① **进度不许倒退**：壳在起编排器之后会把快照推进到 `shell-orchestrating`（`fallback: true`，
     进度恒 0），而编排器在更早就写下了 `port-check: 0.05` / `cache: 0.2`。轮询到快照那一轮，
     进度条会**从 20% 掉回 0%、阶段标签从「启动本地服务」退回「拉起本地服务」** —— 看起来像
     启动自己重来了一遍。现在快照轮只更新文案，进度取两者较大值（`updateFromShellFallback`）。

  ② **启动失败在启动页上看得见**：壳识别出自编排走不通时写的状态（新增 `shellLaunchFailed`
     标记）只有一句标题（`启动失败，见 log/`），明细全在 `shell_launch::mark_launch_failed`
     的 message 与 diagnostics 里 —— 面板过去只认 `phase`，于是用户看到的就是「启动失败，
     见 log/」加一屏还没落地的路径。现在失败态下启动页**自动展开日志面板**，并优先渲染
     「失败诊断」（含 message 与壳写下的三条路径）。

  ③ **快照自带诊断出口与启动报告**：编排器写的 `launch-status.json` 不带 `diagnostics`，
     一写就把壳的快照整份顶掉；而它写第一份日志之前磁盘上确实什么都没有。现在快照带
     `diagnostics`（项目根 / 壳侧链路日志 / 壳日志 / 状态文件）+ 结构化启动报告，
     `get_launch_log` 在「一条都读不到」时也会把那份报告附上 —— 那段窗口期的现场不再
     只存在于内存里。

## Changed

- `src-tauri/src/lib.rs`：`run()` 里的自编排步骤抽成 `start_self_orchestration(app, project_root)`
  （Rust 侧函数长度阈值 120 行，见规范 §12.13；顺带把「先定模式 → 留痕 → 回收残留 → 起编排器」
  的顺序写成文档）。
- `write_idle_status` 新增 `report` 参数（快照的 `diagnostics.launchReport`）；
  `startup_report_json` / `startup_report_section` 与逐行写日志的 `log_startup_report`
  同源，不会出现「日志里一套、面板里另一套」。
