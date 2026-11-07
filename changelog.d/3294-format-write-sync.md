## Fixed

- `format:write` 与格式判据的判面同步：原来是
  `oxfmt "src/**/*.{ts,tsx,js,jsx,mdx}" ".storybook/**/*.{ts,tsx,js,jsx,mdx}"`，
  写不到 `--changed` / `--staged` 一直在判的 `scripts`、`tools`、`e2e`、`tests`，
  也不含 `mjs` / `cjs`（而 `scripts/**` 的入口与判据正是这两个扩展名）。
  现在改为与 `GLOBS` **逐字同一条**：`oxfmt "**/*.{ts,tsx,js,jsx,mjs,cjs,mdx}"` ——
  判据红了，照提示跑 `pnpm format:write` 就能修好，不必再手工点名 `oxfmt <文件>`。

## Changed

- `format:write` 的匹配面实测 2482 份（全量档 2107 + `tests` 368 + 根级 7）；
  `.oxfmtrc.json` 的 `ignorePatterns`（`src-tauri/target/`）照旧生效，`node_modules` 不被匹配。
