#Requires -Version 5.1
<#
enable-ps1-double-click.ps1 — 让 .ps1 可以「双击即运行」（一次性，用户级 HKCU）

===============================================================================
为什么需要它：
  Windows 对 .ps1 的默认双击动作是「用记事本打开**（不是执行）」——这是系统在
  PowerShell 脚本上的安全默认（防止误点即跑）。因此本仓库把双击入口从 .bat 换成
  .ps1 后，必须先做一次关联，双击才会真正执行脚本。

它做了什么（只写 HKCU，不需要管理员）：
  HKCU\Software\Classes\Microsoft.PowerShellScript.1\Shell\open\command
    (default) = "<pwsh 或 powershell 的绝对路径>" -NoProfile -ExecutionPolicy Bypass -File "%1" %*
  用户级注册表优先于机器级，故不影响其他用户；执行策略只对这一次调用 Bypass，
  不改动机器全局策略。

如何运行（只需一次）：
  在文件资源管理器里对本文件点**右键 →「使用 PowerShell 运行」**，或在终端执行：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\enable-ps1-double-click.ps1
  成功后，本仓库所有 .ps1 入口（tools\start\ 下的 start-web / run-local /
  verify-quality / start-desktop / start-tauri，以及 tools\build\*.ps1 …）
  即可直接双击运行。

如何撤销：
  reg delete "HKCU\Software\Classes\Microsoft.PowerShellScript.1\Shell\open\command" /f

安全提示（请知悉）：
  关联后**任意** .ps1 文件双击都会执行，包括从网上下载的可疑脚本。若你不希望
  这样，用上面的撤销命令恢复系统默认。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Say-OK   { Write-Host "[OK]   " -NoNewline -ForegroundColor Green; Write-Host "$args" }
function Say-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan;   Write-Host "$args" }
function Say-Warn { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host "$args" }
function Say-Err  { Write-Host "[ERROR]" -NoNewline -ForegroundColor Red;    Write-Host "$args" }

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  配置 .ps1 双击运行（一次性，用户级）" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# 优先 pwsh 7（dev-launcher 用到 PSStyle 等 7 的特性），回退 Windows PowerShell 5.1。
# 这里必须写绝对路径：文件关联由资源管理器拉起，PATH 解析不可靠。
$psExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $psExe) {
    $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
}
if (-not $psExe) {
    Say-Err "未找到 PowerShell 可执行文件，无法配置关联。"
    exit 1
}
Say-Info "使用宿主：$psExe"

$key = "HKCU:\Software\Classes\Microsoft.PowerShellScript.1\Shell\open\command"
$command = "`"$psExe`" -NoProfile -ExecutionPolicy Bypass -File `"%1`" %*"

try {
    if (-not (Test-Path -LiteralPath $key)) {
        New-Item -Path $key -Force | Out-Null
    }
    Set-Item -Path $key -Value $command -Force
} catch {
    Say-Err "写入注册表失败：$($_.Exception.Message)"
    exit 1
}

Say-OK "已配置：双击 .ps1 将直接运行。"
Write-Host ""
Write-Host "  $command" -ForegroundColor DarkGray
Write-Host ""
Say-Info "现在可双击 tools\start\ 下的 start-web.ps1 / run-local.ps1 / verify-quality.ps1 等入口。"
Say-Info "撤销命令：reg delete `"HKCU\Software\Classes\Microsoft.PowerShellScript.1\Shell\open\command`" /f"
Write-Host ""
Say-Warn "注意：关联后任意 .ps1 双击都会执行（含下载来的脚本），请留意来源。"
Write-Host ""
exit 0
