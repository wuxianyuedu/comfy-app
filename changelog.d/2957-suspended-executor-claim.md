## Fixed

- **停用台账把三条用例的执行者写成「本地钩子组 C」，而组 C 在钩子里就不执行了**
  （ISSUE #2957；停用本身是 ISSUE #2948 的业主口径，本单不反对停，反对的是"停了却被写成有人跑"）。

  当场读数（三处复述 + 一件机器事实）：

  ```
  $ grep -n 'localExecutor' scripts/suspended-gate-tests.mjs
  52:    localExecutor: "本地钩子组 C（`affected-tests.mjs` 的固定清单，不经本台账过滤）",
  61:    localExecutor: "本地钩子组 C；绕过门槛时人自己跑 `node scripts/base-check.mjs`（判据本体仍在）",
  70:    localExecutor: "本地钩子组 C；产物层另有 `pnpm build` 收尾那一次真跑判据",

  $ grep -n "组 C 在这里" .githooks/pre-commit
  966:  # 组 C 在这里**永远不会跑到**（2026-10-20 起它的本地执行者撤了，`run_group C` 那行只当登记，

  $ sed -n '162,166p' .githooks/pre-commit        # run_group() 里的机器事实本体
    if [ "$id" = "C" ]; then
      echo "skipped" >"$LOGD/$id.skip"
      echo "ci" >"$LOGD/$id.moved"
      return 0
    fi
  ```

  加上 `suspendedReading()` 打进 CI 日志的那一句「本地钩子照跑」与
  `scripts/full-suite-run.mjs` 的同款注释 —— **四处**都在说同一件不存在的事。
  后果不是文字不准：固定清单的本地执行者一直是组 C，而平台这档又把它剔了，
  所以「这三条用例文件此刻还有兜底」是被那句自述**造出来的**。
  而判据 `tests/suspended-gate-tests.test.ts` 原先只核 `localExecutor.length > 10` ——
  **长度不是真伪**，任何一句通顺的假话都过。

  改四件事（判据本体、清单、业主口径都不动）：

  - `localExecutor: string` → **`executorsNow: ReadonlyArray<string>`**（三条都是 `[]`）
    与 **`guardNote: string`** 两格分开：前者答「停用期间还剩谁在跑**这条用例文件**」，
    后者答「判据**本体**此刻仍在哪儿跑」（eslint 在推送那一跳与平台档、
    `base-check.mjs` 人随时可跑、`check-bundle-budget.cjs` 在 `pnpm build` 收尾与
    `pnpm check:bundle`）。原先两条混在一句里，正是"看着有人跑"的来源。
    **允许写空** —— 空就是空，不许用一句通顺的话顶替。
  - CI 读数那一行照实念：`自动执行者：**无**（本地组 C 已撤、平台两格与每日全量都剔）⇒ 只剩人工`，
    并删掉「本地钩子照跑」；名字仍在清单里那句保留（停用 ≠ 删除 这条没变）。
  - 判据新增一格**对账**：先从 `.githooks/pre-commit` 里**读出**「组 C 写 `.skip` 后 `return 0`」
    这件事实（读不到就红，并写清"要么执行者回来了就去核对 `executorsNow`、要么我的量具形状变了"），
    再禁止任何一条把「组 C / 本地钩子」写成执行者。没有新写一份"谁在执行"的全局扫描器
    （#2660 期望 3 那条边界在这里同样有效）——只把台账这一句与钩子那一处对上。
  - `scripts/full-suite-run.mjs` 那段注释订正成同一份事实，并指回 `executorsNow` 与这条判据。

  **变异证明**（把台账那一条改回原来的话）：

  ```
  AssertionError: tests/base-check.test.ts：组 C 的本地执行者已被钩子撤掉，executorsNow 里却把它
    当成还在跑它 —— 这一句会把「停用期间零自动执行者」读成「还有一层兜底」（ISSUE #2957 的现场）:
    expected '本地钩子组 C' not to match /组 ?C|本地钩子/
  AssertionError: expected '[suspended] 本格按台账暂不执行 1 条固定清单用例（名字仍在固…'
    to contain '自动执行者：**无**'
  Tests  2 failed | 8 passed (10)
  ```

  一次注入**两格各自红**（禁令 + 读数），说明这两格判的是不同的东西：一个盯字段，一个盯日志。
  还原用字节快照，`sha1sum` 与快照逐字相同（`0dce7bae…`）。

  **顺手记一次量具自纠**：那条钩子正则我第一版写成 `return 0;`（带分号），
  而钩子里是 `return 0`（不带）⇒ 这一格当场红，红话正是"取不到机器事实"。
  这条设计第一次跑就抓住了写它的人自己的印象错误 —— 记下来是因为它证明
  "取不到事实必须红"比"取不到就放行"有用。

  执行面：`tests/suspended-gate-tests.test.ts` 10 条绿、`tsc --noEmit` 退 0、三份改动文件
  `eslint` 退 0；台账的消费方（`daily-tracks` / `doc-check-hook-wiring` /
  `hook-affected-launch` / `no-platform-ci-config`）382 条绿。
  ⚠️ 其中 `hook-affected-launch` 的 `--full --dry-run` 那一格在五份文件并发时报
  `Test timed out in 30000ms`，隔离复跑 `--no-file-parallelism` **119 条全绿（15.27s）**
  ⇒ 按 §13.6.4.1 是负载形状，**没有**为它抬 `testTimeout`（同一格在批 1 也留过同形读数）。

  **本单没做的一件事**（留给 owner，已写在单里）：给这三条配一个**不占 45m 墙钟**的执行面
  （例如每日那条低频档里单独跑一轮）——那是"停用期间是否该有兜底"的另一案，
  与"把话说实话"是两件事，不该混在同一个 PR 里决定。
