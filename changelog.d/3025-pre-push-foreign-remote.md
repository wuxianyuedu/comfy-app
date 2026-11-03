## Fixed

- **`pre-push` 在平台检出形态下拦死一切 push**（#3025）。平台侧检出是
  `git init` + 单条 ref 的 fetch + `git checkout -f FETCH_HEAD`，`refs/remotes/**`
  一条都没有；`readRevisions()` 要求一条 `<remote>/master` 形状的上游引用（那一档刻意
  不收本地 `master`，理由本身正确），于是取不到 ⇒ `unavailable` ⇒ 退 2 ⇒ push 被拦。
  现场是 `.cnb.yml` 的 endStage「GitHub 镜像同步」：目标仓库与令牌都通了
  （`[mirror] 推送前这一读：通`），红在钩子那一句
  「取不到上次fetch看到的上游引用」，与镜像逻辑无关。
- 修法：`pre-push` 那份（`scripts/premerge-proof.mjs`）新增 `isForeignRemotePush()` ——
  git 传给钩子的 `$2` 与本仓 `git remote get-url --all` 给出的 URL 逐个比对，对不上
  就按 `skip` 放行并念出目的地。钩子侧把 `"$1" "$2"` 传下去（`.githooks/pre-push`）。
- 边界刻意不对称：**取不到 remote 清单 / 拿不到 push URL ⇒ 判「不是外来」、照旧复算**。
  误判成外来等于跳过一次该跑的复算，比多跑一次坏得多；`unavailable` 在该有上游的
  地方仍然退 2（本仓远端 + 上游取不到那条用例钉着）。
