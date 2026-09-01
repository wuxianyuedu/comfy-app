[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT
. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "rebuild-static.log"

$STATIC_DIR = Join-Path $PROJECT_ROOT "src-tauri\static"

Log "=========================================================="
Log "  Comfy APP - 清理并重建前端资源 (src-tauri/static)"
Log "=========================================================="
Log "  项目根: $PROJECT_ROOT"
Log ""

if (Test-Path $STATIC_DIR) {
    Log "[1/2] 删除旧的 static 目录（含污染的整项目副本）..."
    Remove-Item -Recurse -Force $STATIC_DIR
} else {
    Log "[1/2] 未检测到 static 目录，跳过删除。"
}

Log "[2/2] 运行 build-desktop.mjs（会执行 pnpm build 生成 standalone，耗时较长）..."
Invoke-Logged "node scripts/build-desktop.mjs"
if ($LASTEXITCODE -ne 0) {
    Log "[错误] build-desktop.mjs 失败，请查看上方输出。"
    exit 1
}

Log ""
Log "=========================================================="
Log "  重建完成。接下来请运行："
Log "    tools\build-tauri-release.bat   （重新 cargo build 嵌入干净的前端资源）"
Log "  或 tools\build-all.bat           （完整发布构建）"
Log "=========================================================="
Log ""
