## Removed

- **旧的按年月归档机制整体移除**（ISSUE #1326 第 4 刀）：`scripts/launcher-core/log.mjs` 的 `archiveRunLog()` 与它的 `archive` 分区没了，`dev-launcher.mjs` 收尾只剩一条 `archiveCurrent(ROOT, { exitCode })`。
  - 为什么要删：那是**两条互不相干的归档通道**。旧的把 `dev-launcher.log` append 进 `log/archive/<yyyy-MM>/`（一份合并文件、无限累积），新的把整个 `current/` 复制进 `log/runs/<日期>_<时分秒>-<runId>/`（一次一包、有保留策略）。并存期间两者都在跑，同一件事两个口径 —— 翻历史的人不知道该看哪一边，而其中一边（旧的那条）没有任何清理机制。
  - 这一刀删得掉的前提在第 2 刀：`current/` 已经承载全部写方，`archiveCurrent()` 在退出时归档。第 2 刀之前删它会丢日志。

## Notes

- **`log-sessions`（会话切分）这一刀刻意没删**，虽然 Issue 里提到「复盘历史去 runs/ 里一次一包」会取代它。原因是它并非死代码：`/api/logs/sessions` → `use-runtime-log-source` → 设置页 `RuntimeLogBox` 的「启动日志」下拉是一条完整可用的链路，而删掉它等于**删掉一个用户可见的功能**（不只是清理死代码）。新布局下 `current/` 只含本次运行，那个下拉会自然退化成「只有一个会话」—— 功能不再增值，但也不出错。要不要连下拉一起拆，是要作者拍的产品决定，不该由清理 PR 顺手做掉；已在 Issue 里回问。
- `session-banner.server.ts`（会话横幅写入）随 `log-sessions` 一并保留：它由 comfyui / drizzle / ollama 三处 lifecycle 调用，读侧在，写侧就不能先删。
