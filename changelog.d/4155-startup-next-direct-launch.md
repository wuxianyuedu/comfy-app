## Changed

- **启动链路 server 段不经 pnpm，直启 next bin（ISSUE #4155）**，两跳各省一次 Windows
  pnpm shim 冷启（合计实测约 2.5s/次）：
  - 编排器第一跳：`spawnDevServer` 由 spawn `pnpm dev` 改为 **`node scripts/dev.mjs -p N -H host`**
    —— 与 `tauri.conf.json` 的 `beforeDevCommand`（本就是 `node scripts/dev.mjs`）统一成同一形态；
  - `dev.mjs` / `start.mjs` 第二跳：`pnpm exec next` 改为 **`process.execPath` 直启 next 的
    bin 入口**，bin 落点由 next 自己 package.json 的 `bin` 字段回答（唯一实现
    `scripts/launcher-core/next-bin.mjs::resolveNextBin`，两条入口共用）。
  - 由此把「pnpm shim 形态坏了服务起不来」（ISSUE #576 家族）这个失败类从 server 链摘掉；
    pnpm 形态判据（shell.mjs）继续管真正用 pnpm 的地方（install / db-push / 探测）。
  - 进程归属判据不受影响：新命令行仍含检出根 + `scripts/dev.mjs` / `next dev|start`，
    `isAppDevServerCmdline` 的三种形状照常命中。契约测试随口径演化
    （`dev-launcher-toolchain-gate` / `executor-host-spawn` / `db-backup-wiring`），
    另补 `tests/next-bin-resolve.test.ts` 四方向行为测试。
