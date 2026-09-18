## Fixed

- **PR #677 与 `master` 的合并冲突按「`master` 的库域化路径与门禁口径优先、本分支的性能改动保真」解决**：
  冲突集中在 3 个文件，两类来源 ——
  ① import 路径：`master` 的 `refactor(lib)` 把 `src/lib` 根模块归入 6 个子域，本分支在旧路径上
  改动了同一批 import。冲突处一律取 `master` 的子域路径（`src/lib/workshop/workflow-run.server.ts`
  的 `~/lib/workflow/workflow-types` 与 `~/lib/workflow/workflow-io-types`、
  `src/server/api/routers/workflow.ts` 的 `~/lib/workflow/workflow-io-types`）。
  ② `.githooks/pre-commit` 第 6&7 步：`master` 把该步拆成 `6/24 tsc` 与 `7/24 eslint`，本分支
  将其合并为并行块并给 eslint 统一 `--cache --cache-strategy content`。冲突处取本分支的并行
  实现与缓存注释，同时保留 `master` 新增的「按需那一层（全量单测 / 构建护栏 / E2E）走
  `@` 评审 NPC 唤起一轮，见规范 13.5.4」口径 —— 两处改动正交，可同时成立。
  `master` 对 R5 遗留说明与第 23 步（`src/lib + src/trpc` 零消费导出）的改动无重叠，自动合并。
