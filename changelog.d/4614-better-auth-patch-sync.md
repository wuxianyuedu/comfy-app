## Fixed

- **better-auth 追平同 major 最新补丁 1.7.12 → 1.7.27（#4614）**：auth 库的补丁版
  常含安全修复，此前 lockfile 停在 14 个补丁版之前而无任何信号。本次随依赖整理
  `pnpm update better-auth` 追平（`package.json` 范围同步到 `^1.7.27`）。核对
  1.7.13~1.7.27 发布说明：安全修复集中在匿名登录 origin 校验、会话吊销与 cookie
  缓存一致性、IP 通配 trustedOrigins 匹配、原型污染防护等；行为变更集中在本项目
  未启用的 OAuth/OIDC/DPoP/MCP 插件面，`betterAuth()` 核心、drizzle 适配器、
  next-js handler、react client 与动态 baseURL/trustedOrigins 形态均不受影响。
  已跑 `pnpm typecheck`、全量 `pnpm test` 与鉴权用例（origin 策略 / 会话解析）确认。
- **依赖整理常规动作补一格（#4614）**：`docs/guides/sync-after-pull.md` 新增
  「依赖整理时按落后形态分三类看 `pnpm outdated`」的对照表（升补丁、评 minor、
  拆 major），补上「同 major 补丁滞后无信号」这一格。
