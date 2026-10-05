## Changed

- **启动编排里 `pnpm -v` 从「问两遍」改成「问一遍」**（ISSUE #1516）。用户框出的那 5s 里，从「端口检查」到「pnpm 版本匹配」之间空了 **2.77s**，而那段不是在算什么 —— 是**第二次 spawnSync 冷启 pnpm shim**：工具链门禁（`orchestratePnpm`）刚问过 pnpm 的版本，两秒后版本一致性对齐（`reconcilePnpmVersion`）又原样问了一遍。Windows 上 corepack shim 要经 node 中转到 pnpm，单次冷启 1~3s，等于白付一遍。
  - 修法 = `scripts/launcher-core/corepack.mjs` 给 `probePnpm()` 加**进程内记忆化**（`probeMemo`，键 = 平台 + root + PATH）：同一份「命令 + 环境 + 平台」只 spawn 一次，后续调用直接复用同一份结论对象。
  - **弃用挂在唯一能让它变的动作上**：`preparePnpm()`（corepack prepare，换的就是 pnpm 的激活版本）在 spawn **之前**调 `clearPnpmProbeCache()`，否则 prepare 之后的复核会拿到「准备之前」的结论、通过与否都是错的。清点按调用顺序判，不按结果判（真实 prepare 要联网下载）。
  - 键里带 root / PATH / 平台：换检出、换 PATH、测试里模拟跨平台都是**真的不同的命令**，不许互相顶掉结论。
  - 实测（本仓 Linux）：`runToolchainGate()` 之后的 `reconcilePnpmVersion()` 由**一次完整 pnpm 冷启**降到 **0.6ms**；Windows 侧对应的是那 2.77s。
  - 顺带钉住一个既有事实：`src/lib/process/executable-resolve.ts` 的注释早就写着「一份启动编排会对同一个名字调 4~6 次 `whichCommand`（probePnpm × 2 …）」，这次把 `probePnpm × 2` 那一份收掉了。

## Tests

- `tests/dev-launcher-toolchain-gate.test.ts` 新增「pnpm 探测的记忆化（一次启动只探一次）」一组：同一环境问两次只 spawn 一次（用计数脚本当 pnpm，判据是「第二次有没有多起一次进程」，不依赖绝对次数）、返回的是同一份结论对象、失败结论同样被记住、换 PATH / 换 root 各自是另一个问题不许互顶、`preparePnpm` 的弃用必须发生在 spawn **之前**（源码级判据）、拿不到 corepack 时 `preparePnpm` 只回说明不抛错。反向验证：去掉 `probeMemo` → 第一条用例立刻变 2 次、必红。
