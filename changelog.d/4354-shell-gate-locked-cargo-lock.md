## Fixed

- **shell-gate 的 `cargo test --locked` 在平台全新 clone 上必红（#4354，P1）**：
  `src-tauri/Cargo.lock` 被 gitignore、不入库，而 #4317 给壳闸的 cargo test 加了
  `--locked`（防静默换依赖版本）——平台上没有锁文件可依，`--locked` 与「要新建
  锁文件」直接冲突，退出 101，任何触碰 `src-tauri/**` 的 PR 在 GA 侧都被拦
  （PR #4353 的现场读数）。修复：锁文件入库（应用类 crate 的标准做法，
  也让 `--locked` 真正可执行），`.gitignore` 移除该条。
