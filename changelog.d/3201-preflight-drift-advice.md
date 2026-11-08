## Fixed

- `pnpm ship` 阶段 0 的依赖新鲜度 `drift` 话术从一句固定「先 `git pull` +
  `pnpm install`」改为按判据 `--json` 原值分形态给下一动作（#3201）：② 基线漂移
  → 保留 `git pull`；③ 安装漂移（切换分支 / 换基线的现场）→ 与拉远端无关，
  出口是 `pnpm deps:guard && pnpm install`（补上硬规则 9 的前置）并点名
  `docs/guides/sync-after-pull.md`。判据不改、只读 `--json` 原值（红线③），
  退出码不动（drift 仍是「有事实是红的」）。
