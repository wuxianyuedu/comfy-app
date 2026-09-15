## Fixed

- **`pnpm check:toolchain` 不再只报一句「版本与 package.json 要求不一致」就结束**（ISSUE #576 第三轮）：真启动时启动器在同一情形下会**自己用 corepack 对齐**（`reconcilePnpmVersion()` → `preparePnpm()` + 同一条探测复核），`prepare-local-run.ps1` 第 3 步也早已如此；而自查入口当时只打印 `[WARN] 本机 10.34.5，要求 12.4.1`、什么也不做，还以 0 退出 —— 用户只能手动跑 corepack，也看不出下一关还有 `node_modules` 门禁。
  - 自检**复用同一条对齐动作**：先 `preparePnpm()`（版本号取自 `package.json` 的 `packageManager`），再用**同一条探测**复核；通过则报 `[OK] 已对齐：pnpm 10.34.5 → 12.4.1`，仍不一致才 `[WARN] 自动对齐未生效` + 手动命令（版本不一致与启动器一致地**不阻断**）。
  - 顺带检查 `node_modules`（判据键与启动器的 `checkNodeModules()` 相同）：未装时点出「完整依赖预检会在这一关拦下 + `pnpm install`」，避免把 `[OK] pnpm 可用` 读成「可以启动了」。
  - 结论是：**自检看到的每条结论都必须是启动链路里真会发生的事**（判据与动作都收在 `corepack.mjs`），这正是规范 §9.5「一份逻辑两端复用」要消灭的「两套说法」。回归 3 例见 `tests/dev-launcher-toolchain-gate.test.ts`。
