## Fixed

- **截图收尾只杀单进程、留 `next dev` 孤儿，导致下次截图「复用」到僵尸应用卡 120s 超时**（#4816）。
  根因在起应用那一端：`screenshot.mjs` 的 `startDevServer` 用裸 `spawn` 起 `scripts/dev.mjs`，
  POSIX 上子进程与截图脚本**同进程组**；收尾虽然已经走 `reap-process.mjs` → `killProcessTree`，
  但后者按 ps 读到目标 PGID 等于调用者自身组时，防自杀判据拒绝走 `kill(-pgid)`，退化成
  `kill -SIGKILL <pid>` 单杀 leader —— 日志里那句「单进程兜底·与调用者同组，禁杀组」就是它。
  其下的 `next dev` / turbopack worker 全部残留、继续占着端口；下一次截图只看「端口有人监听」
  就判定复用，而那个进程已经不响应，`page.goto` 卡到 120000ms 超时。
  修法是让 `startDevServer` 用独立进程组起应用：`detached: process.platform !== "win32"`
  （与 `spawnInGroup` / §3.1 同一口径），目标落在独立组里，`killProcessTree` 就能整组回收，
  `reapDevServer` 原有的整树出口无需改动。Windows 侧仍走 `taskkill /T /F`，不受影响。
  测试把 `detached` 的取值抽成纯函数 `shouldDetachServer(platform)`，POSIX / Windows 两侧
  逐字断言（真机只有一个平台，光看默认值只跑得了一半判据）；起应用的真进程树回收语义由
  `kill-process-tree.test.ts` / 跨平台用例守着。
