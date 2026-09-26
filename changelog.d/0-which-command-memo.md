## Fixed

- **`whichCommand` 每次调用都全量探测（`scripts/launcher-core/shell.mjs`）**：
  一份启动编排会对同一个名字调 4~6 次（probePnpm × 2、spawnDevServer、
  concludeDownstreamExit…），每次都完整扫 PATH × PATHEXT 并对候选**真起一次进程**
  （10s 超时）—— Windows 上 pnpm 三种形态同目录并存时，一次冷探测就是数秒。
  现在按 `name + PATH + PATHEXT + platform` 进程内记忆化（单次启动内文件布局不变，
  缓存恒有效），并提供 `clearWhichCommandCache()` 给「文件被重建 / 覆写」的场景
  （toolchain-gate 测试已在 `beforeEach` 接入）。
