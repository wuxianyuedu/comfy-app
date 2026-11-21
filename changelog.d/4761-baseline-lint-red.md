## Fixed

- 收掉 master 基线上的 11 处 eslint 违例（#4761，随 PR #4747 带入）：`tests/dev-shell-update.test.ts` 的三处 fetch 替身（`no-unsafe-type-assertion` + `require-await`）改用 Response 真身替身，`scripts/launcher-core/dev-shell-update.mjs` 的一处 JSDoc 断言改普通类型收窄；此前任何分支的 push 都会被 pre-push 复算拦下。行为不变，dev-shell-update 13 例全绿。
