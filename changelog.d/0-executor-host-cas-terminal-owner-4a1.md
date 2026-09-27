## Added

- **P3 §5 第 2 期 · Phase 4-A1：任务收口写入的两条守卫（ADR §14 D4）**：`repository-task-impl.ts` 的七个「按 id 裸写」方法统一收口成两条 WHERE——`status NOT IN (终态)` 与 `ownedBy(本宿主声明)`。归属改为**构造期声明**（`createTaskRepoImpl(db, { owner })`，形参必填：漏传比错传危险，默认成 inline 会让 host 悄悄改写别人的行），Next 的 barrel 实例声明 `inline`、host 脚本声明 `host`（与它 `configureReaper({ owner: "host" })` 同源）。四个终态写（`finalizeSuccess` / `finalizeFailure` / `finalizeFromReaper` / `cancel`）的返回值从 `void` 变成 `TaskWriteOutcome`（`written` / `skipped-terminal` / `skipped-not-owned` / `skipped-missing`），调用点在「没写进去」时按原因留一行日志——混成一个 boolean 就只能靠猜。`replaceLogs` 只带归属守卫、**不带**终态守卫（收口之后的尾随日志正是排障要看的失败原因）；`findExecJob` 带归属条件（要交给 ComfyUI 的图不许读成别人的）。`cancel` 是全族里唯一免归属的写并写明理由：取消动作只活在 Next 进程，带上归属条件等于把「取消 host 名下的任务」这条合法路径堵死，而跨归属的只有状态标记、kill 在飞执行仍归 owner 自己做。

## Fixed

- **host 模式下「点了取消却显示失败」**：用户取消把行标成 `CANCELLED` 之后，host 的 `reconcileCancelled` 把在飞的 comfy-cli SIGKILL，被杀进程的退出收口走 `finalizeFailure`——那里曾是**无条件 UPDATE**，于是 `CANCELLED` 被改写回 `FAILED`。终态守卫落定后这条迟到写入被挡成 `skipped-terminal`，并配契约测（取消 → 迟到的失败收口 → 行仍是 `CANCELLED`）；另在**副本库 + 真 ComfyUI** 上端到端跑通同一条链（`claim-dispatched` → 取消 → `cancel-reaped` → 任务日志出现「失败收口未落库（skipped-terminal）」、行保持 `CANCELLED`）。
- **对已经结束的任务点取消不再翻状态**：同一批守卫顺带挡住 `SUCCEEDED → CANCELLED` 这类回退。
