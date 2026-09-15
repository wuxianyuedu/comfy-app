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
| 复杂度（函数） | `check-function-length.cjs`                 | 覆盖「**已声明**的函数」，`IIFE` 与回调体不计                                                                                                                                                         |
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
| 函数行数 | `check-function-length.cjs`   | 400 行 | `scripts/.function-length-baseline.json` |

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
| `lib` 内循环依赖无判据        | #574         | 与断环改造同批做，否则棘轮基线立刻要重写                                                                                  |
| 零调用导出无判据              | #573         | 现存「导出但零外部引用」566 个，**绝大多数是同文件内使用的 props 类型** —— 需要先定「什么算死代码」的判据（不是导出即算） |
| `IIFE` / 回调体不计函数长度   | #570         | 改判据会同时改变 §12.13 的既有基线数字，须与拆分同批                                                                      |
| prettier 未接入门禁           | #575 第 9 项 | 一次性格式化 600+ 文件是巨型噪声 diff，与 §13.7「禁止无关全文件变更」冲突，须单独立项分路径接入                           |
| `lib` 直读 `process.env` 收口 | #568         | 涉及 `config.ts` 的存废裁决，与 #573 重叠                                                                                 |

## 18.8 速查

- 改 `src/lib/**` 前：先读本章 → 确认没碰 18.2 的禁止项 → 跑 18.5 的两条棘轮。
- `lib` 要共享类型给视图：**下沉类型模块到 `src/lib`**，不要在 lib 里 import components。
- 拆出 Node-only 模块：按 18.4 的表选声明形态，别三个都试。
- 需要新增守卫：**先查既有更强的那一条**（18.4 的判定反模式）。
