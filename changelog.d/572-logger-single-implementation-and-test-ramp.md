## Changed

- **日志实现只剩一份，落在 `src/lib/core/logger.ts`**：`src/server/lib/logger.ts` 从「pino 实现处」降为**转发层**（re-export，既有导入路径与 `logger.info(msg, fields)` 用法逐字不变）。同时消除 `lib → server` 的 10 条日志依赖边 —— `lib/comfyui/**` 与 `lib/drizzle-studio/lifecycle.ts` 改为 `import { logger } from "~/lib/core/logger"`，方向由越界变回同层。此前两条通道「互相转发」只是把同一条边换个写法：实现始终在 `server` 侧，`lib` 侧每一处要写日志的地方都只能反向依赖上层。
- **`tests/lib-server-imports.test.ts` 的登记清单 11 条 → 1 条**（只剩 `lib/auth-server.ts`，Next 请求上下文无法下沉），清单只许变短的判据不变。
- **原 `src/server/lib/logger.test.ts` 迁为 `src/lib/core/pino-contract.test.ts`**：测契约的用例跟着实现走，不再对同一份实现测两遍。

## Added

- **`src/lib` 子域覆盖率的第二段爬坡**（门槛同批抬到实测值，只升不降）：补 `src/lib/drizzle-studio/lifecycle` 的探测 / 定位 / 启停判决用例（**该目录此前零覆盖**），补 `src/lib/film/orchestrator` 的编排判决面用例（取消撤任务、合成前置条件、镜头参数与画幅折算）。实测 `drizzle-studio` 0% → 41%、`film` 7.5% → 40%、`core` 40.9%，`vitest.config.ts` 三条门槛随之从 `0/5` 抬到 `40`。

## Fixed

- **`tests/single-logger-channel.test.ts` 的判据改为「实现特征」**：不再断言「`core/logger` 是不是薄封装」（那是实现细节），而是断言全 `src/**` 里 `import pino` 的文件**只允许一个** —— 谁是实现处不再依赖文件名与注释，靠事实判定，新开第二条通道立刻红。
