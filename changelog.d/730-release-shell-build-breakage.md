## Fixed

- **release 壳编不出来：`generate_context!` 报 `trailing comma, line: 8`（ISSUE #730）**。
  `tauri-build` 把插件全局 API 脚本清单写成**紧凑单行** JSON
  （`serde_json::to_string`，自身不可能带换行），文件落在
  `src-tauri/target/` 下的 `out/__global-api-script.js` —— 后缀是 `.js`，于是
  `pnpm format:write` / 编辑器保存会按 print-width 把它折成多行、并给最后一项补一个
  尾逗号，`generate_context!` 再读时直接 panic 整壳编译失败。六个插件 → 6 项 + 首尾
  两行 = 8 行，「line: 8」正是折行后的最后一项。**报错位置落在 `src-tauri/src/lib.rs`
  的 `generate_context!` 那一行，与真正被改坏的生成物毫无关系**，这是它长期定位不到的
  原因。仓库根 `.prettierignore` 已忽略 `src-tauri/target/`（prettier 只按 cwd 读
  `.gitignore`，看不到 `src-tauri/.gitignore` 里的 `/target/`），本次把这个忽略项配
  门禁钉住；回归测试见 `tests/check-file-structure.test.ts` 的 ISSUE #730 用例。
- **同一处还有两个 Rust 编译错误（ISSUE #730）**：
  ① `PROBE_ATTEMPTS`（`u32`）与 `PROBE_INTERVAL_MS`（`u64`）在首帧看护的超时日志里
  相乘，`u32 * u64` 无实现（E0277）；两常量改为同档 `u64`。
  ② `setup` 闭包要求 `'static`，而它按值引用了局部变量
  `expect_slow_first_paint` / `launch_mode`，借用检查直接报 E0373
  （`closure may outlive the current function`）；闭包改为 `move`。
