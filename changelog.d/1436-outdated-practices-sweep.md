## Fixed

- **R10 注释硬规则漏掉块注释的「续行」**（`scripts/check-file-structure.cjs`）：
  判据原本只认「行首就是注释标记」的行，于是块注释里**不以 `*` 开头**的续行
  （典型形态是 JSX 注释块 `{/* … */}` 里手写的多行说明、以及整段贴进来的旧说明）
  整段漏网。实测 `src/` 里有 3 行这样的改动编号 / 日期标记长期没被拦下
  （`WorkflowWirePortRows.tsx` 的 `R-ardot21 (2026-08-14)` / `R-ardot20`、
  `ImageGenerationPanel.tsx` 的 `R-ardot89`）。判据改为带块注释状态的逐行扫描，
  并**显式排除**对反模式表 / 规范章节的交叉引用（`反模式 T5`、`§14 的 T12`）——
  放宽之后这两者会撞形，而交叉引用是「当前代码违反哪一条」的有效指路。
  3 行存量一并清掉（保留紧跟其后的当下判据）。
- **注释里指错的文件名**（指错不会报错，只是从此指不到东西）：
  `scripts/executor-host.mjs` 的 `src/env.mjs` → `src/env.js`；
  `src/lib/console/console-catalog.ts` 的安全边界指向已不存在的 `console-command.ts`
  → 现为 `console-guard.ts`；`src/components/studio/ProjectCanvasSettings.tsx` 的
  `wf-editor-inner.tsx` → `workflow-editor/WorkflowEditorInner.tsx`；
  `src/lib/endpoints.ts` 写着「`app-settings.ts` 里保留同名再导出」—— 该目录已明确
  **不再**代为转手默认端口常量，注释与实现相反，改写成单一出口。
- **`src/components/studio/canvas/IOEditContext.tsx` 的文件头还在自述旧名与旧出处**：
  标题写着已不存在的 `wf-contexts.tsx`，正文说状态住在 `wf-stores.ts`、弹层住在
  `wf-node-json-popover.tsx`（两个文件都已不在此路径），且把「Context → Zustand 迁移的
  兼容再导出」当成现状描述 —— 迁移早已完成。改成说清「本文件是 io 风格 API 的单一出口 +
  消费型组件」，store 的真实落点是 `workflow-editor/WorkflowStores.tsx`。
- **两处 `@deprecated` 兼容再导出清掉**：`ExtractToolbar` / `ExtractModelSelect` 转手的
  `parseChannelOption` / `ExtractChannel` / `channelOptionValue` 的真出处是
  `~/lib/workshop/channel-options`（纯函数、可单测）。两个消费方
  （`use-character-flows` / `useStoryboardExtractFlow`）改为直接引该模块，转手层删除。

## Changed

- **`src/components/ui/` 命名约定已翻档为硬闸**（`docs/standards/12-代码组织与文件结构.md`）：
  文档还写着 ui/ 是「软豁免，待存量 PascalCase 重命名后改为硬强制 kebab」，而判据
  （`check-file-structure.cjs` 的 R1/R2）早已对 ui/ 硬强制 kebab、目录内 PascalCase 文件数为 0。
  两处过时表述改写成当前事实。
- **无障碍三档分治的「实测存量」数字复算**（`docs/standards/06-无障碍访问-a11y.md`
  + `src/app/globals.css`）：`transition-*` 由 125 → 128 行，第 ③ 档由 112 → 115 行。
- **spacing scale 缩写候选的存量回潮清掉 + 补上「这条没有自动执行者」**：
  storybook 那批新 stories 一次性带进来 96 处 `w-[30rem]` / `h-[32rem]` 这类
  canonical 候选，而 `tw4-canonical-report.mjs` **不在** pre-commit（起 Tailwind 引擎、
  单次约 6s）。用 `--write` 落盘清零，并在 `docs/standards/03-样式与-tailwind.md` 写明
  「新增一批视图文件后按需跑一次」。测试文件里的两处按脚本原口径**不动**
  （`log-panel-layers.test.ts` 那处是刻意用非 canonical 形态的负样本）。
