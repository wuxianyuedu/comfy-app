#Requires -Version 5.1
<#
register-comfyapp-protocol.ps1 — 注册 comfyapp:// 自定义 URL 协议（原 register-comfyapp-protocol.bat）

一次性操作：写入用户级 HKCU 注册表，**不需要管理员权限**。
注册后在任务历史里点「打开文件夹」即可唤起资源管理器。

前置（一次性）：Windows 默认双击 .ps1 是「用记事本打开」，需先右键
  scripts\enable-ps1-double-click.ps1 选择「使用 PowerShell 运行」完成关联。

用法：
  双击 <项目根>\register-comfyapp-protocol.ps1
  或在终端执行：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\register-comfyapp-protocol.ps1

实际逻辑在 scripts\install-comfyapp-helper.ps1。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot "scripts\entry-common.ps1")

Write-Host "[INFO] 正在注册 comfyapp:// 协议（HKCU，无需管理员）..." -ForegroundColor Cyan
Write-Host ""

$code = Invoke-Entry -ScriptPath "scripts\install-comfyapp-helper.ps1"

Write-Host ""
if ($code -ne 0) {
    Write-Host "[ERROR] 注册失败，退出码 $code 。" -ForegroundColor Red
} else {
    Write-Host "[OK] comfyapp:// 协议已注册，任务历史的「打开文件夹」现在可用。" -ForegroundColor Green
}

exit (Complete-Entry -ExitCode $code)
