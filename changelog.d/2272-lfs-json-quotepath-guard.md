## Fixed

**镜像推送后的 LFS 清单读取漏了 `core.quotePath=false` 守卫**（ISSUE #2272；回归自 #3252 / PR #3315）：

- 现场：GA daily 的单元测试格 `tests/git-path-quoting.test.ts` 红，唯一命中 `scripts/ci-mirror-push-verify.mjs`
  的 `verifyLfsObjects()` —— `git lfs ls-files --json` 没带守卫。`core.quotePath=true`（git 默认）时
  回话里的 `name` 被 C 风格转义加引号，与本地真实路径对不上；同批 PR 给 `ci-mirror-lfs-push.mjs` 的
  `--long` 补了守卫，漏了这份新文件的 `--json`。
- 修法：在该调用同一数组补 `-c core.quotePath=false`（与 `--long` 同口径），不放宽断言、不登记豁免。
  该函数有两个真实调用方（`ci-github-mirror-push.mjs` 与 `ci-github-mirror-master.mjs`），不是死代码。
- 读数：该测试文件 5/5 绿（修前 1 failed / 4 passed）；`tsc --noEmit` 0；oxlint 已清零规则集 41 条
  全仓 0 命中；`pnpm check:premerge` 45 格全绿。
