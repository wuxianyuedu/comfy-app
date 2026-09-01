# 通用日志工具（供 tools/scripts 下的构建脚本 dot-source 引用）
#
# 用法：
#   . "$PSScriptRoot\Log-Common.ps1"
#   Initialize-Log "build-xxx.log"
#
# 之后用 Log 代替 Write-Host、用 Invoke-Logged 代替直接调用外部命令，
# 输出会同时显示在控制台，并以 UTF-8 编码写入 log\tools\ 下的日志文件。

function Initialize-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LogName
    )
    $script:LOG_DIR = Join-Path $PROJECT_ROOT "log\tools"
    if (-not (Test-Path $script:LOG_DIR)) {
        New-Item -ItemType Directory -Force $script:LOG_DIR | Out-Null
    }
    $script:LOG = Join-Path $script:LOG_DIR $LogName
    if (Test-Path $script:LOG) { Remove-Item $script:LOG }
    # 写入 UTF-8 BOM 头，让记事本/编辑器按 UTF-8 打开，避免中文乱码
    [System.IO.File]::WriteAllBytes($script:LOG, [System.Text.Encoding]::UTF8.GetPreamble())
}

function Log {
    param([string]$Msg)
    Write-Host $Msg
    Add-Content -Encoding UTF8 -Path $script:LOG -Value $Msg
}

function Invoke-Logged {
    param([string]$Command)
    $sb = [scriptblock]::Create($Command)
    & $sb 2>&1 | ForEach-Object {
        $line = "$_"
        Write-Host $line
        Add-Content -Encoding UTF8 -Path $script:LOG -Value $line
        $script:LAST_INVOKE_CODE = $LASTEXITCODE
    }
    $script:LAST_INVOKE_CODE = $LASTEXITCODE
}

function Open-Log {
    Start-Process -FilePath notepad -ArgumentList $script:LOG
}
