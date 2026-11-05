## Fixed

- `scripts/launcher-core/procs.mjs` 的 Windows `netstat` 快照统一同步/异步契约：
  缓存命中与未命中两支都返回 `Promise<string>`，`listeningPidsWindows()` 与
  `listeningPidsOnPort()` 整条链改异步、由既有上层 `await`，并给 `netstatInFlight`
  补显式类型标注堵住 `any` 泄漏。此前每个新进程里的第一次调用必抛
  `TypeError: out.split is not a function`，`pnpm deps:guard` 当场崩，硬规则 9
  「装依赖前先问本检出实例在不在跑」在 Windows 上恒等于没问（#3199）。
- `pnpm deps:guard` 改三态：`0` 判据跑完且没有实例、`1` 判据跑完且有实例、
  `2` 判据没跑起来或读数形状不对；第三态明说「没给出结论」，不许被读成
  「没有实例在跑」。`scripts/sync-lint.ps1` 按退码分档给出口（#3199）。
- 补 Windows 冷缓存首次调用的回归用例：覆盖冷 / 热缓存两支、相邻端口并发合并在途
  探测、POSIX 分支不受影响与守卫三态；换回旧实现的反向验证 4 条全红（#3199）。
