## Fixed

- **`base-check`：基线侧「一条用例都没收集到」不再被读成「别线的红」**（§13.6.2 / §13.6.4）。现场：被 C 组拦下一条 30s 超时，按 §13.6.4 去复算，第一次报 `inconclusive`、第二次却报了 `baseline-red` —— 依据是基线那一侧 `Test Files  1 failed (1)` + **`Tests  no tests`**（基线快照里 `@testing-library/jest-dom` 链到了链不上的 `@adobe/css-tools`）。**一个用例都没跑起来**，而它退的是 **1**，与「判据跑了且红」逐字同形；`commandTargetState` 那条静态判据也看不见它（目标文件在，是运行时依赖链断了）。
  - **为什么必须分开**：`baseline-red` 的下一动作是就地修 / 按 §11.12 登记 `KNOWN_FAILED_FILES`，而这次根本没有「一条有主的账」可登 —— 下一次它不红，那条登记从此就解释不清（同 §13.6.4 反对把负载假红读成 `baseline-red` 的理由，只是换了触发原因）。
  - **修法**：新增 `runState()` / `isDidNotRunShaped()`，认本仓库真见过的原文（`Tests  no tests` / `Cannot find package` / `Cannot find module` / `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` / `No test files found`），`judge()` 在**任一侧**命中时报 `inconclusive`。档位高低：`current-green` > `inconclusive` > `yours` > `load-flake` > `baseline-red`。
  - **假阳性闸**：`Test Files  1 failed (1)` + `Tests  3 failed | 5 passed` 必须**仍**判 `baseline-red` —— 用例反向钉住，不许把真红一起吞成 `inconclusive`（纯函数 + 真仓库端到端两处各一组）。
  - 报告里新增 `没跑起来：<哪一侧、哪一种形态>` 一行（`didNotRunSide()`）：退出码同形，只有输出里的指纹分得开。`inconclusive` 的下一步话术补齐第二种形态的出口 —— 在基线 worktree 里 `pnpm install --frozen-lockfile`，或把 worktree 建到与目标侧**同一个盘 / 同一个根**下。
- **顺带修 `base-check` 在 Windows 上的 `pnpm exec …` 形态**：`pnpm` 是 `.cmd` 垫片，`spawnSync` 不开 `shell` 就是 `ENOENT`（⇒ 127 ⇒ `inconclusive`），而报告里一个字都没提，人会以为是自己命令写错了。现在对 `pnpm` / `npm` 这两个命令开一层 shell（见 `needsShell()`），并在 127 的话术里直接点名「或改用 `node node_modules/<pkg>/<bin>` 形态」。
- 用例 +9（`tests/base-check.test.ts` 48 → 57）：两条入口各一组、`runState` 三态、指纹表两向、报告点名哪一侧、整批压过 `baseline-red`、真仓库端到端（基线收集不到 / 本检出真红）。规范 §13.6.2 的两条入口表与档位说明同步。
