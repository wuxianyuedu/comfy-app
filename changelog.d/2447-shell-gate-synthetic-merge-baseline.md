## Fixed

- **平台 `重档静态判据` 里的 `shell-gate --base` 会把「目标分支自己落地的壳改动」算进本 PR**
  （ISSUE #2325 的现场，PR #2283）：平台检出的是「本 PR 并进目标分支（那一刻）」的 merge
  提交，而基线取的是 `CNB_PULL_REQUEST_TARGET_SHA` —— 两者错位时三点 diff 的 merge-base
  就是基线自己，于是与壳无关的 PR 被判成改了 `src-tauri/src/**`，要求 `cargo test`，
  而那台 runner 没有 cargo ⇒ 退 2。红与 PR 的代码无关。
  现在 `changed-scope.mjs` 的 `reconcileSyntheticMergeFace()` 在合成提交上按**父关系**对账：
  `CNB_COMMIT` 是 HEAD 的某一父 ⇒ 改动面取「第一父..HEAD」（这个 PR 真带进来的），
  并把剔掉的条数与其中的壳输入逐条念出来；对不上账（没有 `CNB_COMMIT` / HEAD 不是 merge
  提交 / 两段历史不相交）时**不做减法**，只把理由念出来。
- `shell-gate --base` 的基线与 `cwd` 现在同源：此前 `changedFilesForBaseRef()` 不传 `cwd`
  就在模块自己的检出里跑 git，而基线是那一跑给的 sha —— 两个仓库一凑就是「<sha> 不在本地
  对象库里」。
