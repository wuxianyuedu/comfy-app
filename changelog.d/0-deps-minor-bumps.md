## Changed

- **小版本依赖升级（18 项，全部落在同大版本内）**：`react` / `react-dom` 19.2.8 → **19.3.0**
  （`@types/react` / `@types/react-dom` 同步到 19.3.0）、`@trpc/client` / `@trpc/react-query` /
  `@trpc/server` 11.18.0 → **11.19.0**、`zod` 4.4.3 → **4.6.5**、`@sentry/nextjs` 10.70.0 →
  **10.75.0**、`lucide-react` 1.33.0 → **1.47.0**、`@base-ui/react` 1.7.0 → **1.8.0**、
  `@xyflow/react` 12.11.3 → **12.11.6**、`better-auth` 1.7.1 → **1.7.5**、
  `@tanstack/react-query` 5.102.0 → **5.103.1**、`react-hook-form` 7.87.0 → **7.88.0**、
  `shadcn` 4.19.1 → **4.21.0**、`@tauri-apps/plugin-updater` 2.11.0 → **2.12.0**、
  `@playwright/test` 1.62.1 → **1.63.0**。改动面为 `package.json` 的声明下限与
  `pnpm-lock.yaml`，源码只动了下面两项。

- **`lucide-react` 1.47 去掉了图标类名里的历史别名**：`Undo2` / `Redo2` 渲染出的 `class`
  从 `lucide lucide-undo2 lucide-undo-2` 收敛为 `lucide lucide-undo-2`（`lucide-redo2` 同理）。
  这是上游清掉重复类名，`FilmStudio` 的组件快照随之更新。仓库里没有任何 CSS / 选择器
  依赖那个旧别名（`Undo2` / `Redo2` 只是 React 侧的 import 名，不受影响），故无行为变化。

- **`tests/lockfile-diff.test.ts` 里 `zod` 的锚点不再抄版本号**：该文件用「把真 lockfile
  改一处、看差异定位准不准」的方式验 `lock-diff.mjs`，锚点原先写死成
  `specifier: ^4.4.3 / version: 4.4.3` —— `zod` 一升版 `body.replace(...)` 就匹配不上，
  三个用例同时变红，而它们验的是**差异定位能力**、与「当前钉的是哪一版」无关。锚点改为
  从真 lockfile 里现取该依赖的条目原文（`importerEntry`），「版本变了」另给一个只替换
  `version` 一行的 `withEntryVersion`。同一处脆弱性在 `next` 的 specifier 上已经先被
  PR #789 修掉一次，本次把余下的 `zod` 一并收口。
