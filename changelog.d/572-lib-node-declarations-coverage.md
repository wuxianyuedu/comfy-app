## Changed

- **`src/lib` 的 Node-only 声明收口到一条规则，并配上机器判据（ISSUE #572 第 1 项 / 规范 §18.4）。** 此前同一件事有三套写法并存且没有任何文档说明何时用哪个 —— `.server.ts` 后缀 7 个、顶层 `import "server-only"` 21 个、**两者都没有** 15 个（顶层 `import fs` 的执行链模块）。第三类出过整页 500 的事故（`log-session-scope.ts` 的 `node:fs` 被客户端组件引到，ISSUE #317 / #282）。现在按 §18.4 的三分类对齐完 58 个模块：53 个补 `server-only`、5 个保持 `.server.ts`、2 个（`kill-process-tree.ts`、`llm/secrets.ts`）作为「纯 Node 宿主」正式登记。
- **`src/lib` 子域覆盖率不再是零门槛（ISSUE #572 第 5 项 / 规范 §18.6）。** `vitest.config.ts` 新增七条目录门槛（`agent` / `core` / `drizzle-studio` / `film` / `llm` / `project-canvas` / `workshop`），数值取**实测值向下取整到 5 的倍数**、只升不降 —— 此前门槛只覆盖 5 个**文件**，`film`（7.5%）、`llm`（31%）、`core`（35%）这些关键路径既不报警也不记账。
- **`app-settings` 按「纯 / IO」分层（ISSUE #569 第 5 项 / 规范 §18.4）。** 原 `src/lib/app-settings.ts` 把「设置类型 + 默认值 + 纯派生」与「读写 `data/app-settings.json`」混在一个文件里，还顺手 re-export 了 `COMFYUI_DEFAULT_PORT` —— 于是视图层只要那个常量就会连 `fs` 一起打进浏览器包。现拆为 `app-settings/index.ts`（纯）与 `app-settings/app-settings.server.ts`（IO），默认端口的唯一出口回到 `@/lib/endpoints`，端口门禁相应改为**反向**断言（app-settings 不得再转手该常量）。
- **`core/errors.ts` 只留有生产调用方的错误类（ISSUE #573）。** 九个类里七个零 `new` 调用点，唯一的「消费方」是测试自己 —— 那是最难被发现的一类死代码（覆盖率看起来是绿的，生产路径一次都走不到）。契约（`AppError` + `code` + `httpStatus` + 归一化 + 信封）保留，缺的状态码直接 `new AppError(msg, code, status)` 表达。
- **删除零订阅方的 `core/events.ts`（eventBus / DomainEventMap，ISSUE #573）。** 注释承诺「执行层 emit、SSE / 缓存失效订阅」，实测全库零 `publish` / 零 `subscribe`。留着一条「将来会有人用」的通道，只会让后来者以为事件已经被广播出去了。
- **`lib` 的定位在规范里改正（ISSUE #572 第 6 项 / 规范 §12.5.1）。** `lib/` 此前写作「纯工具函数（无 React、无服务端依赖）」，实际是「剩下的一切」（进程编排、文件系统、仓储）。已改为**跨端逻辑层**，并写清「Node-only 领域编排可以留在 `lib/`，条件是按 §18.4 声明」。

## Added

- `scripts/lib-node-only-scan.mjs` + `tests/lib-node-only-declarations.test.ts`（规范 §18.4）：走真实依赖图判三件事 —— **声明缺失**、**声明失效**（写着只能服务端用却仍被纯模块可达）、**真进浏览器图**（被 `"use client"` 入口引到且顶层有 Node 内建）。接入 `.githooks/pre-commit` 第 19 步与 CI。判据刻意不写成「扫到 `import fs` 就要求 `server-only`」：`eslint-plugin-boundaries` 的 import 图对服务端源码完全不采样（实测给 `src/lib/log-paths.ts` 加 `import "server-only"` 后 `pnpm lint` 仍绿），而「纯 Node 宿主」本来就不该带 `server-only`（加上去 `scripts/*.mjs` 的启动编排会直接崩）。
- 错误类清单的机器判据（`src/lib/core/errors.test.ts`）：每个具名错误类都必须在 `src/**` 生产代码里有 `new` 调用点，已删的类不得回归 —— 判据不能是「有没有测试」，只能是「生产路径走不走得到」。
