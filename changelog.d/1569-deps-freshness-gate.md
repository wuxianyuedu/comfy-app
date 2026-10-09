## Added

- **依赖新鲜度判据：远端改过库的版本，本地还在旧的上面干活**（`scripts/check-deps-freshness.mjs`
  - `tests/deps-freshness-gate.test.ts`，规范 §13.5.13）：远端 `master` 上别人升过依赖而本地
    检出还停在旧的那一套时，在旧依赖树上改代码、跑门禁的结论**看起来一切正常**，其实判据的
    版本已经不是远端那份了。这一格此前没有任何执行者 —— 知识写在 `docs/guides/sync-after-pull.md`，
    而「想起来去读它」没人守。
    判据三层各自独立：① 远端引用新鲜度（只决定 ② 可信不可信，**不判红**，陈旧时打 `[未校验]`
    且话术里不许出现「已最新」）；② **分叉点**（`git merge-base`）的依赖面 vs `origin/master`
    —— 基准取分叉点而不是 `origin/master`，否则「在 PR 分支上自己加依赖」这种正常流程会反向
    误报；③ 安装漂移，走 `lockfileDrift` 这一个出处。三个依赖文件（`package.json` /
    `pnpm-lock.yaml` / `pnpm-workspace.yaml`）逐个都判，lockfile 那一路走实质 diff
    （`diffLockfiles`）而不是字符串比。
    **判据自身不做网络请求**（`git fetch` 是人的动作）。接线：pre-commit D 组带 `--staged`
    （只在本次提交**动了依赖面**时判，否则退 0 零输出）、`pnpm check:deps-freshness` 是
    AI / 人开工前的主入口、`pnpm check:all` 全判；AGENTS.md 新增硬规则 25 与「开工前先跑」指引。

## Changed

- `quality-gate.mjs` 的依赖一致性预检收口到 `lockfileDrift`（`launcher-core/worktree.mjs`）
  —— 它此前自己拼了一遍 `diffLockfiles`，与启动器 / 新判据的「实质差异」边界各写各的。
