## Fixed

- comfy-cli venv 引导脚本（`scripts/devtools/setup-comfy-cli-venv.mjs`）现在同批确保 `comfy-mcp` 就位：venv 首建时随 comfy-cli 一起安装，旧检出的已就绪 venv 缺 `comfy_mcp` 时自动补装（失败只记日志，不阻断启动）——修复工作区 MCP 服务器 `comfy-mcp` 因 `comfy-mcp.exe` 不存在而永远起不来的问题（#4521）。
