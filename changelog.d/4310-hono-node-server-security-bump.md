## Fixed

- **@hono/node-server 2.1.5 → 2.1.6**（ISSUE #4310）：Dependabot 两条 medium 告警（#14/#15）
  patched `>=2.1.6`（请求路径里的反斜杠被当作分隔符、可绕过反代的路径访问控制；WebSocket
  升级期 socket 的 `ECONNRESET` 未处理可打挂进程）。由 `@modelcontextprotocol/sdk` 传递
  引入，经 `pnpm-workspace.yaml` 新增 override `@hono/node-server@2` 升到最小可达修复版。
