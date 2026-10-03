## Added

- **组件工作台补上「Args → 数据源」的注入层，并把「有数据依赖」那一批的 story 补齐**（ISSUE #1381 续，规范 16 §16.2.3.6）。
  - 注入层 `.storybook/data-sources.tsx`：story 声明「我要哪种数据源」，注入层把它变成**真的**那一份。两种机制 —— **值源**（`json` / `media`，`args.sourceName` + `resolveSource()`）与**运行期提供者**（真 tRPC 链路 + 应用外壳，`preview.tsx` 全局挂）。
  - **刻意不 mock**：`media` 源里留了一个**故意不存在**的 `missing.png`（失败兜底那条分支的现场），名字不认识时 `resolveSource()` 抛错 —— 静默回退会让「源名写错了」与「本来就没有」变成同一件事。
  - **纠了一个词**：复核发现「有数据依赖」此前用得**太宽**。`field` / `seed-mode-button` / `option-list-popover` / `segment-popover` 其实是**纯 props，只是有几个 ReactNode 参数**（Args 面板装不下 React 节点）；`studio/RequiredSummary` 是**结构化入参**。真正需要注入层的只有「吃一条真链路 / 一层真上下文」那一档。
  - story 新增 34 → 74 份，`ui/` 有 story 的组件数 **21 → 34**（棘轮基线同批改），并新增 `Studio/` 与 `Workshop/` 两个分组。
  - **跨源那道门槛写明在案，且刻意不绕**：应用的 tRPC 端点不回 `Access-Control-Allow-Origin`，为一个开发工具去改生产端的安全面不划算（`next.config.js` 那侧本仓早有口径）。于是 tRPC 那一族 story 在画布上验的是「界面在后端不可用时的形态」—— 恰好是真机上最难复现的一档。

## Fixed

- **`.storybook/**` 是 tsc 与 eslint 的**双重盲区**：TS 与 ESLint 的 glob 都会跳过以点开头的目录，于是这一个目录从来没有被类型检查或 lint 过（而它从接入那天起就放着注入层的公共依赖）。同批在 `tsconfig.json` 的 `include`、`eslint.config.js` 的 `LINT_FILES` 与 `pnpm lint` 的目录清单里显式列出。
- **tRPC 链路配置在 `vanilla.ts` / `react.tsx` 里各搭一份**（`httpBatchStreamLink` + `transformer` + 端点各写一遍）：任一处改了 `SuperJSON` 或路径段，另一个客户端就静默连不上或解不开载荷，而现场只有一句「请求失败」。收口到 `src/trpc/link.ts` 的 `trpcHttpLink()` + `src/trpc/base-url.ts` 的 `getTrpcEndpoint()`，新增的「显式 origin」入口 `getTrpcEndpointFor()` 给进程外的消费者（工作台）用。

## Tests

- `tests/storybook-data-sources.test.ts`（进 `FIXED_STRUCTURAL_TESTS`）：守注册表接线（`about` / `names` / `load` 三件齐、名字不认识要抛错）、媒体名与磁盘**双向**对齐（`missing.png` 必须真的不在）、资源走 Storybook 的 `staticDirs` 而不是 `public/`（后者会随桌包出厂）、注入层真的挂在 `decorators` 上、点目录真的进了 tsc 与 eslint 的扫描面。

## Docs

- 规范 16 新增 §16.2.3.6；`docs/guide-storybook.md` 新增「数据从哪来：`Args → 数据源` 注入层」一节 + 真 tRPC 链路的边界说明；`PRODUCTION-GAPS` F6 同批更新。
