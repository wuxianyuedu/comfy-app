[CmdletBinding()]
param(
    # 已构建好的壳可执行文件；缺省按 src-tauri/target/release/app.exe 推断。
    [string]$ExePath = "",
    # 项目根（用于决定快捷方式落点与工作目录）；缺省取脚本所在目录的上级上级。
    [string]$ProjectRoot = ""
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = if ($ProjectRoot) { $ProjectRoot } else { Split-Path -Parent $TOOLS_DIR }
Set-Location $PROJECT_ROOT

if (-not $ExePath) {
    $ExePath = Join-Path $PROJECT_ROOT "src-tauri\target\release\app.exe"
}

if (-not (Test-Path $ExePath)) {
    Write-Host "[Create-AppShortcut] 未找到 app.exe：$ExePath" -ForegroundColor Yellow
    Write-Host "[Create-AppShortcut] 请先构建 release 壳（tools\scripts\build-tauri-release.ps1），或手动指定 -ExePath。" -ForegroundColor Yellow
    exit 1
}

$shortcutPath = Join-Path $PROJECT_ROOT "Comfy APP.lnk"
try {
    # .lnk 是 Windows 专属的壳层对象，只能经 WScript.Shell COM 创建；
    # 工作目录设为项目根，保证壳解析项目根与写入日志的基准一致。
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $ExePath
    $shortcut.WorkingDirectory = $PROJECT_ROOT
    $shortcut.Description = "Comfy APP 启动入口（双击即启动，编排由壳承担）"
    $shortcut.Save()
    Write-Host "[Create-AppShortcut] 已生成快捷方式：$shortcutPath"
    Write-Host "[Create-AppShortcut]   指向：$ExePath"
} catch {
    Write-Host "[Create-AppShortcut] 生成快捷方式失败：$_" -ForegroundColor Red
    exit 1
}
