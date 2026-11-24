## Added

- **新增 `tools/build/clean-target.ps1` 双击入口（ISSUE #4988）**：把「清 `src-tauri/target` 构建产物」做成 tools 工具——默认只清 `incremental/`，`-Release` / `-All`（= `cargo clean`）加大档位，`-DryRun` 只列清单；逻辑复用既有 `pnpm target:prune`（`scripts/build/target-prune.mjs`），并登记进规范 §9.5 跨平台动作对照表。
