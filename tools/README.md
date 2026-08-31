# tools/ — 构建与运维脚本

本目录存放**不参与应用运行、只用于构建/打包/排障**的脚本与文档。

此前这些文件散落在项目根目录，且打包配置 `start-tauri.spec` 被根 `.gitignore`
的 `start-tauri*.spec` 规则一并忽略，导致**打包流程无法从仓库复现**。现统一收拢
到本目录并纳入版本控制。

## 目录内容

| 文件 | 用途 |
|------|------|
| `build-launcher.bat` | 重新打包 `start-tauri/start-tauri.exe`（双击即可执行） |
| `start-tauri.spec` | PyInstaller 打包配置（onedir 模式，无控制台窗口） |
| `README.md` | 本文件 |

## 重新打包 start-tauri.exe

### 前置条件

```powershell
pip install pyinstaller
```

### 执行

双击 `tools\build-launcher.bat`，或在项目根目录执行：

```powershell
pyinstaller --clean --noconfirm --distpath . --workpath build-launcher tools/start-tauri.spec
```

产物：`<项目根>\start-tauri\start-tauri.exe`（连同 `_internal\` 依赖目录）。

> `start-tauri.spec` 内部已按 `SPECPATH` 上溯到项目根计算源码绝对路径，手敲命令时不必
> 强制在项目根执行；但 `build-launcher.bat` 仍会自动 `cd /d "%~dp0.."` 再打包。

### 打包产物不入库

`.gitignore` 已忽略：

- `/start-tauri/` —— onedir 产物目录
- `/build-launcher/` —— PyInstaller 中间产物
- `/dist/`

## 启动流程与 comfy-cli 环境

`start-tauri.exe` 由 `scripts/start_tauri_launcher.py` 打包而来，启动流程：

1. 弹出 Win32 自绘启动画面（预编译壳模式下由 Tauri 内嵌页展示进度）；
2. 后台调用 `scripts/dev-launcher.ps1` 启动 Next.js dev server 与 Tauri 壳；
3. **检测 comfy-cli 虚拟环境**（见下）；
4. tail `log/dev-launcher.log`，把进度写入 `run/launch-status.json`，供启动页读取。

### comfy-cli 虚拟环境自动准备

raw UI-format（liblib 子图）工作流由 `src/lib/comfyui/executor-cli.ts` 交给项目内的
comfy-cli 做 UI→API 转换，它固定使用：

```
<项目根>\python-venv\comfy-cli\Scripts\python.exe
```

该路径缺失时提交任务会直接 `spawn ... ENOENT`，用户无从下手。因此启动器在启动时兜底：

- **已存在** → 只写一行日志，零额外开销；
- **缺失** → 以独立进程后台触发 `scripts/setup-comfy-cli-venv.ps1`：
  1. `python -m venv python-venv\comfy-cli`
  2. `python-venv\comfy-cli\Scripts\python.exe -m pip install --upgrade pip`
  3. `python-venv\comfy-cli\Scripts\python.exe -m pip install comfy-cli`

安装耗时数分钟，**不阻塞启动**；进程独立（`start_new_session=True`），launcher 在
Tauri 窗口出现后退出也不会中断安装。脚本幂等，已装好则直接返回。

排查产物：

| 路径 | 内容 |
|------|------|
| `log/comfy-cli-setup.log` | 安装过程日志 |
| `run/comfy-cli-setup.json` | 安装状态 `{ phase, message, done, error, updated_at }` |

手动触发一次（不必等启动）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-comfy-cli-venv.ps1
```

想跳过自动准备、改用已有环境，设置环境变量 `COMFY_CLI_PYTHON` 指向你的 Python 解释器。

## 修改启动器后的注意事项

`start-tauri.exe` 是**打包产物**，改完 `scripts/start_tauri_launcher.py` 后必须重新执行
`tools\build-launcher.bat`，否则双击仍跑旧逻辑。
