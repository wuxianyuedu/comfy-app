@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: run-desktop.bat — 桌面版一键自检 + 启动入口
:: 面向拿到「即开即用桌面包」的普通用户：双击本脚本会先自检桌面包是否完整，
:: 缺失时给出中文提示；完整则自动启动桌面窗口，免手工找 exe。
::
:: 用法说明：
::   - 本脚本需与桌面包放在同一目录结构下（即项目根目录，桌面包在 start-tauri\）。
::   - 桌面包由开发人员在 Windows 上运行 tools\build\build-all.bat 产出
::     （详见 docs/guide-non-developer.md 第 6 节）。
::
:: 桌面启动器候选（按优先级）：
::   start-tauri-standalone\start-tauri-standalone.exe   独立运行，免装任何开发环境（推荐分发）
::   start-tauri\start-tauri.exe                         默认 prebuilt 入口（需本机已装 Node 起 dev server）

cd /d "%~dp0"

set "FAIL=0"
set "LAUNCHER="

echo [INFO] 桌面版自检开始...

:: 1) 是否处于项目根目录
if not exist "scripts\dev-launcher.ps1" (
    echo [ERROR] 未找到 scripts\dev-launcher.ps1 —— 本脚本须放在项目根目录、
    echo         且桌面包紧邻其下的 start-tauri\ 文件夹才能工作。
    echo         请把整个「即开即用桌面包」解压到不含中文/空格的目录后，再双击本脚本。
    set FAIL=1
)

:: 2) 定位桌面启动器（优先独立版，其次 prebuilt 版）
if exist "start-tauri-standalone\start-tauri-standalone.exe" (
    set "LAUNCHER=start-tauri-standalone\start-tauri-standalone.exe"
    echo [OK]   找到独立版桌面启动器。
) else if exist "start-tauri\start-tauri.exe" (
    set "LAUNCHER=start-tauri\start-tauri.exe"
    echo [OK]   找到桌面启动器 start-tauri\start-tauri.exe。
    echo [WARN] 该入口默认以 prebuilt 模式运行，需要本机已装 Node/pnpm 并起 dev server；
    echo         若你不是开发人员、只想要免装的成品，请让开发人员分发「独立版桌面包」。
) else (
    echo [ERROR] 未找到桌面启动器 ^(start-tauri\start-tauri.exe 或独立版^)。
    echo         桌面包尚未构建。请先由开发人员在 Windows 上运行：
    echo           tools\build\build-all.bat
    echo         生成 start-tauri\ 后再双击本脚本。
    set FAIL=1
)

if not "!FAIL!"=="0" (
    echo.
    echo [ERROR] 自检未通过，请按上方中文提示处理。
    echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
    exit /b 1
)

:: 3) 自检通过，启动桌面启动器
echo.
echo [INFO] 自检通过，正在启动桌面应用，请稍候...
echo        （桌面包完整时无需安装任何开发环境，稍等即弹出主窗口。）
echo.

start "" "!LAUNCHER!"

:: 仅双击启动时暂停；从已有终端调用时不暂停
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
