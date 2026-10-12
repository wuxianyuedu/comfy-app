## Fixed

- **`pre-push` 的合并前复算不再假定远端叫 `origin`**（规范 §13.6.2.1）：`scripts/premerge-proof.mjs`
  把上游引用写死成 `refs/remotes/origin/master`，而本仓的远端实测叫 `cnb`（`git remote -v` 里没有
  `origin`）—— 于是 `upstreamSha` 恒为 `null`，判据走「取不到上游引用」那一支**退 2**，
  结果是 **#1793 刚立的执行者反过来挡住了本检出每一次 topic 分支的 push**（`git fetch` 跑过也一样）。
  现在复用 `base-check.mjs` 的 `resolveMergeBaseRef()`（远端名随克隆方式变，那份注释早就记过这件事），
  但**只收它 `<remote>/master` 那一档**：它的第三档「本地 `master`」对 `--base` 是对的（浅检出 /
  单机仓库），对这一跳不对 —— 这里要的是**会被 `git fetch` 移动**的引用，本地 `master` 不会动，
  远端前移而本地没动时拿它当上游等于给一份陈旧证明发免检条。
  同一处也**不走 `@{u}`**：推送之后 `@{u}` 就是你自己的分支，拿它当上游是「自己跟自己比」。
  回归用例见 `tests/premerge-push-trigger.test.ts` 新增的三档（远端叫 `cnb` / `@{u}` 指向自己 / 只有本地 master）。
