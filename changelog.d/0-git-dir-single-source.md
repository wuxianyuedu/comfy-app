## Added

- **`scripts/git-dir.mjs` —— 「本检出的 `.git` 到底在哪」的唯一实现**，与落在它里面的
  机器本地文件的统一落点（`gitScratchPath(root, name)`）。
  这件事此前有**三份**各自实现加**五处**硬拼：
  `precommit-timing.mjs` 里一份正确的（走 `git rev-parse --absolute-git-dir`）、
  `check-deps-freshness.mjs` 里一份**语义不同**的、`premerge-proof.mjs` 里一段内联的
  （走 `--git-dir` 再 `path.resolve`），外加 `check-reformat-only.cjs` /
  `launcher-core/run.mjs`（两处）/ `ci-workspace-probe.mjs` 直接
  `path.join(root, ".git", …)`。
  两份**同名不同契约**的 `resolveGitDir` 是最贵的那种形状：读代码的人按名字以为
  它们可互换，而一个读不出回 `null`、另一个回**猜出来的** `<root>/.git`。
  本模块采纳 `null` 那一侧 —— 猜出来的路径会让「不知道」在下游被读成
  「知道，答案是 `.git`」。

## Fixed

- **`pnpm ship` 不再依赖 `.workbuddy/` 这个工具目录存在，也不再往工作区写临时文件**。
  动机不是「换个目录名」，而是问了一句「那这个目录会不会消失」之后发现：
  **少建一个文件比建了再删强** —— 少一处会忘、少一处依赖某个工具目录、
  也少一处「提交信息原文躺在盘上」。
  两处各自的修法不同，因为代价不同：
  - **提交信息走 argv 直传**（`git commit --message=<原文>`）。`spawnSync` 不经 shell，
    多行与引号都是字面量，所以 `-F <文件>` 那一套「写个临时文件、提交完还得删」
    整个泄漏面被消掉而不是被搬走。AGENTS 硬规则 12 把 `COMMIT_EDITMSG` 落进工作区
    点名为「提交完忘了删」的信号 —— 上一刀只是把它挪进 gitignored 目录，
    这一刀是让它不发生。
  - **PR 正文仍走文件**（上千行会撞 Windows 32k argv 上限，`--body-file` 才是它的路），
    但落点收进 `.git/comfy-ship-tmp/`，与本仓既有两户
    （`comfy-premerge-proof.json` / `comfy-precommit-timing.jsonl`）同一位置、同一理由。
    取不到 git 目录时**跳过并退 2**，不往工作区猜一个落点。
- **`ship` 读合并前证明那处，撤掉手搓的指针文件解析**。它自己判「`.git` 是文件就当
  `gitdir:` 指针读」，只覆盖 worktree 那一种，`GIT_DIR` 与裸仓库一个都不认 ——
  手写一份弱化的同一件事，比不写更难被发现。换成 `resolveGitDir`。
- **`precommit-timing.mjs` 里那份实现搬进新模块，原处不留转口**（按
  `tests/hook-affected-launch.test.ts` 头注那条既有口径：机制层拆出去之后
  **不再转一层假出口**，否则下一次有人 import 那层空的）。顺带它唯一的
  `spawnSync` 用处随函数一起搬走，那条 import 已成死引用，摘掉。

## 顺带测出来的一条性质（不是这次引入的）

`resolveGitDir()` 回的是 **git 自己的正斜杠形式**（`C:/Users/…/repo/.git`），
而 Windows 上 `path.join` 给反斜杠。拿去拼落点没问题（Win32 两种都收），
但**别拿它做字符串比较** —— 两种拼法永不相等，于是反向断言（`not.toContain`）
在这种比较下**恒真**，落错了地方也测不出来。这条差异在本模块搬过来之前就存在于
`precommit-timing` 那份实现里，只是没人把它测出来过：写 `tests/git-dir.test.ts` 时
第一条就是因为它红的。已写进模块文档，并留了一个 `norm()` 给比较用。

## 刻意没做的事（写清楚，别当成已完成）

- **`check-deps-freshness.mjs` 那份 `resolveGitDir` 没并过来。** 它读不出时
  退回 `<root>/.git` 并把可用性交给调用方判 —— 那是**另一种契约**，不是重复。
  并过来等于把一条门禁判据的「不知道」改成「猜一个路径」，而它是提交门槛里的常驻档，
  改法要按门禁存量重新看一遍。另案。
- **五处硬拼的 `.git/<某个引用文件>` 没动**（`check-reformat-only.cjs` 读 `MERGE_HEAD`、
  `launcher-core/run.mjs` 读 `HEAD` 与 ref、`ci-workspace-probe.mjs`、
  `shell-gate.mjs` 注释里那一处）。它们读的是**引用文件**、语义与「机器本地状态」不同，
  其中 `launcher-core/run.mjs` 在启动链上 —— 换解析方式要单独验启动。另案。
- **没给 `ship` 加「git 目录取不到就退回工作区」那一档。** 看着更可用，
  但那是把这次修掉的形状又装回去。

## 验证

- `tests/git-dir.test.ts`（新增 8 条）：**真建一个 repo 与一个 worktree** 来测，
  不造假形状 —— 造一个「`.git` 是文件、内容写着 `gitdir:`」的假目录，测的是我自己猜的
  那份格式，git 换格式时它会继续绿。含一条前置自证：那个 worktree 的 `.git` 确实是文件
  （若 git 哪天改回目录，本模块的必要性要重判，而不是让判据静默空转）。
- `tests/ship.test.ts`：提交信息那条从「建了又删干净」改成**「一个文件都不建」**
  （更强的承诺，且不需要前置断言证明文件确实建过才不是空转）；
  PR 正文那条补回「finally 回收」的覆盖，选的路径仍是会中途返回的那条。
- 四份判据合计 **94 passed**：`git-dir` / `ship` / **`precommit-timing`** /
  **`premerge-push-trigger`** —— 后两份是被迁移那两户自己的测试，
  这次统一有没有改坏东西由它们判，不由本碎片宣称。
- `tsc` 0 错、`eslint` 0 警、注释语言 / 文件长度 / 文件结构 / 跨文件重复 /
  零消费导出 / 判据执行者台账 全 OK。
- ⚠️ 记一笔余量：`scripts/ship.mjs` 现在 **865 行**，硬闸在 900。
  再加一个阶段就会撞 —— 下次扩它之前先按 `check-infra-file-size` 给的出口拆，
  别砍注释凑数。
