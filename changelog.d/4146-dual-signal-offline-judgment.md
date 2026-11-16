## Added

- **应用服务离线判据升级为双信号：探活失败时以「进程还在吗」的进程外事实为准**
  （ISSUE #4146，#4140 的后续）。
  HTTP 探活的语义是「这一刻能不能应答」，它永远带着被测进程（单事件循环的 dev
  server）的忙闲——同步重活把事件循环停走十几秒时，探活必然连续超时，而进程活得好
  好的。仅靠放宽超时挡不住长停走，所以补第二个信号：
  - **壳侧**新增 IPC 命令 `get_app_service_liveness`（`shell_launch::
    read_app_service_liveness`）：读编排器落下的 `run/launcher-session.json`
    （`launcher_pid` + `child_pids`）逐个查 PID 存活（Windows `OpenProcess` +
    `GetExitCodeProcess`，POSIX `kill(pid, 0)`），**不经过 dev server 的任何线程**。
    三态：任一活着 / 全部不在 / 读不到（手工 `pnpm dev` 无会话文件 → `None`）。
  - **前端**探活失败的每一拍问一次壳（`readAppServiceProcessAlive`，2.5s 超时防壳
    自身卡死），`deriveDevServerStatus` 增第五态 **`unresponsive`**：不可达 + 进程在
    → 状态栏琥珀色「应用服务无响应」（提示此刻操作可能失败、通常几秒自行恢复），
    **不翻「已断开」、不写断开消息**；不可达 + 进程没了 / 没有信号（`null`：浏览器 /
    旧壳）→ 维持 `offline` 原行为，不编答案。消息中心进 / 出 `unresponsive` 都静默；
    `unresponsive → offline`（停走期间进程真没了）仍记断开。
  - 效果：「已断开」的语义从「一时答不上」收紧为「**进程没了**」——CPU 阻塞、编译
    锁这类重载窗口最多产生一个软提示，翻不了红。
  - 回归：`dev-server-status.test.ts`（unresponsive 判据 / `processAlive=false` /
    `null` 退回 / stale 优先级）、`use-dev-server-liveness.test.ts`「双信号」一组
    （失败问壳、true/false/null 三档、探通即清）、`app-service-message.test.ts`
    「unresponsive 的边沿」一组；壳侧 `shell_launch` 会话解析与三态归并单测
    （cargo test 65 条全绿）。
