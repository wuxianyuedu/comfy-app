[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT
. "$PSScriptRoot\Log-Common.ps1"
. "$PSScriptRoot\Build-Guard.ps1"
Initialize-Log "build-launcher-standalone.log"
$env:LAUNCHER_NAME = "start-tauri-standalone"

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command python)) {
    Log "[错误] 未找到 python，请先安装 Python 3.10+ 并加入 PATH。"
    exit 1
}
if (-not (Test-Command pyinstaller)) {
    Log "[错误] 未找到 pyinstaller。请先安装："
    Log ""
    Log "       pip install pyinstaller"
    Log ""
    exit 1
}

Log "=========================================================="
Log "  Comfy APP - 重新打包 start-tauri-standalone.exe（独立模式）"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log "  入口名    : $env:LAUNCHER_NAME（双击即走 standalone，不连 dev server）"
Log ""

Log "[1/4] 环境检查"
$pyVer = python --version 2>&1
$piVer = pyinstaller --version 2>&1
Log "  Python      : $pyVer"
Log "  PyInstaller : $piVer"
Log ""

$startTauriDir = Join-Path $PROJECT_ROOT "start-tauri-standalone"
$buildLauncherDir = Join-Path $PROJECT_ROOT "build-launcher-standalone"

Log "[2/4] 前置检查：产物目录是否被占用"
# 产物目录（start-tauri-standalone\ 等）里被占住的 _internal\*.dll 删不掉。占用者有两类：
# 启动器自己（关掉启动画面 / 桌面窗口并不让它退出），以及它拉起、后来残留成孤儿的
# dev server（node → pnpm → next 会把产物目录里的 dll 映射进自己的进程）。两类都由
# Assert-LauncherNotRunning 一次查出并点名 PID，见 Build-Guard.ps1 的说明。
if ((Assert-LauncherNotRunning -ProjectRoot $PROJECT_ROOT -Purpose "打包启动器" -ProductDir $startTauriDir) -ne 0) {
    exit 1
}
Log "  产物目录没有被占用，继续。"
Log ""

Log "[3/4] 清理旧产物..."
if (Test-Path $startTauriDir) {
    try {
        Remove-Item -Recurse -Force $startTauriDir -ErrorAction Stop
    } catch {
        # 失败路径要能自己解释：真实异常 + 点出是谁占着 + 给出可执行的动作。
        Write-ProductDirLockHint -Purpose "打包启动器" -Name "start-tauri-standalone" -Directory $startTauriDir -Detail $_.Exception.Message
        exit 1
    }
}
if (Test-Path $buildLauncherDir) {
    try {
        Remove-Item -Recurse -Force $buildLauncherDir -ErrorAction Stop
    } catch {
        Write-ProductDirLockHint -Purpose "打包启动器（pyinstaller 工作目录）" -Name "build-launcher-standalone" -Directory $buildLauncherDir -Detail $_.Exception.Message
        exit 1
    }
}
Log '      已清理 start-tauri-standalone\ 与 build-launcher-standalone\'
Log ""

Log "[4/4] 开始打包（onedir 模式，耗时约 1-3 分钟）..."
$specPath = Join-Path $TOOLS_DIR "start-tauri.spec"
Invoke-Logged "pyinstaller --clean --noconfirm --distpath . --workpath build-launcher-standalone $specPath"
if ($LASTEXITCODE -ne 0) {
    Log ""
    Log "[错误] 打包失败，请查看上方输出。"
    exit 1
}

Log ""
Log "=========================================================="
Log "  打包完成"
Log "  产物: $startTauriDir\start-tauri-standalone.exe"
Log ""
Log "  双击即用：走 standalone 模式（独立运行，不连 dev server）。"
Log "  注意：需先运行 tools\build\build-standalone.ps1 构建独立壳，否则会提示先构建。"
Log "=========================================================="
Log ""
