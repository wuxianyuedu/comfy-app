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
