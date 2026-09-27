## Added

- **CI 流水线（P0-1 雏形）**：新增 `.cnb.yml`，把本地 pre-commit 的核心门禁（eslint 零警告 / `tsc --noEmit` / `vitest run`）搬上 CNB 平台跑，解除「门禁只跑本地、`--no-verify` 可绕过」的风险。未含 `pnpm audit` 与棘轮 `--strict`（待平台 runner/registry 镜像配置稳定后再补，避免噪声阻断）；Rust 壳与 `next build` 不进本流水线，避免拉起 cargo 工具链。证据：`.cnb.yml`。
