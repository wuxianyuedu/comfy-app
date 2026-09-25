## Fixed

- **补全 custom-nodes SSE 事件联合缺少的真实线形字段（`stderr` / `exitCode` / `settings`）**：上一步（#22）的判别联合是从**消费端**视角写的，只列了前端用到的字段。尝试给服务端 `send` 收形时 `tsc` 当场暴露服务端实发、联合未收的三个字段——解析流 `done` 事件带 `stderr` + `exitCode`（失败诊断），设置流 `summary` 事件带 `settings`（本次扫描的路径清单）。补进 `SettingsStreamEvent` / `ParseStreamEvent`，使联合如实描述线上协议（否则一旦给 send 收形就会假报「未知字段」）。视图测试 67 用例全绿。

> 完整「服务端 send 收形」还需把 `/api/custom-nodes` route 内部的发现/清单管线（现以 `unknown[]` / `ManifestPackageSummary` 贯穿）重打为协议类型或补边界收窄——属独立一步，未在本次半做。
