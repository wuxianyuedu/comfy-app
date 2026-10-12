## Security

- **Workshop MCP HTTP 入口收回本机回环**：`pnpm mcp:http` 起的独立服务原先 `listen()` 不带 host（Node 因此绑 `::`，即所有网卡；Windows 双栈下同形暴露 IPv4），且对每个响应无条件发 `Access-Control-Allow-Origin: *`。这组工具会写库、删会话、发起出图/出视频（花的是本机额度），而入口没有任何鉴权 —— 于是同网段主机与用户浏览器里打开的任意站点都能驱动它。现在监听地址取 `~/lib/endpoints` 的 `LOOPBACK_HOST`（硬规则 20 的唯一出处），跨源默认关闭，确有浏览器客户端时经 `MCP_HTTP_ALLOWED_ORIGINS` 逐条登记具体 origin（不做通配）。新增固定清单用例 `tests/mcp-http-entry-loopback.test.ts` 钉住这两格形状。证据：`tools/workshop-mcp-http.ts:32,71`、实跑 `netstat -ano` 只见 `127.0.0.1:<mcp 端口>`。
