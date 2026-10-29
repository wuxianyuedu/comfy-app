## Added

- **引入 oxlint + `oxlint-config-awesomeness` 工具链**：新增 `oxlint.config.ts`（`oxlint-config-awesomeness` 预设 + 项目专属层——以 `eslint-plugin-boundaries` 经 jsPlugins 接 `eslint-import-resolver-oxc` 保住 §18 架构分层，以 `eslint-js/no-restricted-syntax` 两条选择器保住 store selector 全局约束与 tRPC router 信封约束），并补 `oxlint` / `oxlint-config-awesomeness` / `oxlint-plugin-eslint` / `oxlint-plugin-boundaries` / `oxlint-tsgolint` / `eslint-plugin-boundaries` / `eslint-import-resolver-oxc` 开发依赖。oxlint 暂未接入 CI 强制门禁，逐规则清零报错随后分批 PR。
