## Fixed

- **`docs/guides/PRODUCTION-GAPS.md` 两处指向已经不存在的落点**（都是 `- [x]` 已完成条目里
  「证据」那一半，读起来像还能点开看）：
  - 覆盖率门槛那条写「调度器（`executor-scheduler.ts` 70/50）」，而这个文件已在 2026-09-28
    删除（`git log --diff-filter=D` 给出 90c627e3「两条派发循环收成一条 pull，内存队列与
    计数器退役」），现名 `src/lib/comfyui/executor-dispatch.ts`。补上现名与删除日期，
    不改那组门槛数字本身（那是当时的实测值）。
  - 模型库去重那条写 `components/model/model-library.tsx`，实际两处都是 PascalCase
    （`src/components/model/ModelLibrary.tsx` 与 `src/components/studio/ModelLibrary.tsx`，
    两份都还在）—— 照 kebab 写法去找会一无所获。
- **同批把这条线剩下的「查无此物」清单逐条读句子定过性与**（收紧后的探针在 5 份大档里
  报出 28 + 21 + 27 条文件名命中，其中真正是缺陷的只有上面两条）。判为**不是缺陷**的类别，
  连同复量入口一起记在这里，免得下次再扫一遍：
  - **运行期产物，本来就不在仓库里**：`run/app-service-exit.json`、`log/current/run.json`、
    `log/current/services/comfyui-last-session.json`、`log/schema-sync.json`、
    `data/runtime-secret.json`、`node_modules/.cache/prettier-gate.json`、`latest.json`、
    `.next/server/instrumentation.js.nft.json`。复算入口应当是写它的那段代码，不是 `ls`。
  - **外部仓库的路径**：`crates/next-api/src/nft.rs` / `nft_json.rs`（Turbopack 上游）、
    `node_modules/next/types/global.d.ts`、`virtual/e.ts`（虚拟模块示例）。
  - **句子自己就登记着删除**：`launch-and-build.md` 的会话横幅行（「整条撤掉」）、
    `12-代码组织与文件结构.md` 的 `src/lib/comfyui/markdown.ts`（「当年自研的那套」）、
    `17` 章的 `hooks/use-training-studio.ts`（「均已删」）。
  - **有代码侧同文记录的**：`core/events.ts` 的 `eventBus` —— `src/lib/core/index.ts:44`
    就写着「为什么没有 eventBus / 这里曾有一个…`events.ts`」，文档与代码说的是同一件事。
  - **命名规范里的示例名，不是存在性声明**：`BottomBar.tsx`、`HistoryList/types.ts`、
    `use-project-manager.ts`、`src/lib/huge.ts`、`.next/probe/x.ts`、`validator.ts`。
  - **刻意保留的自注历史**：`.file-size-baseline.json`、`scripts/.comment-language-baseline.json`
    （棘轮基线删除之后，文档里点名它们是「别再走那条通道」的内容本身）。
  - **断言「没有这个文件」的那类**：`middleware.ts` / `src/middleware.ts` —— 本仓实际是
    `src/proxy.ts`，而 PRODUCTION-GAPS 那两处一处写「无 `middleware.ts`」（缺口陈述，对）、
    另一处写「`src/middleware.ts` 与 `src/proxy.ts` **不能并存**」（Next 16.3.5 实测），都不该改。
- 复算：`pnpm doc:check` 退 0、`pnpm doc:render` 后生成物与源同批；`git log --diff-filter=D`
  与 `find src -name` 逐条实跑（不是凭印象），被点名的两条里 `executor-dispatch.ts` 与
  两份 `ModelLibrary.tsx` 都 `ls` 得到。
