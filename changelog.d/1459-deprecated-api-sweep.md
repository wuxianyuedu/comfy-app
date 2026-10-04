## Fixed

- **zod 4 的 `@deprecated` format 别名还剩 3 处没收（`src/env.js`）**：上一轮（#1436）
  按上游 d.ts 声明的口径扫过一遍，但漏了 `src/env.js` —— 而它恰恰是**每条启动路径都
  先跑的那一份 env 校验**（`BETTER_AUTH_URL` / `DATABASE_URL` / `SENTRY_DSN`）。
  `z.string().url()` → 顶层 `z.url()`，行为零变化。

  **为什么上一轮会漏**：该文件的扩展名是 `.js`（T3 脚手架的原始形态），而扫描时
  按 `.ts` / `.tsx` 找调用点 —— 一个按扩展名收窄的 grep 就是一道会静默失效的清单。
  这次的复算口径改成「全库无扩展名过滤 + 逐条对 `zod@4.6.5`
  `v4/classic/schemas.d.cts` 里的 `@deprecated` 清单」，顺手把接口上其余 40 余条
  废弃别名（`_def` / `_output` / `_input` / `.isOptional()` / `.step()` / `.finite()` /
  `__` 系列 / `.uuidv4()` 等）也在全库核了一遍 —— **均为 0 处命中**，可记账。

- **三处「名不副实」的文件头自述（注释指向已改名的文件 / 已删的模块）**：
  - `WorkflowStores.tsx` 头部仍自称 `wf-stores.ts`、并把内容描述成「从
    `wf-contexts.tsx` 迁移过来」——那是迁移动作的历史，不是当前形态；真名字是
    PascalCase（12 §12.9），`wf-contexts.tsx` 已不存在。改成说清「本文件是 3 个画布
    store 的唯一出口」。
  - `WorkflowNodeJsonPopover.tsx` 头部同样自称旧名，且把**打破循环依赖的那条边**
    写成 `wf-stores.ts`（真名 `WorkflowStores.tsx`）——这条边是文件存在的理由，
    指错就等于「为什么不能挪走」这件事没了依据。
  - `safe-name.ts` 的形态账里列着「已删的 `lib/comfyui/trainer.ts` 也曾有一份」，
    而它随炼丹功能删除后**该引用不指向任何东西**；同时那句「全库有五份」与下面只列
    出的三份对不上。改成只记现存落点。

  这一类**都编译得过、门禁也不报**：注释不参与类型与运行时，错的是「读它的人得到的
  事实」。按 §12.4.2 的判据，指向当前实现的指路必须为真，历史归 `git log`。

- **文档示例里的同款废弃写法（`docs/standards/16` 的登录表单示例）**：
  `email: z.string().email("...")` → `z.email("...")`。示例代码是给人抄的，
  抄一版废弃形态等于把过时写法扩散到新代码里（本仓 §16 整章就是「照着抄」的落点）。
  `docs/generated/` 同步重渲染。

## Changed

- （无源码行为变更）本批全部是「库升了版本、代码 / 注释 / 文档还用旧写法」的形态账，
  以及指向已改名文件的自述修正。派生的复算结论：zod 废弃别名在本仓**现存用法已归零**
  （除 `.int()` 一处「legacy 但不会移除」的软提示，上游明确写着「never be removed」，
  按上游口径不迁移）。

## Notes

- **复算照出 `master` 基线带一条旧红，不属本批**（规范 §13.6.2 的处置口径）：
  `tests/storybook-tsc-input.test.ts` ④「缺了生成件时 tsc 真的退 0」在本分支与
  **干净 `origin/master` 检出上同样红**，报 `.storybook/preview.tsx(13,8)` 的
  `TS2882: Cannot find module or type declarations for side-effect import of
'../src/app/globals.css'`。

  **复算证据**：`git worktree add ../.wt-base-check origin/master`（HEAD = 7eddf35e，
  与本分支同一上游提交）→ 在该干净检出上跑同一条用例 → 同样红、同样这一行。本批
  改的 6 个文件与该用例无任何静态 import 关系（改的是 `src/env.js` / 三处注释自述 /
  一份文档示例）。

  **根因**：该用例的判据是「把**生成件**挪走 = 新检出的形态，tsc 必须退 0」，但它
  只挪 `.storybook/generated/app-origin.json`，而**真正新检出还有第二样东西也是现
  生成、不入库的**：`.next/` —— `next-env.d.ts` 与 `.next/dev/types/**` 由
  `next dev` / `next build` 产出，而窄项目（`narrowTsconfigText`）显式 include 了
  `next-env.d.ts` 与 `.next/dev/types/**/*.ts`。缺了它们，`.storybook/preview.tsx`
  的 `import "../src/app/globals.css"` 就没有 `*.css` 的模块声明可吃 → TS2882。
  与台账 E15 / #1409 是**同一类**：「门槛依赖只有跑过某条命令才存在的文件」。
  作者机器上 `.next` 在（跑过 dev/build），所以落库时全绿。

  本批**不修**它：它不在 ISSUE #1459 的范围内，且修法要动「④ 的判据该不该把
  `.next` 也纳入暂存面」这个设计决定（挪 `.next` 会打到并发的 tsc / eslint，与
  该用例里那条「目录必须还在」的注释是同一个顾虑）。记录在此供单独开单。
