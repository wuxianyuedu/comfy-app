## Added

**Chrome DevTools MCP 调试服务器（#3447）**：`.qoder/settings.json` 新增 `chrome-devtools`
（`pnpm dlx chrome-devtools-mcp@1.12.0 --isolated --memoryDebugging`：钉版本；干净临时实例，
不碰真机浏览器登录态；堆快照工具在 1.12.0 默认关，显式开）。补现有 browser-use 的三个
空白：网络请求/响应体（tRPC 错误信封）、performance trace（规范 §02 性能）、堆快照
（长开桌面应用内存泄漏）。`.gitignore` 同批放行 `.qoder/settings.json`（project 共享配置，
与 skills/commands 同类）。落点订正：Qoder 不读 `.mcp.json`（Claude Code 约定），project
配置的真实落点是 `.qoder/settings.json`。Playwright MCP 经逐条判定不加（与 browser-use
重叠约九成，流程回归走代码 E2E），判定全文见 #3447 评论。