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
    # 关键：子进程（pnpm/cargo/next）以 UTF-8 输出中文，而 Windows PowerShell
    # 5.1 在本脚本被构建入口（tools\build\*.ps1）调用时，默认用系统 ANSI(GBK)
    # 解码管道输出，导致日志中文乱码。强制用 UTF-8 解码子进程输出；控制台输出
    # 也统一为 UTF-8。（入口已是 .ps1，不再有 cmd.exe 代码页问题，但该解码
    # 设置仍需保留——宿主是 5.1 时行为不变。）
    $OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $script:LOG_DIR = Join-Path $PROJECT_ROOT "log\tools"
    if (-not (Test-Path $script:LOG_DIR)) {
        New-Item -ItemType Directory -Force $script:LOG_DIR | Out-Null
    }
    $script:LOG = Join-Path $script:LOG_DIR $LogName
    if (Test-Path $script:LOG) { Remove-Item $script:LOG }
    # 写入 UTF-8 BOM 头，让记事本/编辑器按 UTF-8 打开，避免中文乱码
    [System.IO.File]::WriteAllBytes($script:LOG, [System.Text.Encoding]::UTF8.GetPreamble())
}

function Strip-Ansi([string]$s) {
    # 去掉 ANSI 转义序列（颜色、光标控制等），让日志文件在记事本里也干净可读；
    # 控制台输出仍保留原样，所以 cmd/终端里继续有颜色。
    return [regex]::Replace($s, "$([char]0x1b)\[[0-9;]*[a-zA-Z]", '')
}

function Log {
    param([string]$Msg)
    Write-Host $Msg
    $clean = Strip-Ansi $Msg
    Add-Content -Encoding UTF8 -Path $script:LOG -Value $clean
}

function Invoke-Logged {
    param([string]$Command)
    $sb = [scriptblock]::Create($Command)
    & $sb 2>&1 | ForEach-Object {
        $line = "$_"
        Write-Host $line
        $clean = Strip-Ansi $line
        Add-Content -Encoding UTF8 -Path $script:LOG -Value $clean
        $script:LAST_INVOKE_CODE = $LASTEXITCODE
    }
    $script:LAST_INVOKE_CODE = $LASTEXITCODE
}

function Open-Log {
    Start-Process -FilePath notepad -ArgumentList $script:LOG
}
