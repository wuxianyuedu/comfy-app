[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

$STATIC_DIR = Join-Path $PROJECT_ROOT "src-tauri\static"

Write-Host "=========================================================="
Write-Host "  Comfy APP - 清理并重建前端资源 (src-tauri/static)"
Write-Host "=========================================================="
Write-Host "  项目根: $PROJECT_ROOT"
Write-Host ""

if (Test-Path $STATIC_DIR) {
    Write-Host "[1/2] 删除旧的 static 目录（含污染的整项目副本）..."
    Remove-Item -Recurse -Force $STATIC_DIR
} else {
    Write-Host "[1/2] 未检测到 static 目录，跳过删除。"
}

Write-Host "[2/2] 运行 build-desktop.mjs（会执行 pnpm build 生成 standalone，耗时较长）..."
& node scripts/build-desktop.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] build-desktop.mjs 失败，请查看上方输出。"
    exit 1
}

Write-Host ""
Write-Host "=========================================================="
Write-Host "  重建完成。接下来请运行："
Write-Host "    tools\build-tauri-release.bat   （重新 cargo build 嵌入干净的前端资源）"
Write-Host "  或 tools\build-all.bat           （完整发布构建）"
Write-Host "=========================================================="
Write-Host ""
