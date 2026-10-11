# Start the local shadcn team registry HTTP server.
# Registry content lives in D:\dev\Comfy-APP-T3\registry (separate from this repo).
$ErrorActionPreference = "Stop"

$RegistryDir = "D:\dev\Comfy-APP-T3\registry"
$ServeScript  = Join-Path $RegistryDir "serve.mjs"
$Port         = 3874

if (-not (Test-Path $ServeScript)) {
    Write-Error "Registry server script not found: $ServeScript"
    exit 1
}

# Bail out if the port is already occupied (server likely already running).
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $tcp.Dispose()
    Write-Host "Port $Port is already in use - registry server is probably already running." -ForegroundColor Yellow
    Write-Host "Open http://127.0.0.1:$Port in your browser to verify." -ForegroundColor Cyan
    Read-Host "Press Enter to exit"
    exit 0
} catch {
    # port free - proceed
}

Write-Host "Starting team registry at http://127.0.0.1:$Port ..." -ForegroundColor Green
Write-Host "Keep this window open. Ctrl+C to stop." -ForegroundColor Gray
& node $ServeScript $Port
