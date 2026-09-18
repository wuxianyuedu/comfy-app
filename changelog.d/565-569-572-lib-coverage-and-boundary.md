## Changed

- **客户端可达图的判据合并成唯一一份**（ISSUE #569 第 2 项）。此前
  `tests/client-bundle-node-builtins.test.ts` 与 `scripts/lib-node-only-scan.mjs`
  各实现了一遍「哪些算 Node 内建 / 怎么解析 import / 从哪几个入口做 DFS」，而且
  **两份的盲区不一样**（实测）：
  - 用例只在 `src/app` + `src/components` 收 `"use client"` 入口 —— `src/lib` /
    `src/trpc` 下 4 个客户端入口看不见；
  - 扫描器的入口是全 `src/**`，但 `reach()` 在**任何**声明处就停 —— 而
    `"use client"` 不是服务端边界，于是只从它可达的 `src/trpc/query-client.ts`
    对扫描器不可见。

  现在 `reach()` 只在 `server-only` / `.server.ts` 处停（`"use client"` 继续走），
  用例改为**消费**扫描器的 `--json` 输出，并加两条真注入反向验证（app/components
  外的入口、只从 `"use client"` 可达的模块）。规范 §18.13.1。

- **`lib/film/orchestrator.ts` 迁到 `src/server/film/orchestrator.ts`**（ISSUE #572
  第 2 项）。它 724 行、`server-only`、唯一消费方是 `server/api/routers/film.ts` ——
  没有任何跨端复用，仓库里同类东西的既成落点是 `src/server/workshop/orchestrator.ts`。
  `lib/film/**` 因此只剩纯函数（尺寸折算 + 网络客户端）。规范 12 §12.5.2 / §18.13.2。

## Fixed

- **`tests/workshop-encapsulation-status.test.ts` 在 master 上本就红（5 例）**：它还在用
  「尺寸单键 + 解析后形状」的旧口径，而实现早已改为「尺寸子口 + 存库原始形状」
  （`source["mode:<模式>"]`）。这是那批尺寸拆分改动**漏改的用例**，让 `pnpm test`
  与 CI 长期不同口径。本批把它对齐到现状，并补一条「尺寸是独立硬闸门」的用例。

- **零消费导出棘轮基线漂移 1 条**：`workflow-param-mapping.ts#entryIdForPin` 已被
  消费/删除，基线却还留着，导致 `check-dead-exports.cjs` 在 master 上恒红。已
  `--update` 收紧（34 → 33）。

## Added

- **`tests/client-bundle-node-builtins.test.ts` 改为消费扫描器 + 两条真注入反向验证**
  （前者见 Changed 第一条）。

- **`src/lib/agent/**` 覆盖率 18.9% → 78%**（ISSUE #565 持续项），门槛
  `20/20/15/10` → `80/80/75/70`。补的是判决面：
  - `agentic.ts`（0 → 100）：多轮引导离线状态机四态 + LLM 路径的畸形 JSON /
    空回复 / 自称 ready 却缺 spec；
  - `client.ts`（0 → 100）：坏 `tool_call` 过滤（空 id 会让执行层串台）、非 2xx
    错误信封解包、响应体不是 JSON 时不炸；
  - `server.ts`（0 → 97.8）：两条协议的选路、「`action` 未登记就不交给执行层」的
    闸门、消息窄化（伪造 `system` 被丢弃）。

- **`src/server/film/**` 首次纳入 `coverage.include`**（此前整块服务端编排零门槛），
  门槛按实测值设 `30/50/35/25`；`src/lib/film/**` 门槛随纯函数化从 39 抬到 100。

- 规范新增 **§18.13**（本批落地记录）与 **12 §12.5.2**（「只服务端消费」的领域编排
  落点判据 + 反例：共用实现别搬进 `server/`）。
