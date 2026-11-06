## Fixed

- 本地 D0 的 `scripts/check-format.cjs --staged` 此前只从 `git diff --cached --name-only` 取**路径**，再把路径交给 `oxfmt --check <targets…>`；oxfmt 按路径读的是**工作区文件**，全链没有任何一处读 index blob。于是判据自称判「暂存的那一批」，真判的却是「这批路径此刻在工作区的样子」：暂存脏内容后把工作区改干净却不重新 `git add`（`AM`）⇒ 判据念「命中 0 个（暂存面）」并放行，而提交进历史的是 index 里那份没过 oxfmt 的 blob；反向（index 干净、工作区又改脏）会假红。平台 `--changed` 判 `<基线>...HEAD`、CI 工作区就是已提交树，会拦住合并，所以实际代价是本地一次假绿 / 假红加一次 CI 往返，不是主干污染（ISSUE #3259）。
- 现在在 `--staged` 算出 `hits` 之后、`judge()` 之前加一道一致性守卫：一次 `git diff --name-only` 求「index ⇄ 工作区仍有差异」的路径与 `hits` 的交集；两者一致时「判工作区」等价于「判 index blob」，判绿才真的推出提交字节干净。不一致就按 §13.6.3 不给结论（`exit 2` + 点名 + 提示重新 `git add` 或先 `git stash`），既不判绿也不判红；git 读数拿不到同样 `exit 2`，不冒充「这一批都干净」。

## Changed

- 守卫只收 `hits` 内的路径：`git diff` 不列未跟踪文件，交集又只取本次暂存面 ⇒ 面外没暂存的改动（含**已跟踪**文件改脏）不进这一格，「只判暂存的那一批」（#1747 / #2979）与合并态收窄（#2747）都不受影响。平台 `--changed` 档、钩子接线、`GLOBS` / `IGNORE_GLOBS`、oxfmt 调用形态一律不动，不引临时目录。
- 增量成本实测（本机 Windows 热态，3 次）：`git diff --name-only` 0.54–0.81s，本地 D0 约 1.2s → 1.8s。判据本身 1 份与 200 份几乎同价（1.05–1.28s / 1.14–1.33s），成本是两次进程启动的固定开销 —— 这一格此前不保证提交内容，从来不是性能取舍。
- `tests/check-format.test.ts` 新增 5 条回归用例：`AM` 与反向不一致都 `exit 2` 且不给绿 / 红、一致且干净照旧判绿、一致但脏照旧 `exit 1` 点名、面外已跟踪脏文件仍判绿。⚠️ 该 suite 在 win32 走 `SANDBOX_POSIX_ONLY` 整块 skip（PR #2990 的既有边界），本机 `40 skipped` 按三态是「没给结论」不是通过；平台 Linux 会跑到新增用例。
- 本机可执行判面：独立临时 git 仓 + 真 `check-format.cjs --staged` + 真 oxfmt 实跑同样五形状，读数 `0 / 1 / 2 / 2 / 0` 全部相符。**反向验证**：把守卫注入成恒空（等价旧实现）⇒ `AM` 退回 `exit 0`（正是 #3259 原始漏判）、反向退回 `exit 1`（假红），2/5 形状不符；恢复后 5/5。
- 判决面：两份改动文件 `oxfmt --check` 通过；全库 `pnpm run lint` 384 条规则 / 2475 文件 `0 warnings 0 errors`；`pnpm run check:premerge` 43 条判据红 0（含 41 条清零 oxlint 规则探针）、`current-green`；`check-infra-file-size` 375 份 0 超标（`check-format.cjs` 703 行）；`tests/strip-comments-single-source.test.ts` 7 passed；相关固定清单 206 passed；`pnpm check:deps-freshness` OK。
