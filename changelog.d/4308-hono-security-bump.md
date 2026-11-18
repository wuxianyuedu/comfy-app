## Fixed

- **hono 4.13.11 → 4.13.16**（ISSUE #4308）：Dependabot 同链五条告警（#16–#20，最高 medium）
  的 patched 一律 `>=4.13.16`（`css` 助手未转义 / RegExpRouter 跳过通配 middleware /
  `mount` 前缀绕过 / `validator('form')` 跳过校验 / `csrf()` 不查 `text/ping`）。hono 由
  `@modelcontextprotocol/sdk` 传递引入（工作坊 MCP 的 HTTP 通道），经 `pnpm-workspace.yaml`
  的既有 override `hono@4` 升到**最小可达修复版**。
