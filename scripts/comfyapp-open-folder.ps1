param([string]$Url)

# comfyapp:// custom-protocol handler (Windows).
# Registered via scripts/install-comfyapp-helper.ps1 as the shell\open\command
# for the comfyapp:// scheme. Windows launches it as:
#   powershell.exe -NoProfile -WindowStyle Hidden -File "<this>.ps1" "%1"
# where %1 is the full comfyapp:// URL the user clicked in the browser.
#
# Safety (defense-in-depth): this handler ONLY opens directories that live under
# the app's own <scripts>\..\public\generated folder. Any other path — system
# dirs, parent traversal, drive roots — is rejected. The URL itself is produced
# by our Next.js route, which also whitelist-checks server-side, so this is the
# second, OS-side gate. A website cannot weaponize comfyapp:// to open arbitrary
# paths because the handler refuses anything outside the generated folder.

$ErrorActionPreference = "Stop"

if (-not $Url) { exit 1 }
if ($Url -notmatch '^comfyapp://open\?path=(.+)$') { exit 1 }

$encoded = $Matches[1]
$target = [System.Net.WebUtility]::UrlDecode($encoded)

# Normalize to an absolute, canonical path on this machine.
try {
  $target = [System.IO.Path]::GetFullPath($target)
} catch {
  exit 1
}

# Allowed root: <scripts>\..\public\generated  (resolve symlinks/relative parts)
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\public\generated"))
$sep = [System.IO.Path]::DirectorySeparatorChar
if ($target -ne $allowedRoot -and -not $target.StartsWith($allowedRoot + $sep)) {
  # Outside the sandbox -> refuse.
  exit 1
}

# Must actually exist and be a directory.
if (-not (Test-Path -LiteralPath $target -PathType Container)) {
  exit 1
}

# Open it. `cmd /c start "" "<path>"` spawns a real explorer window in the
# current user session — works even when launched from a non-foreground
# protocol handler (the standard, documented Windows way to reveal a folder).
cmd /c start "" "$target"

exit 0
