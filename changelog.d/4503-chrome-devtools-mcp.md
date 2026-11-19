## Added

- `chrome-devtools` MCP 登记进 `.mcp.json`，与 `codegraph` / `zvec-grep` / `context7` / `comfy-mcp` 并列，ZCode（Claude Code）侧会话可直接调用；配置沿用钉版本 `pnpm dlx chrome-devtools-mcp@1.12.0 --isolated --memoryDebugging`（硬规则 1）。`.qoder/settings.json` 的 Qoder 侧副本保留（Qoder 不读 `.mcp.json`）。
