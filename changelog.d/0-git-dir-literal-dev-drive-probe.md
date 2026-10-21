## Fixed

- **主干上有一条硬闸违规，拦住的是从它分出的每一个提交**：`scripts/dev-drive-probe.mjs` 的
  `probeWorkdirs()` 硬拼检出子目录字面量，被 `scripts/git-dir-literal-scan.mjs`
  （ISSUE #2072 那条「落点只有 `scripts/git-dir.mjs` 一处知道」的判据）判红 ——
  硬闸类须为 0、没有「带病通行」的中间态，所以它一落地，后面每个 PR 的
  `受影响用例` 那一格都会红一次（复算：`node scripts/git-dir-literal-scan.mjs` 在
  本修复之前的 `cnb/master` 上退 1 并点名那一行）。引入它的是
  `7ddadf69`（开发盘红利那一格），不是本批写出来的：本批撞它的那次跑，改的是
  `custom-nodes` 与文档面，一个 `scripts/**` 字节都没动。
- **为什么这一处不只是「形不对」**：链接工作树里 `<root>/.git` 是一个**指向别处的文件**、
  不是目录。硬拼之后 `exists / realPath / sameVolume` 三格全落在错的一侧 ——
  而这个探测的全部价值就是那三格（它答的是「哪一坨数据在别的卷上」，正是那条线要量的东西）。
  现在改吃 `resolveGitDir(ROOT)`：worktree 指针、`GIT_DIR`、裸仓库三种形态由 git 自己解，
  而**读不出就不报这一条**（猜一个路径会把「不知道」在下游读成「知道，而且答案就是那个」）。
- 行为面自证：普通检出里四个条目（`node_modules` / `.next` / `src-tauri\target` / `.git`）
  的名字与读数**逐字照旧**（复算：`node scripts/dev-drive-tune.mjs --json` 的 `workdirs`），
  判据那侧 `tests/git-dir-literal-scan.test.ts` 从红转绿，`dev-drive` 一族用例 50 条全绿。
  改动只有 17 增 4 删 —— 那份文件在主干上本来就不是 prettier 干净的，
  **没有**顺手 `--write`（那会把别人那一格的整文件重排埋进这次修复，见 `格式化提交分离`）。
