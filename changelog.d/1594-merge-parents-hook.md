## Added

- **「合并提交必须双亲」成了提交门槛里的一个检查**（ISSUE #1594 / 规范 §13.6.1）。补的是上一次 squash 合并把 `master` 上几批修复整体回退的那个缺口：解冲突时 `git checkout`（含 `checkout -b`、`branch -f` + `checkout`）会**静默清掉** `.git/MERGE_HEAD` / `.git/MERGE_MSG`，此后 `git commit` 照常把合并结果落成**单亲提交** —— 树是对的、拓扑是错的，平台侧认不出「已合并」、PR 一直显示冲突，而本地钩子四组全绿，**没有任何一处会喊**。
  - 新增 `.githooks/prepare-commit-msg`（入口，把 `$1` 消息文件与 `$2` source 原样透传）→ `scripts/check-merge-parents.mjs`（判据本体）：**提交信息首行声明自己是合并**（`Merge branch` / `Merge remote-tracking` / `Merge tag` / `Merge commit` / `Merge pull request`）**时，本次提交必须真的有两个父**。父数取自 git 自己的事实（`1 + MERGE_HEAD 行数`）；`MERGE_HEAD` 不在而消息是合并信息 —— 那就是回退现场，**阻断**并给出重建合并的出口。
  - **为什么不在 `pre-commit`**：它**看不到本次的消息** —— 实测 `COMMIT_EDITMSG` 在那一刻仍停在**上一条**提交的信息上（git 先跑钩子、后落盘消息）。`prepare-commit-msg` 收到 `$2` 才能干净地把 `--amend` 排除在判据外（amend 一个合并提交时消息照样是 `Merge …`、`MERGE_HEAD` 也照样不在，但父提交从 `HEAD` 继承）——只看消息 + `MERGE_HEAD` 会把真正来修合并信息的人 100% 拦下。
  - 边界都取**保守放行**（与 `check-branch-guard.cjs` 同口径）：source 是 `commit`（`--amend` / `-c` / `-C` / cherry-pick / revert）、取不到消息、非 git 目录、合并字样只出现在正文（非首行）—— 一律放行。
  - 判据执行者的口径跟着长了一条：`scripts/check-gate-executors.cjs` 的 `EXECUTOR_SOURCES` 收进 `.githooks/prepare-commit-msg`（它是第二个本地钩子，漏登记 = 那条判据被判成「无执行者」，方向正好反了）。

## Tests

- `tests/check-merge-parents.test.ts`：真仓库跑拓扑 —— 普通提交放行、真合并提交（解冲突后 `commit`，双亲）放行、**声明是合并但单亲阻断并给出重建出口**、`--amend` 一个合并提交放行（误报防线）、正文提到 `Merge branch` 不算声明、消息文件取不到放行、非 git 目录放行，另加 `.githooks/prepare-commit-msg` 的 `$1` / `$2` 透传在位判据。变异核过：把阻断分支放宽成恒阻断 → 2 条红；把 `--amend` 豁免摘掉 → 误报防线那条红。
- 该文件进 `scripts/affected-tests.mjs` 的 `FIXED_STRUCTURAL_TESTS`：改 `.githooks/**` 会让增量层放弃收窄、只跑固定清单，而「把 `prepare-commit-msg` 摘掉 / 少传一个参数」那次改动恰好落在那一档上。

## Docs

- 规范 `docs/standards/13-提交与-code-review.md` §13.6.1 新增「第二个本地钩子：`prepare-commit-msg`」一节（判据、为什么不在 `pre-commit`、边界、规则自测与执行者口径），`docs/generated/**` 同步重渲染。
