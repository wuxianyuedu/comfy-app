## Added

- **`lib` → `server` 的越界依赖从「只有人读代码能发现」变成逐个登记的门禁**（`tests/lib-server-imports.test.ts`，规范 §18.10）。ISSUE #575 把 `src/lib/**` 声明为 element `lib` 之后，「lib 不得 import components」有了机器判据，但**「lib 不得 import server」这条没写** —— 于是 `lib/comfyui/**` 的 10 个模块与 `lib/drizzle-studio/lifecycle.ts` 直接 `from "~/server/lib/logger"`（ISSUE #569 第 6 项，`pnpm lint` 全绿）。现在判据是**双向**的：出现未登记的 lib → server 依赖即失败；`REGISTERED` 里已经不再成立的条目也必须删掉（棘轮只许变短）。

## Changed

- **`lib/core/logger` 被明确为 lib 侧的日志出口**：它已经是 `server/lib/logger` 的**薄封装**（接口 `debug/info/warn/error/child` 逐字一致、调用方零改动），且按 §18.4 第三类**不带** `server-only`（核心层被纯 Node 宿主与 Next 同时加载）。因此消除 `lib/comfyui/**` 那批依赖**不需要新抽象** —— 出口已在，剩下的是实现在 `core/logger` 与 `server/lib/logger` 两个**同层**模块之间的合并。

## 说明

- **判据不是「一律禁止」**：`lib` 与 `server` 之间有三类引用，只有第三类算越界 —— ① `lib/core/**`、`lib/db/**` 本身就是 element `server`（取 `~/server/db/schema` 的 Drizzle 表定义是**同层**引用，不入清单）；② 测试里与源码串一致的 `vi.mock("~/server/lib/logger")` 跟着源码一起改，不单独设判据（单独断言只会制造与源码脱节的门）；③ 其余逐个登记。一律禁止会把 ① 一起误伤，那种判据只会被绕过。
- **代价是可数的**（也是「必须有个判据」的理由）：`lib/comfyui/**` 里 30+ 个测试只能靠 `vi.mock("~/server/lib/logger")` 跑起来，其中 7 个测试文件重复了这段 mock（且说明符必须与源码串逐字一致）。没有门禁时，新模块再引一次 `server/lib/logger` 不会有任何提示。
- **登记项**：11 个 lib → `server/lib/logger` + 7 个测试文件的 mock；另有 `lib/auth-server.ts` → `~/server/better-auth/server`（Next 请求上下文，无法下沉，留待专项裁决）。
- **本次未改任何源码依赖**（避免 30 个测试文件的无关 diff）：树上的边原样保留，只是从此**被登记、被计数**。
