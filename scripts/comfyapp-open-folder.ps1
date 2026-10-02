param([string]$Url)

# comfyapp:// custom-protocol handler (Windows).
# Registered via scripts/install-comfyapp-helper.ps1 as the shell\open\command
# for the comfyapp:// scheme. Windows launches it as:
#   powershell.exe -NoProfile -WindowStyle Hidden -File "<this>.ps1" "%1"
# where %1 is the full comfyapp:// URL the user clicked in the browser.
#
# Safety (defense-in-depth): this handler ONLY opens directories that live under
# the app's own <scripts>\..\generated folder. Any other path — system
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

# Allowed root: the app's <root>\generated folder -- one level up from
# <scripts>, plus the artifact root dir name (resolve symlinks/relative parts).
#
# Deliberately built from SEPARATE segments, not a single "..\generated" literal:
# a joined literal carries a platform-specific separator, and this root is also
# read by cross-platform tooling -- tests/artifact-layout-single-source.test.ts
# pairs it against generatedRoot() and must stay green on Linux/CI, where the TS
# side could otherwise only recover the intent by string-replacing every "\"
# with "/" (a guess at which platform wrote the string). Separate separator-free
# segments let Join-Path use the host's own separator and let the paired
# assertion resolve them with path.resolve(..., ...segments) as-is.
# Nested Join-Path (not -AdditionalChildPath) to stay PS 5.1 compatible.
$allowedRoot = [System.IO.Path]::GetFullPath(
  (Join-Path (Join-Path $PSScriptRoot "..") "generated"))
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
