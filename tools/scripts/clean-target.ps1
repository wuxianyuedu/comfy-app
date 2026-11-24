[CmdletBinding()]
param(
    [switch]$All,
    [switch]$Release,
    [switch]$DryRun
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$TOOLS_DIR = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $TOOLS_DIR
Set-Location $PROJECT_ROOT

. "$PSScriptRoot\Log-Common.ps1"
Initialize-Log "clean-target.log"

Log "=========================================================="
Log "  Comfy APP - 清理 Rust 构建产物 (src-tauri/target)"
Log "=========================================================="
Log "  项目根目录: $PROJECT_ROOT"
Log ""

# 逻辑只有一份、在 .mjs 里（规范 §9.5）：Windows 入口与 POSIX / CI 同款命令，
# 本文件只做「转交 + 透传退出码」，不写第二份清理/回收逻辑。
$pnpmArgs = @()
if ($All) { $pnpmArgs += "--all" }
if ($Release) { $pnpmArgs += "--release" }
if ($DryRun) { $pnpmArgs += "--dry-run" }
$argLine = if ($pnpmArgs.Count -gt 0) { " " + ($pnpmArgs -join " ") } else { "" }

Invoke-Logged "pnpm target:prune$argLine"
$code = $script:LAST_INVOKE_CODE
if ($code -ne 0) {
    Log ""
    Log "[错误] target 清理失败（exit=$code）。若提示目录被占用，先关掉正在跑的 cargo / 桌面壳再重跑（出口见 log 内的占用提示）。"
    Open-Log
    exit $code
}

Log ""
Log "  [完成] src-tauri/target 清理执行完成（档位见上方命令行）。"
Log "  下一次 cargo build 按所选档位重新编译：默认档只影响增量编译速度，-Release / -All 需全量重编。"
Log "=========================================================="
Log ""
