## Fixed

**回读格不再为「等不到的 run」空转满 45 分钟**（ISSUE #3148；用户现场见 #3142）：

- `scripts/ci-github-verdict-read.mjs` —— `POLL_BUDGET_MS`（45m）现在是**上限而不是
  每次都该花完的量**，两种「等下去没有意义」的形态各有自己的提前收工判据：
  - **上游派发没发生**：`readDispatchState()` 读镜像格留在工作区的
    `.comfy-ci/mirror-dispatch.json`，读到 `dispatched: false` ⇒ **一秒不轮询**、
    exit 2，并把上游那句原因（推送 / LFS / 派发哪一跳败的）原样念出来，同时点明
    「不是认领锚点的问题，去修上游那一跳」。这是 #3138 现场的直接成因：
    LFS 那一跳失败 ⇒ 刻意不派发 ⇒ 本跑永远不会有 run，而回读格照样把预算花完。
  - **认领锚点恒假**：主路径读到非空触发表、却一条 `display_title` 都不含目标 sha 时
    累计连击（`CLAIM_MISS_STREAK_TO_ABORT` = 4 轮），到门槛提前 exit 2；
    每轮用 `renderTitleSamples()` 把触发表的标题样本念出来（截断 80 字、最多 5 条），
    于是 #3142 正文那两条候选（标题里没 sha / 是别的 sha）当场可分。
  - 零条 run 那一形（GitHub 侧压根还没起跑）**照旧吃满预算** —— 它可能随时起跑（#3136）。
  - 新增 `isUnclaimedNonEmpty()` 把「读到过非空触发表但认不上」（提前夭折）与
    「零条 run」（真·等待）在读数层分开；日志与正文都按这一分岔走。
- `scripts/ci-github-mirror-push.mjs` —— 新增 `writeDispatchState()` / `DISPATCH_STATE_*`：
  每个终局都往 `.comfy-ci/mirror-dispatch.json` 落一行 `{dispatched, reason}`（派发成功、
  前提没配齐、探活失败、推送失败、LFS 失败、派发请求网络层失败、派发被拒，共七个分支）。
  落盘是**增益不是判据**：写失败只影响回读格能不能提前收工，不改本格三态。
- `.cnb.yml` 未改脚本命令，只补两处注释（`.comfy-ci/` 已在 `.gitignore` 里，且两格共用一个工作区）。
- 判据强度不变：三态语义（0 绿 / 1 红 / 2 没结论）一字未改，`--readout` 仍只折对外那一位，
  「认不上」与「派发没发生」都不许被念成权限问题或红。
- 用例：`tests/ci-github-verdict-read.test.ts` 增 6 条（标题样本渲染、`isUnclaimedNonEmpty`
  的两形、`readDispatchState` 的容错、上游没派发一秒不轮询、上游派发成功照常轮询），
  并把「别跑的 run」那条老用例从「吃满预算」改成「门槛轮收工」；`tests/ci-github-mirror-push.test.ts`
  增 1 条（三个失败分支都留 `dispatched: false`）。
