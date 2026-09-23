## Added

- **本地初始化阶段自动检出并安装 comfy-cli 运行环境**：`prepare-local-run.ps1`（即双击 `tools/start/run-local.ps1` 触发的引导脚本）新增第 6 步，检测 `python-venv/comfy-cli` 下的 Python 解释器；缺失时自动调用 `scripts/setup-comfy-cli-venv.ps1` 建 venv 并安装 `comfy-cli`（幂等，已就绪则跳过）。这样首次「本地运行」即可补齐工作流执行所需的 comfy-cli 环境，不再因解释器缺失而报「未找到 comfy-cli Python 解释器」。
