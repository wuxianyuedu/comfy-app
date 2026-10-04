## Changed

- 第二批依赖升级（ISSUE #1319）：`esbuild` `0.25.12 → 0.28.2`（直接 devDependency）、
  `prettier-plugin-tailwindcss` `^0.6.11 → ^0.8.1`。两个包都是 #1319 盘点时**特意从
  第一批排除**的特例（前者被 `overrides` 锁着、后者疑会改动格式化产物），本批单独复核。

## Security

- `pnpm-workspace.yaml` 的 esbuild `overrides` **复核后确认仍必需**，并把两份解析收成一份：
  `drizzle-kit`（当前 latest `0.31.11`）依赖的 `@esbuild-kit/esm-loader` /
  `@esbuild-kit/core-utils` 都已废弃（包里自带 `deprecated: Merged into tsx`），
  而 core-utils 把 esbuild 钉在 `~0.18.20` —— 正是 GHSA-67mh-4wv8-2f99 的受影响区间
  （serve 功能 CORS 缺陷，修复线 `>=0.25.0`）。**删掉这条 override 就会退回 0.18.20、
  漏洞复现**，且 drizzle-kit 上游 latest 也是同一形状，没有「升 drizzle-kit 就自然消掉」
  这条路。本次把 `@esbuild-kit/core-utils>esbuild` 顶到 `0.28.2`，并新增
  `drizzle-kit>esbuild: '0.28.2'` —— 后者自己声明 `^0.25.4`，range 不含 0.28，
  不顶就会与顶层那份**分裂成两个实例**。收敛后 `pnpm why esbuild` 只报
  **Found 1 version of esbuild**，「构建期转译行为」不再取决于调用方是谁。
  判据：`pnpm exec tsc --noEmit` / `pnpm run lint` / `pnpm test`（593 文件 7342 用例全过）/
  `pnpm build` 全链（`[executor-host-smoke] OK packaged host booted with the precompiled
  runtime graph`、`[standalone] ✓ 产物干净（共 2536 个文件）`）/ `check-dependency-audit.mjs` 全绿。

## Fixed

- 订正一条**盘点时的错误预判**：`prettier-plugin-tailwindcss` `0.6.14 → 0.8.1` 在本仓
  **不产生任何格式化产物变化**。实测两份 `prettier --write "**/*.{ts,tsx,js,jsx,mdx,css,json}"`
  的输出逐块比对（54 个共同命中文件），唯一不同的两处是本实验自己改的
  `package.json` / `pnpm-lock.yaml`（非格式化差异）；`scripts/check-format.cjs` 在升前升后
  都报「未过 prettier 0 个文件」（基线为空）。也就是说原计划里「它必须自成一个格式化批次、
  否则会把真改动埋在几百个文件的重排里」这个前提在这份代码上不成立 —— 依赖升版本与
  格式化产物是两件事，本批因此不需要格式化提交。`pnpm format:check` 那 45 个未过文件
  （docs / tests / e2e / tools / 根级配置）是**存量**，在 0.6.14 下同样存在、且全在
  `check-format.cjs` 的门禁白名单内，与本次升级无关。
