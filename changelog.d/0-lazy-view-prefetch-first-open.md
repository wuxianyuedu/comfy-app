## Fixed

- **每个界面「首次打开」不再等一次分块编译/拉取**：现场是应用日志「界面打开」的
  读数 —— 设置 / 队列 15s 上下、模式契约 23s，而同一屏第二次起都是几十毫秒。
  成因：工作区每一屏都由 `next/dynamic` 懒加载，分块的 `import()` 在**点开那一屏**
  才发出；dev server（`next dev --turbo`）对每个分块按需编译，代价整个落在用户的
  点击之后（生产构建没有按需编译，但首访仍要现拉一次分块）。
- 修法：新增 `src/components/studio/lazy-view-prefetch.ts` —— `lazyView`
  （动态 import 的唯一出口）把 loader 登记进去，工作区挂载后按**空闲**把它们逐个
  `import()` 一遍。bundler 的模块注册表里同一模块第二次起就是缓存命中，用户真点开
  那一屏时 `next/dynamic` 的 loader 直接兑现，「界面打开」的耗时从「点击 + 编译」
  缩成「点击」。
- 两条硬约束都有前车之鉴：**串行**（浏览器同源 HTTP/1.1 只有 6 条连接，并发预热
  会把日志轮询 / SSE / tRPC 的连接预算占满 —— 同类事故见轮询原语 `ms: () => 0`
  空转那一轮，按需分块 import 撞 `ERR_INSUFFICIENT_RESOURCES`）；**失败静默**
  （预热失败不抛不重试，真失败照旧走 `lazy-chunk-recovery` 的自愈，预热只是提前量、
  不是新故障面）。
- 判据：`lazy-view-prefetch.test.ts` 钉行为（等空闲才要 / 串行至多一条在途 / 失败
  不阻断后续 / 重复启动幂等 / 无 `requestIdleCallback` 的退化路径），
  `WorkspaceViewStack.test.ts` 补一条源码判据钉接线（`registerLazyViewLoader(loader)`
  与 `startLazyViewPrefetch()` 漏一个，那一屏的首开就退回点击后才编译，而这件事在
  正常构建下看不出来）。
