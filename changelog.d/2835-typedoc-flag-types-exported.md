## Fixed

- **「API 文档生成与自检」那一格在干净 `origin/master` 上的存量红修掉了（ISSUE #2835）**：
  `src/lib/workflow/workflow-list-types.ts` 里 `DiskSyncFlags` / `ExecutionFlags` 两个类型
  没有 `export`，而 `WorkflowListRow` 是以**交叉类型**引用它们的 ⇒ typedoc 报
  「referenced by …WorkflowListRow but not included in the documentation」两条 warning，
  而 `check-docs-api.cjs` 按 #2444 定的口径**把 warning 判成红**（未收录符号不许静默漂）。
  这一格的触发面是 `src/lib` / `src/server` / `src/trpc` —— 也就是最常见的那一类提交，
  所以从那次引入起，**任何命中它的 PR 都会在这一格红**，而红与那个 PR 无关。

  引入它的是 **oxlint `consistent-type-definitions` 的全仓机械批**（`04d9a122`，ISSUE #2775 / PR #2814）。
  那一笔的前后差分（`git show 04d9a122 -- src/lib/workflow/workflow-list-types.ts`）：

  ```diff
  -interface DiskSyncFlags {
  +type DiskSyncFlags = {
  -export interface WorkflowListRow extends DiskSyncFlags, ExecutionFlags {
  +} & DiskSyncFlags &
  +  ExecutionFlags;
  ```

  两个 flag 类型**改之前也没有 `export`** —— 问题不在"丢了导出"，而在**引用形态换了**：
  `export interface X extends A, B` 时 typedoc 能把 A/B 并进 X 的页面；
  换成 `export type X = {…} & A & B` 之后它读不到那两个本地类型的文档。
  ⇒ **一次「只改类型写法、不改变行为」的机械批，动了产物判据看得见的那一层**，
  而 `tsc` 与 `eslint` 全绿是必然的（它们不判 typedoc 的收录能力）。
  这条账记在单子末尾：**全仓机械重构批的自检清单里该有一条「产物侧判据」**
  （`pnpm docs:check` / `pnpm run doc:render -- --check`），不只是类型与 lint。

  归属不是猜的：`node scripts/base-check.mjs "node scripts/check-docs-api.cjs"` 在
  **干净的 `origin/master` 快照**（临时 worktree `comfy-base-check-KEICBk`）上复算 ⇒
  `baseline-red`，基线那侧输出的末尾逐字是那两条 warning。
  本 PR 就是那条口径里说的「挡路的硬闸类红 ⇒ 单独一个 commit + 单独一条碎片」那一笔，
  **不带任何功能改动**。

  修法取单子里的第 1 案（改动面两个词）：给那两个类型加 `export`，并把**为什么必须导出**
  写在它们自己的注释里 —— 否则下一次有人按「没被外部消费的导出」把它们收掉，
  这一格会再红一遍（而那个人看不到任何理由）。

  修后当场读数：`pnpm run docs:check` ⇒ **EXIT 0**，
  `[ok] API 文档生成与自检 · docs/api/**（已生成并自检通过：**2857 份产物**（390 个模块页）→ docs/api/（不在 git 里））`
  —— 产物从修前的 **2855** 涨到 **2857**，正好是多出来的那两个类型页 ⇒ 它们真的进了文档，
  不是把 warning 藏掉。另外 `tsc --noEmit` EXIT 0、`eslint` 该文件零输出、
  `node scripts/check-dead-exports.cjs`（临时加 export 时先探过一次）EXIT 0 不点名这两个符号。
