# tools/studio/ — 数据库工具入口（双击用）

| 入口 | 用途 | 逻辑 |
|---|---|---|
| `start-studio.ps1` | 启动 Drizzle Studio：先拉起 Studio 服务并等端口就绪，再打开浏览器前端 | `start-studio.logic.ps1`（同目录，后缀区分） |

**为什么先等服务再开浏览器**：直接开页面会卡在
`Connecting to the Drizzle Kit on localhost:4983` —— 看起来像「打不开」，
其实是服务还没就绪。

**非 Windows 平台**：直接在终端跑 `pnpm db:studio`（同一件事，只是不等端口、
不自动开浏览器）。
