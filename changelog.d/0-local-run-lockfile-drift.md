## Fixed

- **双击启动入口每次都跑一遍全量 `pnpm install`（`scripts/prepare-local-run.ps1`）**：
  依赖是否陈旧的判据此前是「仓库根 `pnpm-lock.yaml` 与 `node_modules\.pnpm\lock.yaml`
  的 SHA256 是否相同」，而 pnpm 写进 `node_modules` 的那份与仓库根那份**本就不同形**
  （注释 / 空行 / 条目顺序都不一样），哈希恒定不等 → `$drifted` 恒为真 →
  非开发人员每次双击 `tools/start/run-local.ps1` 都要等一次完整安装。
  判据改成调用全仓唯一的实质差异实现 `scripts/lockfile/diff-cli.mjs`（与启动器
  `launcher-core/worktree.mjs` 同源），按退出码判定：0 一致、1 有实质差异、
  2 判不了则保守按已漂移处理。差异明细复用判定那一次调用的输出，不再重复起进程。
