## Changed

- **`src/lib` 里 11 处 `globalThis as unknown as Record<...>` / `globalThis as unknown as { ... }`
  的 HMR 单例声明，统一换成 `declare global { var ... }` + 直接 `globalThis.__key ??= ...`**：
  旧模式每个模块各自拿 `as unknown as Record<string, T>` 把 `globalThis` 硬套上一个
  形状，再把状态存到字符串键里（`G_KEY` / `SILENT_PROBE_KEY` / `REAPER_GLOBAL` /
  `CLI_PROCS_GLOBAL` / `CHECKSUM_CACHE_KEY` / `STATUS_CACHE_KEY` 各写一遍）。
  跨模块读写同一 slot 时（例如 `comfyui/status.ts` 读 `comfyui/lifecycle.ts` 写的
  `__comfyLifecycle_v1`），reader 只能自己**重抄**一份"我关心的子集"形状（`ChildHolder`），
  writer 加了字段 reader 完全看不到、reader 抄错了编译器也不报。

  换成 TS 原生的 `declare global { var ... }`：
  · 每个 slot **有且仅有一个** var 声明，类型是 owning 模块里那个真实类型
  （`LifecycleGlobal` / `SnapshotGlobal` / `ReaperGlobal` / `RunnerState` /
  `SilentProbeGlobal` / `StatusCacheGlobal` / `CacheStore` /
  `Map<string, ChildProcess>` / `Map<string, ChecksumMemo>` 各就各位）；
  · 消费方直接 `globalThis.__comfyLifecycle_v1?.child?.pid`，**结构访问**、
  不再本地重抄形状；`status.ts` 的 `ChildHolder` 类型与 `as unknown as` 单跳
  一并删；
  · 字符串键 `G_KEY` 等全部去掉，`??=` 一次性完成"取或初始化"。

  `no-var` 规则未启用，`// eslint-disable-next-line no-var` 由 eslint --fix 移除；
  `localWorkflows.ts` 的 `??= new Map()` 加了显式泛型参数
  （`new Map<string, ChecksumMemo>()`），否则被推成 `Map<any, any>` 撞
  `no-unsafe-return`。

  行为不变——`globalThis.__key` 与原 `Record<string, T>` 的字符串索引落到 JS 里
  是同一件事（属性 vs. 索引，运行时字节码等价），只是类型层的**跨模块单例契约**
  从"人眼对齐形状"升级到"编译器核对 declare"。
