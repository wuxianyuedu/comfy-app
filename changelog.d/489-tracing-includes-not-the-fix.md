## Changed

- 构建链文档与判据说明：`outputFileTracingIncludes` 从「standalone 缺件的防线」改为
  「意图声明」——同机 A/B 复测（整段注释掉再构建）两份产物逐字节同构
  （`standalone/.../next-server/` 都是整份 74 个文件、四份 `*-turbo.runtime.prod.js` 都在位），
  原因是读这两个 tracing 键的只有 `collect-build-traces`，而它在
  `bundler !== Turbopack` 的分支里整段跳过。缺件的看守明确为产物层
  `check-standalone-contents.cjs` 与 `tests/standalone-runtime-completeness.test.ts` 的产物探针。
  同步改 `AGENTS.md` 硬规则 18、`docs/standards/launch-and-build.md` §7.4、`next.config.js` 注释。
- 硬规则 17 补上 `.env` 进 standalone 的源码级根因：`writeStandaloneDirectory()`
  显式复制 `loadedEnvFiles` 中路径恰为 `.env` / `.env.production` 的项，
  因此任何 `outputFileTracingExcludes` 条目都拦不住它（`./.env.local` 是空条目）。
- `vitest.config.ts` 写清 `coverage.thresholds` 里 glob 条目的判定口径（官方
  config/coverage.md）：不继承全局门槛，且默认判**匹配集合的聚合值**，
  逐文件达标需显式 `perFile: true`；本文件全部条目按聚合口径登记。数值未动。
