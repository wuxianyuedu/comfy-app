## Changed

- **`master` 不再接受直接提交，变更一律走分支 + PR（ISSUE #492）**：此前只有「禁止直接
  push」的口头约定，本地 `git commit` 到 `master` 不经过任何检查，绕过评审与 CI 的变更会
  静默进主干。现在三层强制：CNB 平台分支锁（拦 push）、`.githooks/pre-commit` 第 1 步
  `scripts/check-branch-guard.cjs`（拦本地提交）、CI `Branch guard` 步骤（拦源分支为
  `master` 的 PR）。**PR 合并提交不受影响**（判据是 HEAD 父提交数 > 1）。若已有提交落在
  本地 `master`：`git branch feat/<描述>` → `git reset --hard origin/master` →
  `git checkout feat/<描述>` → 推送开 PR，提交不会丢。
- **提交门槛不再需要手动启用**：新增 `pnpm install` postinstall 钩子
  （`scripts/install-git-hooks.sh`）自动把 `core.hooksPath` 指向 `.githooks`，新克隆的检出
  装完依赖即受门槛约束；已生效的检出不受影响（幂等）。
