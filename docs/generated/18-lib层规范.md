<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/standards/18-lib层规范.md`。改动请回源文件，再重新生成。 -->

# 18. lib 层规范（门禁与边界）

> 本章把 `src/lib/**` 从「门禁盲区」变成**一等公民**。它是 ISSUE #565 逐文件审查的
> 根因项（ISSUE #575）：其余几十条问题是**看得见的病**，这一条是**没有人给它体检**。
>
> 一句话：`src/lib` 既不是「纯工具」（它含进程编排、文件系统、数据库），也不是
> 「视图层」（`check-ui-logic-separation` 不管它），也不在 `standards/` 的任何一章里
> —— 于是四类门禁在它上面**同时失效**。本章 + 配套门禁补的正是这个洞。

## 18.1 现状：为什么 lib 曾是盲区

| 门禁类别       | 脚本                                        | 对 `src/lib` 的实际效力                                                                                                                                                                               |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分层边界       | `eslint-plugin-boundaries`                  | **盲区**：`elements` 只声明了 `src/server`、`src/lib/core`、`src/lib/db`、`src/components`、`src/features`；`src/lib/comfyui`、`workshop`、`film`、`llm` 不属于任何 element，靠 `default: allow` 放行 |
| 复杂度（文件） | `check-file-structure.cjs` R5               | **只提醒不阻断**（>900 行打一行「建议拆分」），于是文件只增不减                                                                                                                                       |
| 复杂度（函数） | `check-function-length.cjs`                 | 覆盖**已声明的函数 + 无名字的块体**（IIFE / 回调 / 闭包，见 12 §12.13.2）；跨行签名（`React.memo(function …)`）也在射程内                                                                                                                                  |
| 视图/逻辑分离  | `check-ui-logic-separation.cjs`             | **不覆盖**：只扫 `src/components/**` 与 `src/app/**`                                                                                                                                                  |
| 客户端安全     | `tests/client-bundle-node-builtins.test.ts` | **覆盖**（从 `"use client"` 入口做可达性 DFS）—— 这条是既有且有效的                                                                                                                                   |
| 覆盖率         | `vitest.config.ts` `thresholds`             | `src/lib/**` 已纳入 `include`，但**只给 5 个文件**设了门槛                                                                                                                                            |
| 格式           | prettier                                    | 未接入门禁（全库未过；`src/lib` 178 个）                                                                                                                                                              |

**根因一句话**：门禁是「按目录清单」声明的，而 `src/lib` 不在任何清单里。

## 18.2 lib 的定位（与 §12.1 的关系）

`§12.1` 把 `lib/` 写作「纯工具函数（无 React、无服务端依赖）」—— 那是**理想**，
现状是「跨端逻辑层」：它承载**全平台复用**的逻辑，其中既有纯函数，也有 Node-only
的领域编排（`comfyui/**`、`film/orchestrator.ts`、`drizzle-studio/**`）。

本章明确 `lib/` 的**边界**（比「纯工具」可执行得多）：

| 允许                                            | 禁止                                                     | 判据 / 门禁                                                               |
| ----------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 纯函数、类型、常量                              | React（`.tsx`、`useState`、JSX）                         | R4 禁 `.tsx`；`check-ui-logic-separation.cjs` H2 禁 `src/lib/**` 用 React |
| 浏览器与服务端共用的逻辑                        | `import` 视图层（`src/components/**`、`src/app/**`）     | `eslint.config.js` 的 `boundaries`：`lib` → `components` 阻断（18.3）     |
| Node-only 领域编排（须声明，见 18.4）           | 反向依赖：被 `lib` 依赖的模块再回头依赖 `lib` 之外的视图 | 同上 + 规范 §12.7（循环依赖预防）                                         |
| 网络客户端（`<domain>-client.ts`，§17.2 第②层） | 直接读 `process.env`（应收口，见 ISSUE #568）            | 本批次登记项，尚无机器判据                                                |

> **为什么 lib 不得 import components**：`lib` 是被 `components` / `app` / `server`
> 共同依赖的**地基**。地基反过来引视图，会让「谁在最底层」变成循环，也让 lib 模块
> 无法脱离 React 树单测。需要共享的类型要**下沉到 `src/lib` 下的类型模块**
> （本项目实例：`src/lib/workflow-io-types.ts`）。

## 18.3 分层边界：`lib` 是一个 element（机器强制）

`eslint.config.js` 的 `boundaries/elements` 现在显式声明 `src/lib/**`：

```js
"boundaries/elements": [
  { type: "server", pattern: "src/server/**" },
  { type: "server", pattern: "src/lib/core/**" },   // ← 更具体的必须在前
  { type: "server", pattern: "src/lib/db/**" },     // ← 否则会被按 lib 归类
  { type: "lib", pattern: "src/lib/**" },
  { type: "components", pattern: "src/components/**" },
  { type: "features", pattern: "src/features/**" },
],
```

配套策略：

```js
{ from: { element: { type: "lib" } }, disallow: { to: { element: { type: "components" } } } }
```

**元素顺序是语义**：`boundaries` 按声明顺序取第一个匹配的 element，`src/lib/core/**`
与 `src/lib/db/**` 必须排在 `src/lib/**` **之前** —— 否则数据层会被重新归类成 `lib`，
`server → components` 的既有约束随之静默失效。回归测试守着这一点。

## 18.4 Node-only 模块的声明规则（唯一口径）

仓库里此前**三套约定并存**：`.server.ts` 后缀 / 顶层 `import "server-only"` /
两者都没有。本章定一条唯一规则：

| 形态                   | 何时用                                                                           | 例                                                                         |
| ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `import "server-only"` | 模块的**全部**出口都只能服务端用（浏览器图一旦可达即应报错）                     | `src/lib/core/repository*.ts`、`src/lib/llm/server.ts`                     |
| `.server.ts` 后缀      | **同一领域**的「服务端拆件」：把 IO 从纯逻辑模块里切出去，让客户端只引纯函数那个 | `src/lib/log-session-scope.server.ts`（纯函数留在 `log-session-scope.ts`） |
| 两者都不加             | **纯 Node 宿主**模块：不经 Next 打包，由 `scripts/*.mjs` 等高动态加载            | `src/lib/kill-process-tree.ts`                                             |

> **为什么 `kill-process-tree.ts` 不能加 `server-only`**：它由 `scripts/reap-process.mjs`
> 与 `scripts/dev-launcher.mjs` 在**纯 Node**（`tsx` 运行时）下动态 import。
> `server-only` 的入口文件就是一句 `throw`（只在 Next 的 `react-server` 条件下才
> 解析到空模块），加上它会让**启动编排直接崩**。这类模块的守卫是它自己的宿主边界，
> 不是 `server-only`。

**已有的机器守卫**（无需新增脚本）：`tests/client-bundle-node-builtins.test.ts`
从 `"use client"` 入口做可达性 DFS，命中即失败并打出完整引用链。它比「每个 import
Node 内建的模块都必须有 `server-only`」**更强也更准** —— 后者会误伤 18.4 第三类
（纯 Node 宿主），而前者只判「真的会被打进浏览器图」这一件事。

> **判定反模式**：给「顶层 import Node 内建的 `src/lib` 模块」再写一份「检查有没有
> `server-only`」的脚本，会与这个测试形成两份会各自漂移的判据（AGENTS 硬规则：会静默
> 失效的清单只许定义一次）。**新增守卫前先查是否已有更强的那一条。**

## 18.5 文件与函数长度棘轮（R5 + §12.13）

`src/lib` 的历史大文件由两条棘轮约束，**都只许降不许升**：

| 维度     | 门禁                          | 阈值   | 基线                                     |
| -------- | ----------------------------- | ------ | ---------------------------------------- |
| 文件行数 | `check-file-structure.cjs` R5 | 900 行 | `scripts/.file-size-baseline.json`       |
| 函数行数 | `check-function-length.cjs`   | 400 行（含无名字块体，见 12 §12.13.2） | `scripts/.function-length-baseline.json` |

R5 的用法（与其它棘轮同构）：

```bash
node scripts/check-file-structure.cjs            # 检查（R5 只提醒，不判断失败）
node scripts/check-file-structure.cjs --strict   # CI 用：新增超限文件 / 变大即失败
node scripts/check-file-structure.cjs --update   # 拆分后收紧基线
```

**为什么 R5 从「只提醒」升级为棘轮**：提醒只是输出一屏里的一行字，**没有人会因为
一行提示去拆文件** —— 本项目 900 行以上的文件长期停在 10 个，只增不减，正是「只提醒」
的直接结果。（同样的教训见 §12.12 与 §12.13：判据不接棘轮就等于没有判据。）

## 18.6 覆盖率（按目录设门槛，只升不降）

`vitest.config.ts` 的 `thresholds` 目前只给 `src/lib/comfyui` 的 4 个文件与
`src/server/api/middleware` 设了门槛。`src/lib` 的其余子域（`film` 7.5%、
`core` 28.8%、`llm` 31.2%、`agent` 18.9%）**零门槛**。

落地口径（与 §11.7 的覆盖率棘轮一致）：

1. 先用 `pnpm test:coverage` 拿到子域**实测值**；
2. 按实测值设门槛，**不设理想值**（设高了会让无关提交变红，设低了等于没设）；
3. 之后只升不降。

> 本条的落地与测试补充绑定（见 ISSUE #575 的登记项）：门槛值必须来自真实测试覆盖，
> 不能先写数字再补测试。

## 18.7 登记项：本章尚未机器化的部分

审查发现的其余缺口**已登记为独立 Issue**，不在此处「顺手重构」：

| 缺口                          | Issue        | 为什么不在本章落地                                                                                                        |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| ~~`lib` 内循环依赖无判据~~    | #574         | **已落地**：`scripts/check-circular-deps.cjs` + 棘轮基线（见 §12.7），`src/lib` 实到 2 组环已消除 |
| ~~`lib` → `server` 越界无判据~~ | #569 第 6 项 | **已落地**：依赖逐个登记 + 「登记清单不许失效」双向判定（见 18.10） |
| 零调用导出无判据              | #573         | 现存「导出但零外部引用」566 个，**绝大多数是同文件内使用的 props 类型** —— 需要先定「什么算死代码」的判据（不是导出即算） |
| ~~`IIFE` / 回调体不计函数长度~~ | #570 第 7–8 项 | **已落地**：判据纳入无名字块体 + 跨行签名（12 §12.13.2），基线按「判据版本」一次性重记（20 → 22，新增的 2 条为存量登记） |
| prettier 未接入门禁           | #575 第 9 项 | 一次性格式化 600+ 文件是巨型噪声 diff，与 §13.7「禁止无关全文件变更」冲突，须单独立项分路径接入                           |
| `lib` 直读 `process.env` 收口 | #568         | **已裁决**：不收口，改为删掉 `config.ts` 的误导性承诺（见 18.8）|

## 18.8 core 骨架的取用口径（ISSUE #568）

`src/lib/core/**` 是 18.3 里被声明为 element `server` 的那部分（架构基座）。它的
三处「唯一事实源」曾经都只是注释里的承诺，现在各有机器判据：

| 关注点 | 现状 | 机器判据 |
| --- | --- | --- |
| 日志 | `core/logger.ts` 是 pino 的**薄封装**（只有一条通道） | `tests/single-logger-channel.test.ts`（服务端库代码禁直接 `console.*`） |
| 仓储取用 | **只有一种**：直接 `import { xRepository } from "@/lib/core/repository"` | `tests/container-single-access.test.ts`（`src/` 内禁 `container.resolve(`） |
| 配置 | `core/config.ts` 是**类型契约 + 默认值**，不承诺「集中配置」 | `tests/core-spine-single-source.test.ts`（禁承诺句式；默认值必须取自 `CONFIG_ENV_DEFAULTS` / `endpoints.ts`） |

三条判据都已接入 `.githooks/pre-commit`（第 17 步）与 CI（`Core spine single source`）。

**两条诊断通道已并入唯一通道（不再豁免）**：`generation-log.server.ts` 的
`console.warn` 改走 `core/logger`（消息文案不变，额外获得脱敏与 ERROR 镜像）；
`comfyui/trace.ts` 直写文件、不经 pino，因此**在写入边界**过一次值形状守卫
（`core/redact-secret.ts`，与 pino 镜像共用同一份实现 —— 见 18.4 的「共享内核」）。
`tests/single-logger-channel.test.ts` 的目录级 `SKIP_DIRS` 与逐文件 `ALLOWED`
豁免**已全部删除**：目录级豁免的危险在于，它让「以后往这里加 `console`」完全无声。

**为什么移除 DI 容器（`core/container.ts`）而不是「收口到只经容器取用」**：
裁决不靠「哪种更像架构」，而靠两条可验证的事实 ——

1. **两种取法取到的是同一个对象**。容器用 `register("x", () => x)` 把模块单例
   原样返回，没有任何「每个 resolve 一个新实例」的语义；全仓也没有任何一处
   `register(..., mock)`。所以注释里承诺的「可替换单例、便于测试」**从未被使用**，
   连测试都只 `vi.mock` 模块本身（那本来就绕过容器）。
2. **直接 import 是全仓的既成形态**：29 个文件直接 import，容器 2 个文件 /
   10 处调用。要收口到容器，得把它重新写进 29 个文件（含 `lib/comfyui/**` 的
   执行链），并连带改掉所有 `vi.mock("../core/repository")`；收益是零
   （同一批对象），代价是最大的一次重写 + 一个「只有 2 个调用方用过」的抽象。

> 一句话判据：**当一个抽象与它的（潜在）实现给出了同一个答案时，留下的是更小的那个。**
> 反之，如果本仓库真的需要「按请求替换仓储」（多租户 / 请求级作用域），结论会反过来
> —— 那时要引入的是**请求作用域**容器，而不是目前这种进程级单例包装。

**`config.ts` 为什么不「把所有 `process.env` 收进来」**：它的 schema 只覆盖 7 个
变量，而实际用到的还有 `COMFYUI_PATH` / `COMFY_CLIENT_ID` / `LLM_*` / `FFMPEG_BIN` /
`COMFYAPP_TASKKILL` 等一大批；把 30+ 处就地读全部改成 `config.x` 要么补齐 20+ 个
变量（其中多数是「按调用点不同」的路径解析，不是配置树该管的东西），要么留下一个
**更大**的误导性承诺。所以裁决是**删掉承诺、只留契约与默认值**：新增配置项时，
只有「两侧都要读的连接 / 端口 / 路径」才把默认值放这里。

## 18.10 lib 与 server 的依赖方向（ISSUE #569 第 6 项）

18.3 只把「`lib` 不得 import `components`」变成了机器判据，**「`lib` 不得
import `server`」这条顺手漏了** —— 于是 `lib/comfyui/**` 与
`lib/drizzle-studio/lifecycle.ts` 里 11 个文件直接 `from "~/server/lib/logger"`，
而 `pnpm lint` 全绿。本节的判据是 `tests/lib-server-imports.test.ts`。

**为什么不是「一律禁止」**：`lib` 与 `server` 之间有**三类**引用，前两类是合法的，
一律禁止会把它们一起误伤 —— 那种判据只会被绕过：

| 形态 | 例 | 处置 |
| --- | --- | --- |
| **数据层同层引用**（`lib/core/**`、`lib/db/**` 在 18.3 里就是 element `server`） | `lib/core/repository-task.ts` → `~/server/db/schema`（Drizzle 表定义） | 合法，不入清单 |
| **测试里与源码串一致的 mock** | `vi.mock("~/server/lib/logger")` | 跟着源码一起改，不单独设判据 |
| **越界依赖** | `lib/comfyui/client.ts` → `~/server/lib/logger` | **逐个登记，清单只许变短** |

**登记的粒度是「边」，不是「源文件」**（`from → to` 这一对）：键只记源文件的话，
一个文件因为**任何**理由进过一次清单，它此后新增的**任意** lib → server 依赖都会被
放行，而两条断言都不会红 —— 新增边被当成「已登记」，`REGISTERED` 的值也没人比对。
实测确认过这条逃避（在 `lib/comfyui/client.ts` 追加一个指向 `~/server/lib/…` 新模块
的 import，三条用例全绿），因此判据比对 `from → to`，登记才真正等价于「这条边被裁决过」；
`tests/lib-server-imports.test.ts` 另有一条纯数据回归护栏钉住这一点。

**为什么必须登记而不是「列个 Issue 就完了」**：这类依赖的代价是**可数的** ——
`lib/comfyui/**` 里 30+ 个测试只能靠 `vi.mock("~/server/lib/logger")` 才跑得起来
（mock 说明符必须与源码串逐字一致，另有 7 个测试文件重复了这段），而 `lib` 也就
永远无法脱离 Next 服务端上下文单测。没有判据时，新模块再引一次 `server/lib/logger`
不会有任何提示。

**消除这批依赖时不需要新抽象**：`lib/core/logger.ts` 已经是 `server/lib/logger` 的
**薄封装**（接口 `debug/info/warn/error/child` 逐字一致、调用方零改动），且它按
18.4 第三类**不带** `server-only`（核心层被纯 Node 宿主与 Next 同时加载）。因此
`lib` 侧的统一出口就是 `@/lib/core/logger`；实现在 `core/logger` 与
`server/lib/logger` 两个**同层**模块之间的合并/下沉，新增已无事可做 —— 它剩下的
价值只是「同一个文件里两套写法」。

> 登记清单里的 `lib/auth-server.ts` → `~/server/better-auth/server` 属另一种情形
> （Next 请求上下文，无法下沉），留待专项裁决。

## 18.9 速查

- 改 `src/lib/**` 前：先读本章 → 确认没碰 18.2 的禁止项 → 跑 18.5 的两条棘轮。
- 要取仓储：**直接 import**（`@/lib/core/repository`），别再找容器 —— 它已按 18.8 移除。
- 要写日志：**lib 侧走 `@/lib/core/logger`**（中立出口、不带 `server-only`），服务端走
  `@/server/lib/logger`；新增 lib → server 依赖会被 `tests/lib-server-imports.test.ts`
  拦下（见 18.10）。**不要直接 `console.*`**（会绕开脱敏与面板镜像）。
- `lib` 要共享类型给视图：**下沉类型模块到 `src/lib`**，不要在 lib 里 import components。
- 拆出 Node-only 模块：按 18.4 的表选声明形态，别三个都试。
- 需要新增守卫：**先查既有更强的那一条**（18.4 的判定反模式）。
- 改 `src/lib/**` 的 import 前：想清楚依赖方向（§12.7）。要下沉叶子、还是回调注入？
  同目录内 `x → y` 与 `y → x` 同时存在就是环，`node scripts/check-circular-deps.cjs --report` 立即可见。
