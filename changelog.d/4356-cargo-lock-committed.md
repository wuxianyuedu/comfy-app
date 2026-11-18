## Fixed

- **`src-tauri/Cargo.lock` 入库**（#4356，台账 C4）：`.gitignore` 摘掉对它的忽略行。
  shell-gate 的 `cargo test --locked`（#4317，与 `pnpm install --frozen-lockfile`
  同一纪律）在全新 clone 上因锁不在仓库而必红（PR #4352 的 GA 跑现场：退出码 101、
  「cannot create the lock file … because --locked was passed」）；锁入库后 fresh
  clone 的 `--locked` 才有判据可依，Rust 二进制依赖树恢复可复现。
