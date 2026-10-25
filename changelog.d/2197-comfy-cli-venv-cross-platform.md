## Added

comfy-cli 的 Python venv 入口跨平台化（ISSUE #2197，§9.5 登记的那条缺口）：
「建 venv → 升 pip → 装 comfy-cli → 节流升级」的全部逻辑从 `setup-comfy-cli-venv.ps1`
（Windows 单侧）搬进 **`scripts/setup-comfy-cli-venv.mjs`**（跨平台唯一实现，
`pnpm setup:comfy-cli-venv`）；`.ps1` 收成薄壳入口（定位项目根 → 调用 .mjs，硬规则 12
形状），§9.5 对照表补上这一对。读侧（`comfy-cli-python.ts`）本就按平台认
`Scripts|bin` 布局，缺的只是「建」这一格。

- 解释器下限（Python 3.10）收成**唯一定义**：`ci-env-probe.mjs` 的 `PYTHON_MIN_VERSION`，
  setup 脚本引用它；用例钉住「.mjs 引用 + 两侧都不许另抄数字」。
- POSIX 口径（#2197 定的第一件事）：`python3 -m venv` 缺 `ensurepip`（Debian/Ubuntu 系
  在单独的 `python3-venv` 包里）时打印**可复制的安装指引**后非零退出，不静默安装 ——
  装系统包要 sudo，不是脚本该做的事；与 Windows 侧「人装 Python」对称。
- 幂等 / 24h 升级节流 / 失败不阻断启动 / log 与 run 状态文件格式，与原 .ps1 逐条同形。
