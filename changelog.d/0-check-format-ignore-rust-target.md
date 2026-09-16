## Fixed

- **prettier 格式棘轮不再把 Rust 壳的构建产物判成「新增未过格式的文件」而阻断提交**：`scripts/check-format.cjs` 的白名单新增 `src-tauri/target/**`。此前只要本机 `cargo build` 过，`target/**/out/__global-api-script.js` 就会被扫描范围 `**/*.{ts,tsx,js,jsx,mdx}` 命中并让每一次提交都失败 —— 它由 `src-tauri/.gitignore` 忽略，而 prettier 只按仓库根读 `.gitignore`，看不到嵌套的忽略文件。CI 的干净检出没有 `target/`，所以只有开发机踩得到。产物也不该纳入棘轮：它由构建生成，格式化会被下一次构建覆盖。
