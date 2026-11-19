## Added

- 新增 `pnpm target:prune`（`scripts/build/target-prune.mjs`）：给 `src-tauri/target` 的 Rust 构建产物一个有名字的清理入口（#4489）。默认只清各 profile 的 `incremental/` 增量编译缓存；`--release` 连 release 产物整棵清；`--all` 整棵 target（= `cargo clean`）；`--dry-run` 只念清单。背景：开发盘被吃到剩余 0.48GB 时 `cargo test` 直接死在 `磁盘空间不足 (os error 112)`，看着像判据红其实是机器没空间——症状与出口已登记进 launch-and-build §5 排障手册。量盘/格式化小件按 §12.18 收进 `scripts/lib/dir-size.mjs`（与 `deps:prune` 共用），安全栏：删除目标必须落在 `src-tauri/target` 之内（越界即红）。
