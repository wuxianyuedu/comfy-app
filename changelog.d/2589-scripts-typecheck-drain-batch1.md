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
