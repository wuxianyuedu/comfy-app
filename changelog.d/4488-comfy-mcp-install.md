## Added

- **补装 comfy-mcp 并登记进 `.mcp.json`**（#4488）：项目 venv
  （`python-venv/comfy-cli`，comfy-cli 1.22.0 ≥ 其要求的 1.14）里补装
  `comfy-mcp` 0.11.0（Comfy Org 官方 MCP 服务器，comfy-cli 的薄封装，
  stdio），并登记进 `.mcp.json`（`COMFY_BIN` 指向 venv 内 `comfy.exe`）。
  编码代理由此获得「搜模型 / 节点 / 模板、读已有工作流、改插槽、跑图取产物」
  的工具面——驱动的是用户自己跑的本机 ComfyUI（默认 `127.0.0.1:8188`），
  使用前先调 `server_info` 确认 ComfyUI 在跑。POSIX 检出把两处
  `Scripts/` 路径换成 `bin/`。
