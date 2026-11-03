## Changed

oxlint `typescript/prefer-optional-chain` 全仓清零（#2775）：77 处 / 40 份
（`scripts/**` 39 份 + `src/**` 4 份里的那一批）。

自动 fixer 收敛 64 处（`a && a.b` → `a?.b`、`arr && arr[0]` → `arr?.[0]`），
它不动的 13 处手补，全部是同一类：**尾项是右侧操作数**的形态
（`x && y.startsWith("…")`），改写后成 `x?.startsWith("…")`。

13 处里 12 处是短路守卫改写（`!reason || !reason.trim()` → `!reason?.trim()`），
语义等价：原先 `reason` 为假值时 `reason.trim()` 根本不会被求值，`?.` 只是把这一跳
显式写出来。**唯一一处属语义边界**：`scripts/premerge-proof.mjs` 的
`upstreamSha: (upstreamRef && run(["rev-parse","--verify","--quiet", upstreamRef])) || null`
——「没有上游引用」时它是 `null`、`upstreamRef` 为空串时它也是 `null`，两次「空」是
同一件事，所以保留 `|| null` 那半句、只把前半句收成 `upstreamRef?.includes("/")` 与
三分支的条件表达式；`tests/premerge-push-trigger.test.ts` 判的「取不到 ⇒ null」当场红过一次，
那是 `?? "HEAD"` 那个想当然的写法带来的（本地 `master` 被当上游，正是这行注释要挡的那件事）。

`src/**` 的 7 份按 oxfmt 收口，`scripts/**` 不在格式判据面（`check-format.cjs` 只判
`src/**` + `.storybook/**`），按 fixer 产物原样提交。

回归：`tsc --noEmit` 0 错、脚本档 230 份 0 处、受影响用例（a11y-rules / ci-build-readout /
premerge-timing / premerge-check / premerge-push-trigger / ship 四份 / layout-budget /
llm-server）50 + 453 条全绿。
