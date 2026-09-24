## Added

- **`check-ui-primitives.cjs` 新增 P71「视图层手写 `dark:palette` 色」棘轮判据**
  （shadcn `styling.md`「No manual `dark:` color overrides. Use semantic
  tokens」+ 规范 §4.11.1）：锚点是 `dark:` 前缀 + Tailwind 调色板色名
  （emerald/green/rose/red/amber/sky/cyan/violet/blue/purple/…）+ 数字档位，
  覆盖 `dark:text-red-400` / `dark:bg-emerald-500/15` / `dark:border-amber-*`
  等。语义类（`text-ink-*` / `bg-subtle` / `text-muted-foreground`）不含
  调色板色名 + 数字档，天然不命中。`ui/` 层与 test 走 EXEMPT_DIRS 短路。
  棘轮（非硬闸）：全界面扫网实测视图层存量 **230 处**，本批折叠 log-level
  色系统后冻结为 **215 处**起点、只许降。

## Changed

- **log-level 配色系统从 palette 字面量迁到语义 token**（§4.11.1 + §12.12
  去重 + P71）：日志级别（debug/info/warn/error/success/progress）是
  **状态语义**，此前散在三处、且各写各的 palette 字面量 + 手写 `dark:` 档：
  - `logs/log-row-style.ts`（规范源）的 `LEVEL_BADGE_STYLES` /
    `LEVEL_TEXT_STYLES`：info→`--color-info`、warn→`--color-warning`、
    error→`--color-destructive`、debug→`subtle` 系；
  - `project-canvas/GlobalStepLogPanel.tsx` 与 `workflow-library/
WorkflowRunLogModal.tsx` 各内联重抄了一份「同款」`LEVEL_STYLES`
    （§12.12 孪生）：error→destructive、warn→warning、success→success、
    progress→primary（violet 是旧品牌色、现走 primary token）、info→info。

  关键收益：此前 **log 的 error 用 rose、而全局 status-badge / alert 的
  error 用 destructive**——同一「错误」语义两种颜色。统一走 destructive
  后，改一处状态色 token 全站跟着变，且 log 徽标与状态徽章的 error 色
  一致。token 内部含深浅两态，`dark:` 手写档全部消失。

  **保留**：`log-row-style.ts` 的 `TOKEN_CLASS`（ANSI 终端 8 色 red/green/
  yellow/blue/magenta/cyan）是**文档化的 palette 例外**——它们表示终端
  SGR 颜色身份、不是状态语义，没有对应语义 token，按 §3.6.1 保留字面量。

- **`agent-run/RunControlBar.tsx` 修混合不一致 bug**：同一三元里
  `step.ok ? "text-emerald-500" : "text-destructive"`——else 分支已是语义
  token、then 却用字面量。`text-emerald-500`（#10b981）与
  `--color-success-strong` 精确等值，统一走 `text-success-strong`。

## Fixed

- **两处「整树 walk」结构守护测试在 pre-commit 并行组里超时假红**：
  `tests/container-single-access.test.ts`（扫 `src/`）与
  `tests/core-barrel-entry-discipline.test.ts`（扫 `src`/`tests`/`scripts`/`e2e`）
  都是同步整树读文件 + 剥注释的判据，单独跑 <3s，但在 4 组并行的
  `.githooks/pre-commit` 下、开发机又同时跑多份工程时，会越过 vitest 默认
  5s 单测超时被误判失败。给这两条用例显式设 `timeout: 30_000`（断言与判据
  不变，只是不再对环境 CPU 争用敏感）。

## Notes

- 剩余 215 处 `dark:palette` 分布在 68 文件，含**状态色**（red/amber/
  emerald 用作 error/warn/success，应继续 token 化）、**品牌紫**（violet
  → primary）、**类型/装饰色**（cyan/sky 等，§3.6.1 可能合理）三类。
  token 值仅对 amber→warning-strong、red-700→danger-strong、
  emerald-500→success-strong 精确等值，其余（rose→destructive、
  bg/border 的 /opacity 档）非精确等值、逐案需视觉核对，**按域分片降基线**
  （P71 棘轮保证每 PR 只能降不能升）。本 PR 先折叠最大、最一致的一簇
  （log-level 系统）。
