## Fixed
- 写清工作区 MCP `comfy-mcp` 的安装前置（#5154）：配置里登记的 `python-venv/comfy-cli/Scripts/comfy-mcp.exe` 是 `pnpm setup:comfy-cli-venv` 的产物（幂等补装，#4521），新检出 / 没跑过应用时不存在并不代表 MCP 不可用。此前 `.mcp.json` 只写 exe 路径与用途、规范只在「启动链路」视角讲补装，从 MCP 配置这一侧看不到前置，导致把「未安装」误判为「不可用」。现在 `.mcp.json` 描述、`docs/standards/launch-and-build.md` 工作区 MCP 段、`tools/README.md` 三处对齐：先跑 pnpm 入口，再看连接状态。
