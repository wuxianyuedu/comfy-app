## Fixed

- **`pnpm format:check` 不再把 Rust 壳的构建产物列为「未格式化」**：仓库根新增 `.prettierignore`，忽略 `src-tauri/target/`。prettier **只按 cwd（仓库根）读 `.gitignore`**，而 `target` 的忽略写在按 cargo 约定生成的嵌套文件 `src-tauri/.gitignore` 里，它看不到 —— 于是本机 `cargo build` 过之后，`target/**/out/__global-api-script.js` 会出现在全库格式化清单里（`scripts/check-format.cjs` 那份由棘轮白名单挡住，这条补的是工具层：`pnpm format:check` 直接调 prettier，不经过白名单）。全仓库只有这一处嵌套忽略文件，其中会漏进 prettier 扫描范围的也只有 `/target/`。
- 说明：`pnpm format:check` 仍是**非门禁**命令，改后仍会报设计上豁免的存量路径（`docs/api/**`、根级 `*.config.*` / `*.js` 等）；本次只消掉构建产物这一类噪声。
