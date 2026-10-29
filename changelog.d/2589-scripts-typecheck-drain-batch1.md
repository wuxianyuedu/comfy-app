## Fixed

- **脚本档清账第一跑：8 份脚本 12 格清零，账从 306 处 / 29 份降到 294 处 / 21 份
  （ISSUE #2589 / 规范 §13.5.14.1）**：给这些函数的 JSDoc 补上形参类型 ——
  `scripts/check-merge-parents.mjs` 的 `git(args)` / `readMergeClaim(messageFile)`、
  `scripts/dev.mjs` 的 `parseArgs(argv)`、`scripts/env-init.mjs` 的 `fill(content)` /
  `hasRequiredValues(content)`、`scripts/generate-docs.mjs` 的 `runPnpm(script)`、
  `scripts/install-git-hooks.mjs` 的 `git(args)` / `say(message)`、
  `scripts/lockfile/diff-cli.mjs` 的 `parseArgs(argv)`、
  `scripts/merged-side-loss-core.mjs` 的 `isGenerated(file)`（`TS7006` 十格）。
  另两格是 `scripts/dev.mjs` / `scripts/start.mjs` 的 `result.error.code`（`TS2339`）：
  `spawnSync` 把 `error` 声明成 `Error`，而系统级失败带的是 `ErrnoException`，
  那句「为什么起不来」的全部内容就在 `.code` 上 —— 用仓里既有那个 cast 形状
  （`scripts/ci-cp936-exit.mjs:481` 那一形）把它收成一句 `spawnError`，**运行期一字未变**。

  **这一跑量到一条会反复遇到的类型层因果**（写进规范 §13.5.14.1）：给形参补 `{string[]}`
  之后，`noUncheckedIndexedAccess` 把「按下标取到的那一格是 `string | undefined`」这笔账
  **当场现形** —— `dev.mjs` 补一个 `@param` 就多读出四格 `TS18048`（中途读数 306 → 298 → 294）。
  所以「补类型」不是纯减法：**改一份就重跑一次那条判据看总数往哪边走**，涨了不是白改，
  是那几格一直在那儿、只是从前不在面上。这一格由判据自己的「按 `(文件, TS 码)` 只降不升」
  当场拦住，不需要人记得。

  账本 `scripts/.scripts-typecheck-baseline.json` 同批由
  `pnpm check:scripts-types -- --update` 重写（拒涨那一支照旧生效：这一跑只降了 12 格）；
  文档里那三处「实测存量 310 处」的写法改成**指向现算的读数**（登记那一刻的 310 处 / 29 份
  作为历史读数留在原句里），不再抄一份会过期的数。

  本地读数：`tsc --noEmit` 0 处 · `check-scripts-typecheck` 面 210 / 存量 294 = 基线 294 ·
  `eslint --max-warnings 0` 绿 · `doc:check` 绿 ·
  直接跑这些脚本的 6 份用例（`check-merge-parents` / `lockfile-diff` /
  `linux-env-bootstrap` / `merged-side-loss-gate` / `pending-merge-loss-gate` /
  `dev-handle`）90 条绿 —— 这一批没有行为变化，那 90 条买的是「没有」。

  **平台那一格抓到一处本批带进去的用例红**（`受影响用例` 不在本地档，见硬规则 7）：
  `tests/dev-launcher-toolchain-gate.test.ts` 钉「失败路径要报出错误码」的方式是
  **整档搜字面量** `result.error.code`，而本批把那一位收成一句局部变量之后，
  它红在一个**行为一个字没变**的地方（build `cnb-3jq-1k62lrhab`，
  `Tests 1 failed | 1886 passed`）。改法是**把断言收窄到它真正要看的那一段**：
  从 `if (result.error) {` 到 `if (result.status === null) {` 之间必须出现 `.code`，
  并且**提取落空要前置断言**（`failureBlock.length > 0`）—— 少了那一格，
  「块没切出来」会被读成「块里没有 code」，判据就在 silently 不判。
  变异实测：把 `${spawnError.code ?? "UNKNOWN"}` 换成 `${spawnError.message}`
  ⇒ 这一格当场红（`失败块里必须把 error 的 code 打出来: expected 'if (result.error) …'
  to contain '.code'`），换回原样 ⇒ 56 passed / 13 skipped。
  同一条用例里那句真正的反面断言（不许 `exit(result.status ?? 0)` 把「没起来」读成成功）
  逐字留在原位 —— 那才是它当初存在的理由，本批没有动它。
