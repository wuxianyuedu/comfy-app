## Changed

- **「本仓检出目录在哪」收口到单一实现 `scripts/git-dir.mjs`（ISSUE #2072）**：此前
  四处各自 `path.join(root, ".git", …)` 硬拼检出位置（`shell-gate`、`ci-workspace-probe`、
  `launcher-core/run`、`check-deps-freshness`），而链接工作树里 `.git` 是个**文件**，
  硬拼指向它——MERGE_HEAD / HEAD / FETCH_HEAD 永远查不到，且 `check-deps-freshness` 还持了
  一份同名不同契约（`resolveGitDir` 退回 `<root>/.git` 字面量）的副本。

  - `shell-gate` 的 `dropAdoptedShellInputs` 走 `resolveGitDir(repoRoot)` 再读 `MERGE_HEAD`；
    不在 git 检出里时原样返回（语义不变）。
  - `ci-workspace-probe` 的 `gitDir` / `fetchHead` 读数走 `resolveGitDir(cwd)`；`null` 时
    `dirFact` 走「absent」分支（认工作树真身）。
  - `launcher-core/run` 的 `readGitHead` 走 `resolveGitDir(root)`，不再 `path.join(root, ".git", …)`；
    读不到分支时 `startRun` 的 `meta.branch` 报 `"(unknown)"`。
  - `check-deps-freshness` 删掉第二份 `resolveGitDir`，统一 import 自 `git-dir.mjs`；两处调用方
    守卫 `gitDir` 为 `null` 的情形（行为不变：不在 git 检出里 ⇒ 引用不可知 / 无合并进行中）。

- 新增机械判据 `scripts/git-dir-literal-scan.mjs`：扫 `scripts/**` 里引号包住的 `.git` 路径拼接，
  白名单只放 `git-dir.mjs` 自己；`tests/git-dir-literal-scan.test.ts` 跑它，并登记进
  `scripts/fixed-structural-tests.mjs`（每次提交固定执行，import 图带不动这条）。

- 文档：`.qoder/skills/ship/SKILL.md` 把「回读 `origin/master` 顶端」改成「回读解析出的主干基线顶端」。
