[CmdletBinding()]
param()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "package-portable.log"

Log "=========================================================="
Log "  Comfy APP - 组装免安装版（portable zip）"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log ""

# 逻辑只有一份、在 .mjs 里（规范 §9.5）：Windows 入口与 POSIX / CI 同款命令，
# 本文件只做「转交 + 透传退出码」，不写第二份组装逻辑。
Invoke-Logged "pnpm package:portable"
$code = $script:LAST_INVOKE_CODE
if ($code -ne 0) {
    Log ""
    Log "[错误] 免安装版组装失败（exit=$code）。先确认跑过 pnpm tauri build 产出壳 / sidecar / static。"
    Open-Log
    exit $code
}

Log ""
Log "  [完成] 免安装版 zip 已产出（默认 src-tauri\target\release\bundle\ComfyAPP-portable.zip）。"
Log "  用法：解压到任意目录，双击 app.exe 即可，无需安装、无需本机 Node。"
Log "=========================================================="
Log ""
