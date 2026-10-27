## Changed

- **`package.json`：`engines.node` 收紧至 `>=26.12.1`（issue #2531）**。
  原 `^22.22.2 || ^24.15.0 || >=26.0.0` 的多版本链摘掉，只保留实际运行版本
  （本机与 CI 均为 Node 26.12.1）。

## 依赖升级（6 包 + storybook 全家桶同批）

- `dompurify` 3.4.16 → **3.4.17**（patch，`src/lib/markdown` 渲染链路的消毒步骤）
- `marked` 18.0.14 → **18.1.2**（同一渲染链路，与 dompurify 一起验：
  `src/lib/markdown` 40/40 全绿）
- `storybook` + `@storybook/addon-a11y`/`addon-docs`/`addon-themes`/`nextjs`
  10.6.1 → **10.6.4**（5 包必须同版本一起升；10.6.x 同 minor patch 无 API 变）
- `@hookform/resolvers` ^5.9.2 → **^6.0.1**（v6 破坏性只在 effect-ts resolver
  （需 effect@^4）；本仓 zod ^4.6.7 + react-hook-form ^7.90.0 peer 均满足。
  源码实际未引用该包，升级零影响）

## Fixed

- **`scripts/publish-desktop-bundle.mjs`：`buildLabel` 的 JSDoc `@param` 补上参数名
  `[input]`（#2528 基线红，五态归属 `baseline-red`，挡路硬闸就地修掉）**。
  `@param {{…}}` 缺名字让 typedoc 解析该文件时 TS1003 `Identifier expected`，
  「API 文档生成与自检」格红。#2528 自己的 PR 没红是因为该文件不在这一格的
  `ifModify` 触发面里 ⇒ 静默漏判；本 PR 改 `package.json`/`pnpm-lock.yaml`
  命中触发面，CI 构建合并树时 typedoc 全量解析第一个撞上它。
  ⚠️ 遗留缺口（不在本 PR 范围）：typedoc 实际会解析的文件与 `ifModify`
  触发面不同源，#2528 型改动可以静默跳过这一格 —— 待单独开单收口。
