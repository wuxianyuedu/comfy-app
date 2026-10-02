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
| 复杂度（函数） | `check-function-length.cjs`                 | 覆盖**已声明的函数 + 无名字的块体**（IIFE / 回调 / 闭包，见 12 §12.13.2）；跨行签名（`React.memo(function …)`）也在射程内                                                                             |
| 视图/逻辑分离  | `check-ui-logic-separation.cjs`             | **不覆盖**：只扫 `src/components/**` 与 `src/app/**`                                                                                                                                                  |
| 客户端安全     | `scripts/lib-node-only-scan.mjs`（用例 `tests/client-bundle-node-builtins.test.ts` / `tests/lib-node-only-declarations.test.ts`） | **覆盖**：从**全 `src/**`** 的 `"use client"` 入口做可达性 DFS，且只在 `server-only` / `.server.ts` 处停（`"use client"` 继续走）—— 判据只有这一份实现，见 §18.13.1 |
| 覆盖率         | `vitest.config.ts` `thresholds`             | `src/lib/**` 已纳入 `include`，但**只给 5 个文件**设了门槛                                                                                                                                            |
| 格式           | prettier                                    | 未接入门禁（全库未过；`src/lib` 178 个）                                                                                                                                                              |

**根因一句话**：门禁是「按目录清单」声明的，而 `src/lib` 不在任何清单里。

## 18.2 lib 的定位（与 §12.1 的关系）

`§12.1` 把 `lib/` 写作「纯工具函数（无 React、无服务端依赖）」—— 那是**理想**，
现状是「跨端逻辑层」：它承载**全平台复用**的逻辑，其中既有纯函数，也有 Node-only
的领域编排（`comfyui/**`、`drizzle-studio/**`）；**只服务端消费**的领域编排收在 `src/server/<domain>/`（见 12 §12.5.2）。

本章明确 `lib/` 的**边界**（比「纯工具」可执行得多）：

| 允许                                            | 禁止                                                     | 判据 / 门禁                                                               |
| ----------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| 纯函数、类型、常量                              | React（`.tsx`、`useState`、JSX）                         | R4 禁 `.tsx`；`check-ui-logic-separation.cjs` H2 禁 `src/lib/**` 用 React |
| 浏览器与服务端共用的逻辑                        | `import` 视图层（`src/components/**`、`src/app/**`）     | `eslint.config.js` 的 `boundaries`：`lib` → `components` 阻断（18.3）     |
| Node-only 领域编排（须声明，见 18.4）           | 反向依赖：被 `lib` 依赖的模块再回头依赖 `lib` 之外的视图 | 同上 + 规范 §12.7（循环依赖预防）                                         |
| 网络客户端（`<domain>-client.ts`，§17.2 第②层） | 直接读 `process.env`（应收口，见 ISSUE #568）            | 本批次登记项，尚无机器判据                                                |
| 子域目录（`lib/<domain>/**`）                    | 根目录散放普通模块（只有顶层单例可在根，见 §18.14）      | R13′ / R14（`check-file-structure.cjs`，§12.5.3）                          |

> **为什么 lib 不得 import components**：`lib` 是被 `components` / `app` / `server`
> 共同依赖的**地基**。地基反过来引视图，会让「谁在最底层」变成循环，也让 lib 模块
> 无法脱离 React 树单测。需要共享的类型要**下沉到 `src/lib` 下的类型模块**
> （本项目实例：`src/lib/workflow/workflow-io-types.ts`）。

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
| 两者都不加             | **纯 Node 宿主**模块：不经 Next 打包，由 `scripts/*.mjs` 等高动态加载            | `src/lib/process/kill-process-tree.ts`                                             |

> **为什么 `kill-process-tree.ts` 不能加 `server-only`**：它由 `scripts/reap-process.mjs`
> 与 `scripts/dev-launcher.mjs` 在**纯 Node**（`tsx` 运行时）下动态 import。
> `server-only` 的入口文件就是一句 `throw`（只在 Next 的 `react-server` 条件下才
> 解析到空模块），加上它会让**启动编排直接崩**。这类模块的守卫是它自己的宿主边界，
> 不是 `server-only`。

**机器判据（ISSUE #572 第 1 项落地）**：`scripts/lib-node-only-scan.mjs`
（跨平台入口 `node scripts/lib-node-only-scan.mjs`，契约测试
`tests/lib-node-only-declarations.test.ts`，接入 pre-commit 与 CI）。它判三件事：

| 判据             | 形态                                                   | 为什么必须走依赖图                                               |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| **声明缺失**     | `src/lib/**` 顶层 import Node 内建却没有声明           | 纯文本可判，但缺了下面两条就只是形式                             |
| **假声明**       | 声明为服务端物，却仍被 `"use client"` 可达的纯模块引到 | 声明**没生效**，出事时没人会怀疑它（`log-session-scope` 的形态） |
| **真进浏览器图** | 纯模块被 `"use client"` 入口引到且顶层有 Node 内建     | Turbopack 报 `does not support external modules`，**整页 500**   |

扫到就要求 `server-only` 的纯文本判据**行不通**：`eslint-plugin-boundaries` 的 import
图对服务端源码**完全不采样**（实测：给 `src/lib/log-paths.ts` 加
`import "server-only"` 后 `pnpm lint` 仍绿），而第三类（纯 Node 宿主）本来就不该带
`server-only` —— 它的入口是一句 `throw`，加上去 `scripts/*.mjs` 的启动编排直接崩。

> **判定反模式（保留）**：别给「顶层 import Node 内建的 `src/lib` 模块」再写一份
> 「检查有没有 `server-only`」的**纯文本**脚本 —— 它既会误伤第三类，又会与
> `tests/client-bundle-node-builtins.test.ts` 形成两份各自漂移的判据。
> 新增守卫前**先查是否已有更强的那一条**，要补就补在同一个扫描器里。
>
> **扫描范围刻意只到 `src/lib/**`**：`src/app/api/**` 与 `src/server/**` 本来就
> 是服务端物，顶层 `import fs` 是这个位置的定义。给它们逐个补 `server-only` 会把
> 「本来就是」写成仪式文字，而**仪式化的声明会稀释真的那个** —— 当每个文件都带这行时，
> 真正漏掉的那次没人看得出来。

## 18.4.1 三分类落地后的现状（ISSUE #572）

按 §18.4 的规则对齐后，`src/lib/**` 内的 58 个「顶层 import Node 内建」模块分布如下：

| 形态                                     | 数量 | 例                                                                                                                                                                              |
| ---------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import "server-only"`                   | 53   | `comfyui/**` 执行链、`drizzle-studio/lifecycle.ts`、`log-paths.ts`、`envfile.ts`、`materials.ts`                                                        |
| `.server.ts` 后缀                        | 5    | `log-session-scope.server.ts`、`capture-streams.server.ts`、`app-settings/app-settings.server.ts`、`workshop/{api-channel,generation-log,media-source,mode-contract}.server.ts` |
| 两者都不加（纯 Node 宿主，**显式登记**） | 2    | `kill-process-tree.ts`（`scripts/*.mjs` 动态加载）、`llm/secrets.ts`（MCP 宿主与 Next 共用同一份密文实现）                                                                      |

第三类的登记**不是豁免清单**：`tests/lib-node-only-declarations.test.ts` 会反向核对
「登记项现在仍然没有声明」——某天它补上了 `server-only`，登记项必须跟着删掉，
否则清单里会躺着一条已失效的条目（这类清单只许定义一次，见 §18.4 的判定反模式）。

## 18.5 文件与函数长度棘轮（R5 + §12.13）

`src/lib` 的历史大文件由两条棘轮约束，**都只许降不许升**：

| 维度     | 门禁                          | 阈值                                   | 基线                                     |
| -------- | ----------------------------- | -------------------------------------- | ---------------------------------------- |
| 文件行数 | `check-file-structure.cjs` R5 | 900 行                                 | `scripts/.file-size-baseline.json`       |
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

`vitest.config.ts` 的 `thresholds` 此前只给 `src/lib/comfyui` 的 4 个文件与
`src/server/api/middleware` 设了门槛，`src/lib` 其余**零门槛**。现已按下表补齐
（ISSUE #572 第 5 项落地；数值 = 实测值向下取整到 5 的倍数）：

| 目录                        | lines | functions | statements | branches | 实测 trend                                                                                                                    |
| --------------------------- | ----- | --------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/agent/**`          | 80    | 80        | 75         | 70       | 77.96 / 82.6 / 81.26（三条从未覆盖的用户路径补上用例后从 18.9 抬起，见 §18.13）                                             |
| `src/lib/core/**`           | 95    | 95        | 90         | 90       | 96.9 / 96.5 / 94.8（仓储层 12 个模块接内存 SQLite 真库用例后从 42.7 抬起，见 §18.12；barrel / 基类收口后门槛再抬一次，见 §18.8） |
| `src/lib/drizzle-studio/**` | 40    | 35        | 35         | 35       | 41.1 / 37.2 / 39.1                                                                                                            |
| `src/lib/film/**`           | 100   | 90        | 100        | 90       | 100 / 100 / 100（编排迁到 `src/server/film/**` 后本目录只剩纯函数，见 §18.13）                                                |
| `src/lib/llm/**`            | 90    | 85        | 90         | 85       | 97.5 / 96.6 / 89.7（`server.ts` 唯一 LLM 出口与 `usage-test.server.ts` 从 0 覆盖接入用例后，从 55.3 再次抬起）              |
| `src/lib/markdown/**`       | 95    | 100       | 95         | 90       | 95.9 / 100 / 97.6 / 91.7（ISSUE #1329 新建域，门槛与域**同批**登记，见 §18.15。未满 100 的只有 lines：`styles.ts` 的标签表里有几个本仓库目前不产生的标签） |
| `src/lib/project-canvas/**` | 70    | 70        | 65         | 50       | 69.0 / 70.8 / 53.8                                                                                                            |
| `src/lib/workshop/**`       | 65    | 70        | 65         | 55       | 65.8 / 70.3 / 59.3                                                                                                            |
| `src/server/film/**`        | 30    | 50        | 35         | 25       | 34.4 / 53.3 / 35.1（**首次**纳入 `coverage.include`，此前整块服务端编排零门槛，见 §18.13）                                     |

落地口径（与 §11.7 的覆盖率棘轮一致）：

1. 先用 `pnpm test:coverage` 拿到子域**实测值**；
2. 按实测值设门槛，**不设理想值**（设高了会让无关提交变红，设低了等于没设）；
3. 之后只升不降。

> 本条的落地与测试补充绑定（见 ISSUE #575 的登记项）：门槛值必须来自真实测试覆盖，
> 不能先写数字再补测试。
>
> **「先设 0」不是终点**：`drizzle-studio` 起初实测全 0，只能先设 0（设非零会让主线
> 立刻红），但补上测试的那一次提交**必须同批把它抬到实测值** —— 补了测试却不抬门槛，
> 等于下一轮改动悄悄把它降回去也没人知道。本轮 `drizzle-studio` 0 → 40、`film`
> 5/10/5/5 → 40/55/40/30、`core` 35/30/35/30 → 40/35/40/35。

## 18.7 登记项：本章尚未机器化的部分

审查发现的其余缺口**已登记为独立 Issue**，不在此处「顺手重构」：

| 缺口                                                                                                    | Issue          | 为什么不在本章落地                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`lib` 内循环依赖无判据~~                                                                              | #574           | **已落地**：`scripts/check-circular-deps.cjs` + 棘轮基线（见 §12.7），`src/lib` 实到 2 组环已消除                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ~~`lib` → `server` 越界无判据~~                                                                         | #569 第 6 项   | **已落地且清单归零**：依赖逐个登记 + 「登记清单不许失效」双向判定（见 18.10）；日志那 10 条边在 18.10.1 归零，最后一条 `auth-server` 在 18.10.2 归零（会话改由调用方注入）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ~~零调用导出无判据~~                                                                                   | #573           | **已落地且基线归零**：`scripts/check-dead-exports.cjs` 按**符号**记账（只认值导出，棘轮只许降不许升），扫描范围 `src/lib` + `src/trpc`，消费方口径显式含「模块自己的测试文件」（见 12 §12.16）；34 条登记项按 §12.15 逐条复核后接线 3 / 删除 31，基线 `34 → 0`。清单为空之后靠 `--verify` 单条复核自证判据在工作                                                                                                                                                                                                                                                                                                                                                                                                             |
| ~~客户端可达图判据有两份实现、各差一块盲区~~                                                            | #569 第 2 项   | **已落地**：合并进 `scripts/lib-node-only-scan.mjs`（`reach()` 只在 `server-only` / `.server.ts` 处停），`client-bundle-node-builtins.test.ts` 改为消费它的 JSON + 两条真注入反向验证，见 §18.13.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ~~`film/orchestrator.ts`（只服务端消费的编排）留在 `lib/`~~                                             | #572 第 2 项   | **已落地**：迁到 `src/server/film/orchestrator.ts`（与 `server/workshop/orchestrator.ts` 同落点）；`src/server/film/**` 首次纳入 `coverage.include`，见 12 §12.5.2 与 §18.13.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ~~`lib/llm/**` 后缀「四套并存」~~                                                                       | #572 第 3 项   | **已核销**：按 §18.4 逐文件复核后四种各有归属（`server-only` / `.server.ts` / `"use client"` / 纯 Node 宿主登记），`<domain>/server.ts` + `<domain>/client.ts` 是领域入口对，见 §18.13.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~`IIFE` / 回调体不计函数长度~~                                                                         | #570 第 7–8 项 | **已落地**：判据纳入无名字块体 + 跨行签名（12 §12.13.2），基线按「判据版本」一次性重记（20 → 22，新增的 2 条为存量登记）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ~~`lib` 巨型函数未拆（`ensureComfyUiReady` / `executeViaComfyCli` / `cacheJson` 闭包 / drizzle IIFE）~~ | #570 第 1–6 项 | **已落地**：等待循环与事件回调抽成 `comfyui/lifecycle-wait.ts`（策略注入 + 具名纯函数）、comfy-cli 流解析收在 `comfyui/executor-cli-stream.ts`、`cacheJson` 闭包提为 `buildWorkflowDetailJson`、drizzle IIFE 复用同一套等待原语；基线随之收紧（22 → 20，见 12 §12.13）                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~`lib` 的 Node-only 声明与可达性无判据~~                                                               | #572 第 1 项   | **已落地**：`scripts/lib-node-only-scan.mjs` + `tests/lib-node-only-declarations.test.ts`（声明缺失 / 假声明 / 真进浏览器图 三条判据），`src/lib` 内 58 个 Node 内建 import 全部声明完毕                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ~~`lib` 子域覆盖率零门槛~~                                                                              | #572 第 5 项   | **已落地**：`vitest.config.ts` 增加 `src/lib/{agent,core,drizzle-studio,film,llm,project-canvas,workshop}/**` 七条门槛，取实测值向下取整到 5 的倍数、只升不降（§18.6）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~`app-settings.ts` 混装「纯派生 + fs IO + 默认端口再导出」~~                                           | #569 第 5 项   | **已落地**：拆成 `app-settings/index.ts`（纯）+ `app-settings/app-settings.server.ts`（IO），默认端口的唯一出口回到 `@/lib/endpoints`；端口门禁改为**反向**断言「app-settings 不得再转手该常量」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ~~prettier 未接入门禁~~                                                                                 | #575 第 9 项   | **已落地**：改为**格式棘轮**（`scripts/check-format.cjs`，基线 576 个文件只许下降）+ 「格式化提交与行为改动分离」（`scripts/check-reformat-only.cjs`）。分路径 = 白名单按 glob 表达（`scripts/` `tests/` `e2e/` 与根级配置豁免），见 13 §13.5.1 / §13.5.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `lib` 直读 `process.env` 收口                                                                           | #568           | **已裁决**：不收口，改为删掉 `config.ts` 的误导性承诺（见 18.8）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **`llm/browser.ts` 的 3 处现存缺陷**                                                                    | 本轮回报       | **补测试时实测发现、本批不改源码**（「补测试」与「改行为」必须分开，否则无法判断行为变化来自哪一侧）：① SSE `error` 帧被静默吞掉 —— `json.error` 抛出的 Error 被同一个 `catch` 重新接住，而该 `catch` 只在消息命中 `/LLM\|请求\|fetch/i` 时才 rethrow，于是「上游鉴权失败」这类文案被丢弃、`"前半"` 作为**正常回答**返回（用户看到「答到一半就没了」且界面上无报错）；② 末帧缺 `\n` 时整条丢弃 —— 读取循环 `break` 后再未冲刷 `buffer`；③ `core/config` 的 `REAPER_ENABLED=false` **无法关闭** reaper —— `z.coerce.boolean()` 等价 `Boolean(value)`，而 `Boolean("false") === true`，它按 JS 真值而非环境变量布尔字面量解析，且没有任何提示。三条都由 `src/lib/llm/browser.test.ts` / `src/lib/core/config.test.ts` 钉住现状，修复另开条目。 |
| ~~`drizzle-studio/**` 覆盖率 0~~                                                                        | #572 第 5 项   | **已落地**：`lifecycle` 的探测 / 定位 / 启停判决进用例，目录 0% → 41%，门槛随之从 0 抬到 40（见 18.6）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ~~`film/**` 只有两个纯函数文件被覆盖~~                                                                  | #572 第 5 项   | **已落地**：编排判决面（取消撤任务 / 合成前置条件 / 镜头参数与画幅折算）进用例，7.5% → 40%，门槛从 5 抬到 40（见 18.6）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ~~`core/**` / `llm/**` 覆盖率停在 42.7 / 55.3~~                                                          | #565 覆盖率爬坡 | **已落地**：仓储层 12 个模块接入**内存 SQLite 真库夹具**（§18.11），LLM 的 `server.ts` 与 `usage-test.server.ts` 两个零覆盖模块补上用例；`core` 42.7 → 94.6、`llm` 55.3 → 97.5，门槛同步抬到 90（见 18.6）。补测试过程实测出 3 处真缺陷（分页丢 LIMIT / LEFT JOIN 下 count(*) / 错误文案重复状态码），已在本轮修掉 |

## 18.8 core 骨架的取用口径（ISSUE #568）

`src/lib/core/**` 是 18.3 里被声明为 element `server` 的那部分（架构基座）。它的
三处「唯一事实源」曾经都只是注释里的承诺，现在各有机器判据：

| 关注点   | 现状                                                                     | 机器判据                                                                                                      |
| -------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 日志     | `core/logger.ts` 是 pino 的**薄封装**（只有一条通道）                    | `tests/single-logger-channel.test.ts`（服务端库代码禁直接 `console.*`）                                       |
| 仓储取用 | **只有一种**：直接 `import { xRepository } from "@/lib/core/repository"` | `tests/container-single-access.test.ts`（`src/` 内禁 `container.resolve(`）                                   |
| 配置     | `core/config.ts` 是**类型契约 + 默认值**，不承诺「集中配置」             | `tests/core-spine-single-source.test.ts`（禁承诺句式；默认值必须取自 `CONFIG_ENV_DEFAULTS` / `endpoints.ts`） |

三条判据都已接入 `.githooks/pre-commit` 的 **C 组固定清单**（`tests/single-logger-channel.test.ts`、`tests/container-single-access.test.ts`、`tests/core-spine-single-source.test.ts` 三份用例，见 §13.5.8）；原平台流水线同名的 `Core spine single source` 那一步已随 ISSUE #623 删除。

**另外两处「注释与现状相反」也已收口**（ISSUE #565，pre-commit 的 **C 组固定清单** / 流水线同名那一步已删
`Core barrel & repository base discipline`，详细口径见 §12.17）：

| 位置                      | 曾经的注释承诺                              | 现状与判据                                                                                         |
| ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `core/index.ts`（barrel） | 「所有 server 端模块统一从这里 import」      | 实测只有 2 处这样导入，口径是**深路径**；改为具名转发，禁 `export *`，转出符号必须有消费方           |
| `core/repository-base.ts` | （无承诺，但 `create` 里真的打了一条日志）   | 基类不做横切：不引日志实现、不引上层，留痕由**子类按语义**记（`tests/repository-base-purity.test.ts`） |

`core/index.ts` 为什么不许 `export *` 还有一个结构性理由：`core/logger` 依赖同层的
`lib/app-runtime-log` → `lib/log-paths`，若 `log-paths` 从 barrel 取用就形成
`index → logger → … → index` —— 而 §12.7 的环检测只认**真实存在的边**，抓不到这种
「一写就成环」的潜在组合（回归测试用合成图把它钉住）。

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

| 形态                                                                             | 例                                                                     | 处置                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------- |
| **数据层同层引用**（`lib/core/**`、`lib/db/**` 在 18.3 里就是 element `server`） | `lib/core/repository-task.ts` → `~/server/db/schema`（Drizzle 表定义） | 合法，不入清单               |
| **测试里与源码串一致的 mock**                                                    | `vi.mock("~/server/lib/logger")`                                       | 跟着源码一起改，不单独设判据 |
| **越界依赖**                                                                     | `lib/comfyui/client.ts` → `~/server/lib/logger`                        | **逐个登记，清单只许变短**   |

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

**这批日志边怎么消除的**：`lib` 侧的统一出口是 `@/lib/core/logger`（接口
`debug/info/warn/error/child` 逐字一致、调用方零改动，按 18.4 第三类**不带**
`server-only`，因为它被纯 Node 宿主与 Next 同时加载）。但只改 import 是把同一条边
换个写法 —— 当时 `core/logger` 自身仍 import `server/lib/logger`。真正的消除要动
**实现的归属**，见 18.10.1。

> 最后一条（`lib/auth-server.ts` → `~/server/better-auth/server`）也已消除，做法是
> **消息与判决分离**，见 18.10.2。**登记清单现在是空的** —— 这正是终态：`src/lib`
> 里任何新增的 `lib → server` 边都必须先裁决，而不是「反正有一条已登记」。

### 18.10.1 日志那一批登记边已归零：实现合并到地基侧

18.10 里的 11 条 `lib → server/lib/logger` 边**已全部消除**，做法不是「逐条改
import」—— 那只是把同一条边换个写法（`core/logger` 当时仍是 `server/lib/logger` 的
薄封装，两处实现、一份转发）。真正消除它要动的是**实现的归属**：

| 项                            | 之前                                                                                | 现在                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 实现处                        | `src/server/lib/logger.ts`（pino 工厂 / `REDACT_PATHS` / ERROR 镜像 / pretty 输出） | `src/lib/core/logger.ts`                                    |
| `src/server/lib/logger.ts`    | 实现本身                                                                            | **转发层**（re-export，既有导入路径与用法逐字不变）         |
| `lib` 侧取用                  | `import { logger } from "~/server/lib/logger"`（10 个模块）                         | `import { logger } from "~/lib/core/logger"`（`lib → lib`） |
| `lib-server-imports` 登记清单 | 11 条（10 源码 + 7 处测试 mock 说明符合并计数）                                     | **1 条**（`auth-server.ts`，Next 请求上下文，无法下沉）     |

**为什么实现落在 `lib/` 而不是 `server/`**：`lib` 是被 `server` / `components` /
`app` 共同依赖的地基，而日志是横切关注点。放在 `server/` 会让地基反向依赖上层，
`lib` 侧每一处要写日志的模块都只能越界（这正是那 11 条边存在的原因）；实现落在
`lib/core` 后方向天然正确。

**为什么 `core/logger.ts` 不带 `server-only`**：它被 Next 服务端与纯 Node 宿主同时
加载，而 `server-only` 的入口就是一句 `throw` —— 加上去 `scripts/*.mjs` 的启动编排
直接崩（18.4 第三类，`tests/lib-node-only-declarations.test.ts` 会核）。

**防回潮**：`tests/single-logger-channel.test.ts` 的判据从「core/logger 是不是薄封装」
改成**实现特征**——全 `src/**` 里 `import pino` 的文件只允许一个
（`src/lib/core/logger.ts`）。谁再建第二条通道，那条断言立刻红；「谁是实现处」不再
依赖文件名或注释，而是靠「谁在 import pino」这个事实。

### 18.10.2 最后一条边怎么消除：会话从「自己取」改成「调用方注入」

`lib/auth-server.ts` 的越界与日志那批**性质不同**，值得单列 —— 它把「分层」和
「可观察性」两件事绑在了一起。

**这条边挡住的不只是分层，还有测试。** `getSession` 内部是 `await headers()`，
脱离 Next 请求上下文直接抛：

```text
Error: `headers` was called outside a request scope.
       https://nextjs.org/docs/messages/next-dynamic-api-wrong-context
```

于是 `lib/auth-server.ts` 里那套「已登录取真实用户 / 未登录回落演示用户 /
`loginRequired` 是唯一开关」的判决**一直写不出用例**：任何调用都会撞上上面这条
错误（这不是 mock 能绕的 —— 它发生在 `getSession` 内部，早于任何返回值）。

**改法是「消息与判决分离」**，四步：

| 项                  | 之前                                                              | 现在                                                                        |
| ------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `lib/auth-server.ts` | 自己 `import { getSession }`，判决与取会话混在一起                 | 只做**判决**：`getServerUser(session)` / `requireServerUser(session)` 会话入参 |
| 读会话的落点         | `lib/auth-server.ts`（越界）                                       | `src/server/auth/request-user.ts`（`src/server/**` 本来就是服务端物）        |
| REST route 取用      | `from "~/lib/auth-server"` 调 `requireServerUser()`                | `from "~/server/auth/request-user"` 调 `requireRequestUser()`（24 处）        |
| `lib-server-imports` 登记清单 | 1 条                                                      | **0 条**                                                                     |

**为什么不让 `lib/auth-server` 收 `headers` 参数**：那样 24 个 REST route 每处都要
写一遍 `new Headers(await headers())`，等于把 Next 依赖摊回每一个路由；而 `getSession`
内部已经 `await headers()` 且带 React `cache()`（同一次请求内去重），照旧复用它最省。
所以分界划在「**谁碰请求上下文**」而不是「谁碰 headers 对象」。

**顺带实测出一处真缺陷（已修）：演示用户缓存**越过**了数据库。** 原实现把解析结果
记在模块级变量里，命中即返回、**不再查库**：

```text
第 1 次调用 id = wmnmuzub…（建行）→ 用户表被重建（drizzle-kit push 的 __new_X 流程，
见 scripts/heal-db.cjs）→ 再调用仍返回 wmnmuzub…，而库里 0 行
```

返回一个**库里不存在**的 id，下游每处按 userId 写入（任务 / 工作流 / 素材）都会
外键失败或留下孤儿行，而报错指向写入语句，看不出「这个用户是虚构的」。现在 memo
的只是 **email**、实体每行都查库 —— 命中路径同样只有一次 `findByEmail`，而
「缓存里有没有」不再与「库里有没有」分叉。判据在 `src/lib/auth-server.test.ts`
（清空表后必须返回**库里真实存在**的 id，而不是「和上次一样」）。

> 通用口径：**缓存的键可以记，缓存的值要能被证伪。** 记「用哪个 email」是配置，
> 记「解析出来的 id」是数据 —— 配置不会变，数据会被重建、被删、被迁移。

## 18.11 仓储层怎么测：内存 SQLite 真库夹具（ISSUE #565）

`src/lib/core/**` 此前实测 42.7% 行覆盖，而分母被 12 个 `repository-*.ts` 主导 ——
它们是**全库唯一的 SQL 出口**，却一个用例都没有。补法有两个错误选项：

- **逐个 mock `db`**：断言的是「调了 `select().from(task)`」而不是「SQL 真的对」。
  这一层的缺陷全在 SQL 语义上（`count(列)` vs `count(*)`、`onConflictDoUpdate`
  的 target 必须真的存在 UNIQUE 约束、`and()` 里 `undefined` 的短路、JSON 列的
  加解密顺序），mock 到不了这些。
- **要求测试自己建 `db.sqlite`**：CI 上干净检出没有库，测试会互相污染真实数据。

采用的做法是 `tests/helpers/test-db.ts` 的**内存 SQLite + 真 Drizzle**：
`vi.mock("~/server/db")` 只把 `db` 换成 `new Database(":memory:")` 上的实例，
仓储代码一行不改。代价是要**手工维护一份建表 DDL**，因此有两条硬要求：

1. **DDL 必须与 `schema.ts` 对齐**，包括**唯一索引**。漏了索引不会在启动时报错，
   只会在第一次跑到 `onConflictDoUpdate` 时抛
   `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`
   —— 那时报错指向的是 upsert 语句，看不出是夹具缺东西。
2. **`$tables` 断言要读原始行**。「写进去的密钥是密文」这类结论**不能**用「读出来
   是明文」证明 —— 那只证明了读路径，证明不了落盘不是明文。

补测试的这一轮实测出 3 处真缺陷（都已修）。它们的共同点是
**只在「真 SQL + 真约束 + 真数据形状」下才暴露**，mock 一辈子也测不出来。

| 缺陷 | 症状 | 修法 |
| --- | --- | --- |
| `TaskRepository.listByUser` 只给 `skip` 不给 `take` | 生成 `… offset ?`（SQLite 的 `OFFSET` 必须跟在 `LIMIT` 后）→ better-sqlite3 抛 `near "offset": syntax error`，调用方拿到一次 500 而不是「第二页」 | 补 `LIMIT -1`。**注意 drizzle 的坑**：`offset()` 会把链上的数字 `limit` **整个丢掉**（`limit(-1).offset(n)` 生成的 SQL 里没有 limit），必须传 `sql\`-1\`` 片段；relational query（`db.query.*.findMany`）更彻底 —— `limit: -1` 直接被忽略，所以「只给 skip」那条路改成「普通 select 取页 + 按 id 装载关联」 |
| `FilmRepository.listByUser` 用 `count()` 配 `leftJoin` | 一个镜头都没有的成片被数成 **1 镜**（`COUNT(*)` 把 NULL 行也算了）—— 而 `film.list` 是 UI **唯一**拿到镜头数的地方 | 改 `count(filmShot.id)`。同一个坑在 `repository-model-tag.ts` 已踩过并留了注释，说明注释拦不住第二次 —— 判据是这回把它钉进了用例 |
| `usage-test.server.ts` 非 JSON 失败体 | 上游返回 HTML 错误页 / 纯文本 502 时，提示拼成 **`HTTP 503：HTTP 503`**：状态码说两遍，框架写的真实原因一个字都没带上 | `httpFailureDetail` 增加 `rawText` 入参，错误分支读一次响应文本并截断 240 字符带出 |

> 另一条不算缺陷但值得记：`listByUser` 的**两条分页分支**（普通 select 与
> relational query）此前口径不一致，且后者根本无法表达「不限条数只跳过」。
> 现在两条路都产出「同一页 + 同一份 images」，并且用例把两**条**路都覆盖了 ——
> 只测一条会让人以为另一条也对。

## 18.13 本批（ISSUE #569 第 2 项 / #572 第 2–3 项）的落地记录

### 18.13.1 判据只许有一份：客户端可达图的两份实现合并（#569 第 2 项）

`client-bundle-node-builtins.test.ts`（ISSUE #317 的 P0 回归）与
`scripts/lib-node-only-scan.mjs`（§18.4 的实现）各自把同一件事实现了一遍 ——
「哪些算 Node 内建 / 怎么解析 import / 从哪几个入口做 DFS」。两者都在测试链里跑，
谁也没发现对方，因为**它们的盲区不一样**（实测）：

| 实现 | 入口集 | 遍历边界 | 盲区 |
| --- | --- | --- | --- |
| 旧 `.test.ts` | `src/app` + `src/components` 里的 `"use client"` | **穿过**任何声明 | `src/lib` / `src/trpc` 下的 4 个 `"use client"` 入口看不见 |
| 旧 `scan.mjs` | 全 `src/**` 的 `"use client"` | 停在**任何**声明 | `"use client"` 不是服务端边界，停在它 ⇒ 只从它可达的模块看不见 |

后者不是理论：`src/trpc/query-client.ts` **只**从 `src/trpc/react.tsx`（`"use client"`）
可达 —— 把 Node 内建注进它，旧扫描器报「客户端可达 0」，旧用例报命中。两份判据互相
补盲，谁也不包含谁。

修法是**合并成一份**（§18.4 的判定反模式：新增守卫前先查是否已有更强的那一条，要补就
补在同一个扫描器里）：

- `scan.mjs` 的 `reach()` 改为只在 `server-only` / `.server.ts` 处停
  （`isServerBoundary`），`"use client"` 继续走 —— 它是**同一张客户端图里的节点**，
  不是边界；
- `client-bundle-node-builtins.test.ts` 改为**消费** `scan.mjs --json`，不再自带
  解析器；保留 `log-session-scope` 分层那条历史回归，并新增两条**真注入**的反向验证：
  ① 把 Node 内建注进 `src/lib/shell-tabs-store.ts`（app/components 外的入口）必须命中；
  ② 注进 `src/trpc/query-client.ts`（只从 `"use client"` 模块可达）必须命中。

> 一句话：**判据的「入口集」与「边界」是两件事，别用一个实现名同时回答它们。**
> 合并后扫描器才是那份唯一实现，用例只喂它输入、断言它的输出。

### 18.13.2 只服务端消费的领域编排迁出 `lib/`（#572 第 2 项）

`lib/film/orchestrator.ts`（724 行，`server-only`）的唯一消费方是
`server/api/routers/film.ts` —— 没有任何跨端复用。它迁到 **`src/server/film/orchestrator.ts`**，
与既有 `src/server/workshop/orchestrator.ts`（工坊服务端流水线）对齐；判据与反例
见 12 §12.5.2。

迁移的连带处理（都是必须做的，否则门禁会指着无关的地方）：

- 4 处动态 import 说明符改为 `~/server/film/orchestrator`；测试迁到
  `src/server/film/orchestrator.test.ts`（`film-size` 由相对路径改引 `~/lib/film/film-size`）；
- `src/server/film/**` **首次**纳入 `coverage.include` —— 此前整块服务端编排
  **零门槛**，这是「盲区是漏出来的、不是写出来的」的又一例；
- `src/lib/film/**` 只剩纯函数，门槛从 39 抬到 100（§18.6）。

### 18.13.3 `lib/llm/` 的「后缀四套并存」已不成立（#572 第 3 项）

#572 当时记录 `llm/` 里 `server.ts` / `browser.ts` / `*-client.ts` / `*.server.ts`
四套命名并存。按 §18.4 复核后，这四种各有其归属、**并不违反规则**：

| 文件 | 形态 | §18.4 分类 |
| --- | --- | --- |
| `llm/server.ts`、`llm/video-task-util.ts` | `import "server-only"` | 第一类（全部出口只能服务端用） |
| `llm/usage-test.server.ts` | `.server.ts` | 第二类（同领域的服务端拆件） |
| `llm/browser.ts` | `"use client"` | 客户端侧 |
| `llm/secrets.ts` | 无声明 | 第三类（纯 Node 宿主，已登记 —— MCP 与 Next 共用） |

`<domain>/server.ts` + `<domain>/client.ts`（`agent/`、`comfyui/` 同形）是**领域入口对**，
不是「后缀并存」。因此本条**无需改动**，登记为「已按 §18.4 对齐」。

### 18.13.4 覆盖率爬坡：`lib/agent` 18.9 → 78（#565 持续项）

补的是**判决面**，不是凑行数：

- `agentic.ts`（0 → 100）：多轮引导的离线状态机四态（空历史 / 没说类型 / 信息不足 /
  出方案）与 LLM 路径的「模型返回畸形 JSON / 空回复 / 自称 ready 却缺 spec」处置；
- `client.ts`（0 → 100）：坏 `tool_call` 过滤（**空 id 会让执行层按 id 回传结果时串台**）、
  非 2xx 错误信封解包、响应体不是 JSON 时的不炸路径；
- `server.ts`（0 → 97.8）：两条协议（tools / JSON 指令回退）的选路、
  「`action` 未登记就不交给执行层」的闸门、消息窄化（调用方伪造 `system` 被丢弃）。

补测试时实测出 3 处**只登记不改**的现状（`agent/client.ts` 的数组体当成合法对象、
`agent/server.ts` 的 `done` 分支不可达、`agent/executor.ts` 的模型内重名不去重）——
「补测试」与「改行为」分开提交，否则说不清行为变化来自哪一侧。

## 18.14 子域归属是门禁，不是目录审美（ISSUE #565）

18.1 说 `src/lib` 曾是「四类门禁同时失效」的盲区。**域归属**是同一盲区的另一半，
只是它靠「门禁是按目录清单声明的」这条机制渗出来的：覆盖率门槛按 `lib/<domain>/**`
设（18.6），Node-only 声明按域记账（18.4），而**根目录压根不是一个域** ——
它是一堆文件。

所以这条不是「把文件摆整齐」，是**把上面两条门禁的记账单位补齐**：模块在根目录
时，18.6 的门槛和 18.4 的登记都挂不到它身上。

| 编号 | 判据 | 承担者 |
| --- | --- | --- |
| **R13′** | `src/lib` 根目录只放**顶层单例**（`DOMAIN_EXEMPT`），其余 `.ts` 必须有子域目录 | `scripts/check-file-structure.cjs` |
| **R14** | 子域目录名必须在 `DOMAINS` 里登记 | 同上 |

完整口径（含「顶层单例」的判别、迁移的连带检查、一次真实搬迁的记录）在
[12 §12.5.3](12-代码组织与文件结构.md#1253-src-lib-的子域纪律与登记issue-565--580机器强制)，
这里只说三条**为什么这样定**：

**① 为什么不判「嵌套深度」**。看起来「叶子域不许再嵌套」是一条更整齐的判据，
但它会立刻在两个地方失效：`comfyui/**` 与 `workshop/**` 自有子结构（执行链 / 通道），
`core/**` 的平铺是「一个仓储一个文件」的刻意形态。机器判深度只会逼出 `admin/`
这类**既说不出归属、又恰好绕过判据**的目录。判据只做两件能机器回答的事：
「根目录有没有不该有的模块」（R13′）与「这个目录名登记过吗」（R14）。

**② 为什么 R14 不是冗余**（它是让 R13′ 真正生效的那一半）。没有 R14，
`mkdir src/lib/stuff && git mv …` 就自动绕过 R13′ —— 文件换个新目录名继续平铺，
而新目录在 `vitest.config.ts` 里**没有任何门槛**（覆盖率默认 0 门槛）。R14 把
「新增域」变回一次设计决定：登记的同时必须给出门槛值。

**③ 为什么豁免清单要写成 `DOMAIN_EXEMPT` 而不是注释**。18.4 的判定反模式在这里
同样适用：**会静默失效的清单只许定义一次**。豁免项写进注释，判据读不到它，
下一个人照着「看一眼」的方式加模块，清单会与事实分叉且不报警。写成数据后，
「这个模块为什么在根目录」有一个可机读的答案，新增一项就是一次显式编辑。

> 与 18.10 / 18.6 的关系：本条**不改**依赖方向，也不改门槛值本身。它改的是
> 「门槛能挂到谁身上」——根目录的模块此前**同时**逃开了 18.6 的覆盖率记账与
> 18.4 的域级声明核对，这正是「盲区是漏出来的、不是写出来的」的又一例（§18.13.2）。

## 18.15 安全敏感的渲染器换库：`markdown` 域的由来（ISSUE #1329）

`src/lib/comfyui/markdown.ts`（384 行）是一套**自研 markdown 渲染器**：手写
「整串 HTML 转义 → 按自己认得的语法拼回标签 → `href` 过 URL scheme 白名单」。
它的输出直进 `dangerouslySetInnerHTML`，因此它实际上是**唯一**挡在用户内容与 DOM
之间的东西。迁到 `marked` + `DOMPurify` 之后成了 `src/lib/markdown/**`。

**三件与「换了个库」无关、但值得记下来的事**：

**① 它是安全边界，而自研白名单天然是「加一个语法多一个绕过面」。** 每加一种语法
就多一处需要重新论证「这次转义是否完整」的表面积，而 `marked` + `DOMPurify` 是被
反复审计、按浏览器解析器**真实行为**做决定的组合。文件头当时把「图片、脚注、HTML
透传、子列表、对齐」列在范围之外 —— 等于**同时欠着功能 + 欠着安全**。

**② 白名单必须是「本仓库的那一份」，不能把 DOMPurify 的默认口径当成本仓库需要的。**
实测三处差异，逐条有理由（见 `sanitize-config.ts`）：

| 关注点   | DOMPurify 默认                                    | 本仓库                              | 为什么                                                                        |
| -------- | ------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| 基表     | 全表（含 SVG / MathML / `template`）              | `USE_PROFILES: { html: true }`      | 便签与剧本预览不需要它们，而它们恰是历史绕过面                                |
| 表单     | 放行 `<form>` / `<button>`                        | `FORBID_TAGS` 收掉，`<input>` 保留  | 用户内容里出现表单只有钓鱼一个用途；`<input>` 是 GFM 任务列表要的             |
| 自带样式 | 放行 `style`                                      | `FORBID_ATTR` 收掉                  | `position:fixed` 能盖住整个应用、`background:url(…)` 能渲染时外带请求          |
| URL 协议 | 拦 `href` 上的 `data:`，**放行 `src` 上的 `data:`** | 自建协议白名单，钩子挂在剪枝之后    | `src="data:image/svg+xml,…"` 里的 SVG **可以带脚本** —— 图片成了执行通道       |

最后一行是**默认口径的真缺口**、不是「多余的一层」：实测把这条钩子去掉，用例立刻红。

**③ 域名与它的消费方无关。** 它落在 `comfyui/` 只是因为第一个消费方是 ComfyUI
便签；第二个（剧本预览）与第三个（工坊剧本区）每次取用它都要**反向依赖 ComfyUI 域**。
本域按 §12.5.3 R14 登记 `DOMAINS`，并按 §18.6 与域**同批**设覆盖率门槛 ——
这正是 §18.14 说的「域归属是门禁，不是目录审美」。

**样板价值**：本域是「**新增子域的完整动作**」的一次可抄实例 ——
`DOMAINS` 登记 + `vitest.config.ts` 实测门槛 + 消费点迁移 + 旧域死豁免清理
（`check-inline-style.cjs` 里指向旧路径的豁免、`.non-null-assertions-baseline.json`
里那条 24 项的记录）**同一批**做完。任何一个漏掉都会变成「判据挂在没人管的地方」。

## 18.12 速查

- 改 `src/lib/**` 前：先读本章 → 确认没碰 18.2 的禁止项 → 跑 18.5 的两条棘轮。
- 要取仓储：**直接 import**（`@/lib/core/repository`），别再找容器 —— 它已按 18.8 移除。
- **取 core 里任何东西都走深路径**（`@/lib/core/repository` / `errors` / `logger` / `config`）；
  `@/lib/core` 这个别名只保留「类型 + 值确实来自同一层」的用法（现存一处取 `SkillSeed`），
  **不要往 barrel 里加 `export *`**（§12.17）。
- 要写日志：**实现只有一处**（`@/lib/core/logger`，不带 `server-only` 因它被纯 Node
  宿主共用）；`@/server/lib/logger` 是转发层，服务端既有导入照旧可用。**不要直接
  `console.*`**（会绕开脱敏与面板镜像），也**不要新建第二条通道**（`import pino`
  的文件只允许一个，见 18.10.1）。新增 lib → server 依赖仍会被
  `tests/lib-server-imports.test.ts` 拦下（见 18.10）。
- `lib` 要共享类型给视图：**下沉类型模块到 `src/lib`**，不要在 lib 里 import components。
- REST route 要鉴权：从 **`~/server/auth/request-user`** 取（`currentServerUser` /
  `requireRequestUser`）；`~/lib/auth-server` 是**判决层**（会话入参），不要从 route 直接调它。
  新增 `lib → server` 边仍会被 `tests/lib-server-imports.test.ts` 拦下，且该清单现在是**空的**
  （§18.10 / §18.10.2）。
- **只服务端消费**的领域编排：放 `src/server/<domain>/`（如 `server/film/orchestrator.ts`）；
  服务端与其它宿主**共用同一份实现**时才留 `lib/`（见 12 §12.5.2）。
- 拆出 Node-only 模块：按 18.4 的表选声明形态，别三个都试；自查
  `node scripts/lib-node-only-scan.mjs`（声明缺失 / 假声明 / 真进浏览器图 一次看完）。
- 新增 `src/lib` 子域目录：**两件事必须同批** —— ① 在 `scripts/check-file-structure.cjs` 的
  `DOMAINS` 登记（R14，未登记即阻断）；② 在 `vitest.config.ts` 的 `thresholds` 里按**实测值**
  设门槛（18.6）。只做②会让门槛挂在一个「判据不认识」的目录上、只做①会让新域零门槛。
  **迁走模块时第三件事**：清掉指向旧路径的**死豁免与基线条目**（`check-inline-style.cjs`
  的 `EXEMPT`、`.non-null-assertions-baseline.json` 等）—— 一个指向不存在路径的豁免不是
  豁免，是「下一个人往这个路径写东西时被静默放行」。完整实例见 §18.15。
- 模块该放哪个域：根目录只收**顶层单例**（唯一持有者 + 任何域消费，登记在 `DOMAIN_EXEMPT`），
  其余一律进子域；叶子域**平铺**，不许再套 `admin/` `other/` `shared/` 这类杂物层（18.14）。
- 需要新增守卫：**先查既有更强的那一条**（18.4 的判定反模式）。
- 改 `src/lib/**` 的 import 前：想清楚依赖方向（§12.7）。要下沉叶子、还是回调注入？
  同目录内 `x → y` 与 `y → x` 同时存在就是环，`node scripts/check-circular-deps.cjs --report` 立即可见。
