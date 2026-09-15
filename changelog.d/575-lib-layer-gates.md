## Added

- **`src/lib` 从质量门禁的盲区变成一等公民**（规范新增第 18 章，配套门禁已接入 pre-commit 与 CI）。此前 `src/lib` 既不是「纯工具」（含进程编排、文件系统、数据库），也不归视图层门禁管，也不在任何规范章里 —— 结果是**四类门禁同时失效**：`eslint-plugin-boundaries` 的 `elements` 只声明了 `server` / `lib/core` / `lib/db` / `components` / `features`，`lib/comfyui`、`workshop`、`film`、`llm` **不属于任何 element**，靠 `default: allow` 放行；「lib 不得 import 视图层」这条只写在注释里，实测已悄悄长出两处倒置（`workshop-encapsulation-status.ts` 从组件引 `WorkflowIOMap` 类型、`character-portrait-client.ts` 从组件引尺寸换算）。现在 `src/lib/**` 是 element `lib`，`lib → components` 由机器阻断。
- **`sizeSpecToRelay`（远端通道认的「比例 + 百万像素 + 倍数」三元组）下沉到 `lib/size-presets`**：它此前只存在于 `components/workshop/shot-size-config.ts`，于是 lib 侧的网络层只能反过来 import 组件。现在换算与三元组同源在 lib，组件侧的薄层只做转发。顺带修掉 `workflow-encapsulation-status.ts` 从组件引类型的问题 —— 该类型的权威定义本就是 `lib/workflow-io-types.ts`。

## Changed

- **超 900 行的文件从「只提醒」升级为棘轮**（`check-file-structure.cjs` 的 R5，新增基线 `scripts/.file-size-baseline.json`，CI 以 `--strict` 判定）。提醒只是输出里的一行字，**没有人会因为一行提示去拆文件** —— 本项目 900 行以上的文件长期停在 10 个、只增不减，正是「只提醒」的直接结果。现在：新增超限文件或已有文件继续变大即阻断，拆分后 `--update` 收紧基线，本地 pre-commit 保持「只提醒」不打断提交（与重复块 / 函数长度 / 主题色三条棘轮的本地口径一致）。

## 说明

- **没有新增 `check-lib-node-guard.cjs`**：客户端打包安全已由 `tests/client-bundle-node-builtins.test.ts` 守住（从 `"use client"` 入口做可达性 DFS，带完整引用链），它比「每个顶层 import Node 内建的 lib 模块都必须 `import "server-only"`」更强也更准 —— 后者会误伤「纯 Node 宿主」模块（`lib/kill-process-tree.ts` 由 `scripts/*.mjs` 动态加载，加上 `server-only` 会让**启动编排直接崩**）。规范 §18.4 把三种声明形态定为唯一口径，并写明「新增守卫前先查是否已有更强的那一条」。
- **未在本批落地的缺口**（已在规范 §18.7 与对应 Issue 登记，不与本批混做）：`lib` 内循环依赖（#574，需与断环同批）、零调用导出（#573，现存 566 个「导出但零外部引用」绝大多数是同文件内使用的 props 类型，需先定判据）、IIFE/回调体不计函数长度（#570，改判据会同时改变 §12.13 的既有基线数字）、prettier 接入门禁（#575 第 9 项，600+ 文件的格式化是与本次门禁对齐无关的巨型噪声 diff）。
- **回归测试**：`tests/check-file-structure.test.ts` 新增 7 例（基线缺失即阻断并给出可行动作、存量放行、新增阻断、变大阻断、降回阈值内提示收紧、非 strict 不阻断、`--update` 重写），`tests/lib-layer-boundaries.test.ts` 新增 4 例（element 声明、**元素顺序语义** —— `lib/core`/`lib/db` 必须排在 `lib/**` 之前否则数据层被重新归类、`lib → components` 策略存在、真实仓库零越界）。
