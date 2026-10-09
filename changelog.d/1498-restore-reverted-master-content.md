## Fixed

- **`ad81a912`（PR #1580 的 squash）把 master 上多批已合入的修复整体回退了**，本批逐处找回：

  - **视频队列的封面 / 下载入口**（PR #1579）：服务端 `task.list` 重新发 `videoPath` 列、
    客户端恢复 zod 镜像与 `parseVideoRows` 逐行校验、`historyTaskRowSchema` 恢复导出。
    回退把「列名契约 ↔ 前端镜像」那条判据架空了，而 `tests/task-list-wire-contract.test.ts`
    （C 组固定清单）仍在 —— 实测 **tsc 3 条 + 用例 9 条红**，且那个用户可见缺陷
    （缩略图位恒占位图标、下载按钮一次不出现）被重新放回。
  - **`HistoryTaskCard` 主体的键盘可达性**（`check-click-keyboard.cjs` 判的那一处）：
    `div + onClick` 恢复成原生 `<Button>`，键盘 Enter 重新能打开详情。
  - **`media-source.server` 的 MIME 回退判据**（PR #1584）：本地分支重新走
    `mimeForExt(extOfPath(abs))` —— 此前传整条路径恒回 `image/png`，webp / jpeg 产物被标错。
  - **依赖新鲜度判据的接线**（`check-deps-freshness.mjs`）：pre-commit D 组那一步
    （`--staged`）与 `pnpm check:deps-freshness` 入口一道接回 —— 判据脚本在、执行者不在
    正是 `check-gate-executors.cjs` 要拦的形态。
  - **`check-click-keyboard.cjs` 的 pre-commit 接线**同样接回。
  - **规范与 AGENTS 的对应章节**：§13.5.13（依赖新鲜度）、§13.6.3（环境里跑不到门禁先装）、
    §13.1 自查清单两条、D 组判据清单两行、AGENTS 硬规则 25 / 26 与快速排障两条。

  回退的形态是「**合并取错一侧**」：`ad81a912` 的提交信息自称「master 新增的 §13.5.13 /
  §13.6.3 两节照旧保留」，实际两节一次都不出现。本批以 `bfeb33f0`（回退前一步）为蓝本逐处
  还原，并保留 `ad81a912` 真正新增的产物（`base-check.mjs` / `check-on-demand-duties.cjs`
  及其接线）。归属说明：这些红**不是本 ISSUE 引入的**，是 master 基线自带的（ISSUE #1498）。
