## Fixed

- **`pnpm ship` 把 push 的远端 128（`Repository Not Found`）固定归因为「premerge 没放行」，
  误导现场**（ISSUE #2825）。现场（2026-10-31）：pre-commit 全过 → push 立即被远端
  `Repository Not Found. 仓库不存在。` 拒（exit 128），pre-push 复算的日志一个字不存在，
  而旧话术仍说「多半是 pre-push 的合并前复算没放行」—— 照它去查门禁会白查一轮，
  真因（git 凭据失效）在被顶掉的输出里。现在 push 失败按**原话分型**
  （`ship-core.mjs` 的 `classifyPushFailure`，两处 push 失败出口共用）：
  stderr 带 `remote:` / `Repository Not Found` / `仓库不存在` / `Authentication failed` /
  `could not read Username` ⇒ 指向凭据与远端可达性；`[pre-push]` 复算原话在场 ⇒ 指向
  premerge；两类特征都没有 ⇒ 不编因（unknown，看原话）。两类特征同时在场上判
  `remote`（钩子放行后传输被拒，终止原因是远端那一跳）。
