## Fixed

- **脚本档清账批 3：`scripts/setup-comfy-cli-venv.mjs` 14 格清零，账从 273 处 / 20 份降到
  259 处 / 19 份（ISSUE #2589 / 规范 §13.5.14.1）**：13 格 `TS7006` 是各函数的形参没写 JSDoc
  类型（`writeLog` / `writeStatus` / `runStep` / `compareVersions` / `saveUpgradeState` /
  `upgradeCheckDue` / `pythonMeetsFloor`），第 14 格是 `runStep()` 里那句
  `r.error?.code === "ETIMEDOUT"`（`TS2339`）—— `spawnSync` 把 `error` 声明成 `Error`，
  而「超时 / 起不来」带的是 `ErrnoException`，那个 `ETIMEDOUT` 只能从 `.code` 上读到。
  收成一句 `const spawnError = /** @type {NodeJS.ErrnoException | undefined} */ (r.error)`，
  与仓里既有那一形逐字同（`ci-cp936-exit.mjs:481` / `e2e-run-playwright.mjs:191` /
  批 1 的 `dev.mjs` / `start.mjs`），**读的是同一个对象的同一个属性**，判定分支一字未动。

  类型都按**调用点的原值**取，不是猜的：`compareVersions(installed ?? "0", latest)` 那两位
  在 `if (!latest)` 早退之后才是 `string`；`upgradeCheckDue(force)` 的 `force` 来自
  `process.argv.includes("--force") || …` ⇒ `boolean`；`runStep` 的 `args` 全是字面量数组。
  一处观察记在这里（不构成改动）：`NodeJS.ErrnoException` 在 `scripts/*.mjs` 里现在共
  **7 处**，其中 **6 处是这一形 cast**（`ci-cp936-exit` / `dev-launcher-session` /
  `e2e-run-playwright` + 批 1 的 `dev.mjs` / `start.mjs` + 本笔），第 7 处是
  `db-push-core.mjs:189` 的 typedef 类型（不是 cast）。抽一个 `errnoCode()` helper
  换不到任何运行期收益（它只是写给类型检查器的一句话），而 §12.12 的孪生判据按
  整文件重合度算、这条根本不落进它的量程 —— 所以不为此新造地基。

  本地读数：`tsc --noEmit` 0 处 · `check-scripts-typecheck` 面 210 / 存量 259 = 基线 259 ·
  `eslint --max-warnings 0` 绿 · `oxfmt --check` 对这份文件本来就干净、改完仍干净
  （HEAD 版与本版各查一次，两次都通过 —— 所以本笔没有夹带任何整档重排）·
  三份引用它的用例 `ci-env-probe` / `ci-install-deps` / `ci-slot-apply` 139 条绿。
