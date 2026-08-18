# One-time registration of the comfyapp:// custom protocol (user-level, NO admin).
# Run once from a PowerShell prompt in the project root:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-comfyapp-helper.ps1
#
# What it does:
#   HKCU\Software\Classes\comfyapp
#     (default)            = "URL:ComfyApp Open Folder Protocol"
#     "URL Protocol"       = ""
#     shell\open\command   = powershell.exe ... -File "<handler>" "%1"
#
# HKCU (current user) requires no administrator privileges. After this, any
# comfyapp://open?path=... link clicked in the browser triggers the OS "open
# external application?" prompt, and our handler opens the folder in Explorer.

$ErrorActionPreference = "Stop"

$handler = Join-Path $PSScriptRoot "comfyapp-open-folder.ps1"
if (-not (Test-Path -LiteralPath $handler)) {
  Write-Error "Handler script not found: $handler"
  exit 1
}

# Resolve the PowerShell executable that will run the handler.
$psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
if (-not $psExe) { $psExe = "powershell.exe" }

# Command line: pass the clicked comfyapp:// URL as %1 (quoted).
$command = "`"$psExe`" -NoProfile -WindowStyle Hidden -File `"$handler`" `"%1`""

$base = "HKCU:\Software\Classes\comfyapp"
New-Item -Path $base -Force | Out-Null
New-Item -Path "$base\shell" -Force | Out-Null
New-Item -Path "$base\shell\open" -Force | Out-Null
New-Item -Path "$base\shell\open\command" -Force | Out-Null

Set-Item -Path $base -Value "URL:ComfyApp Open Folder Protocol"
Set-ItemProperty -Path $base -Name "URL Protocol" -Value ""

Set-Item -Path "$base\shell\open\command" -Value $command

Write-Host "Registered comfyapp:// protocol."
Write-Host "  command: $command"
Write-Host "Open a task's folder from the app; the browser will ask to launch the helper."
