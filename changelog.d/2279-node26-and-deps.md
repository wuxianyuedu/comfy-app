## Changed

- Node 运行时升到 **26.12.1**：`.nvmrc` 由 `24` 改为 `26`。
  `package.json` 的 `engines.node` 原本就是 `^22.22.2 || ^24.15.0 || >=26.0.0`，26 早就在允许范围内，故不动 engines。
  ⚠️ 一处代价写在明处：**Node 26 是 Current、24 才是 LTS**（nodejs.org 释放表），这一跳是把运行时从 LTS 挪到 Current，不是无脑升版。
- 依赖升到当前 minor / patch 最新，**无跨大版本**：`@storybook/*` 10.6.3、`react` / `react-dom` 19.3.1、`prettier` 3.9.10、`postcss` 8.5.31、`jsdom` 30.1.3、`better-auth` 1.7.12、`msw` 3.0.3、`drizzle-orm` 0.45.4、`@tanstack/react-query` 5.104.5、`@tanstack/react-virtual` 3.14.22、`@tauri-apps/api` 与 `@tauri-apps/cli` 2.12.4、`@vitest/coverage-v8` 5.0.5、`@testing-library/user-event` 14.6.8、`dompurify` 3.4.17、`eslint-plugin-boundaries` 7.2.1、`react-resizable-panels` 4.14.8。
