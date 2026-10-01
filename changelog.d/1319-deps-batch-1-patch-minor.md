## Changed

- **第一批依赖升级：25 个 patch / minor 级依赖更新到当前最新**（ISSUE #1319）。不含任何 major 版本，也刻意排除 `esbuild`（被 `pnpm-workspace.yaml` 的 override 锁着规避 GHSA-67mh-4wv8-2f99）与 `prettier-plugin-tailwindcss`（格式化产物会变，撞格式棘轮，需独立批次）。
  - patch 级 9 个：`next` / `@next/bundle-analyzer` / `eslint-config-next` `16.3.5→16.3.8`、`better-auth` `1.7.5→1.7.7`、`drizzle-orm` `0.45.2→0.45.3`、`drizzle-kit` `0.31.10→0.31.11`、`prettier` `3.9.8→3.9.9`、`jsdom` `30.1.0→30.1.1`、`@types/ws` `8.18.1→8.18.2`。
  - minor 级 16 个：`ws` `8.22.0`、`lucide-react` `1.49.0`、`@tanstack/react-query` `5.104.0`、`@xyflow/react` `12.12.0`、`react-hook-form` `7.89.0`、`react-resizable-panels` `4.14.1`、`@modelcontextprotocol/sdk` `1.31.0`、Tauri 三件套（`api` `2.12.1` / `plugin-process` `2.4.0` / `plugin-updater` `2.13.1` / `cli` `2.12.1`）、`cn` `0.4.0`、`typescript-eslint` `8.71.0`、`tailwindcss` 与 `@tailwindcss/postcss` `4.3.3`、`superjson` `2.2.6`。

## Fixed

- **`typescript-eslint` 升到 8.71.0 会让整仓 lint 直接崩**（`ConfigError: Cannot redefine plugin "@typescript-eslint"`）：`eslint-plugin-unused-imports` 把 `@typescript-eslint/eslint-plugin` 声明为**可选 peer**（范围 `^8.0.0-0`），pnpm 的 `autoInstallPeers` 为它独立解析出一个实例；升级前两者恰好都是 8.69.0（同实例、看不出问题），升级后 `typescript-eslint` 走到 8.71.0、可选 peer 停在 8.69.0 → 两个实例 → ESLint 10 在扁平配置合并时判「同名插件重定义」。
  - 修法 = `pnpm-workspace.yaml` 的 `overrides` 增加 `'@typescript-eslint/eslint-plugin': '8.71.0'`，让可选 peer 与 `typescript-eslint` 解析到同一实例。这不是「绕开」而是**消掉版本耦合**：此后无论谁先升，都不会再分裂出第二个实例。
  - 表现是**整仓 lint 完全跑不起来**（连 `drizzle.config.ts` 这种非 React 文件都过不去），不是几条告警 —— 所以它必须在同一个 PR 里修掉，不能等到 CI。
