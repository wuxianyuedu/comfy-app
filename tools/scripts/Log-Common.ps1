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

# ── 构建耗时计时 ────────────────────────────────────────────────────────────
#
# 为什么收敛在这里：构建者（尤其是双击入口的用户）要在**结束那一刻**看到
# 「这一轮到底花了多久」，而耗时是每个脚本自己的事——`build-all` 编排两步、
# 每一步又各自跑几分钟的 cargo / pyinstaller。让各脚本各写一套 Stopwatch
# 会漂成几种格式（有的只报总秒数、有的不报），汇总时也没法对齐。
# 这里给三个函数：起表、读表、按「分钟+秒」中文格式打印。

# 起一个计时器。返回 Stopwatch 对象，用 Format-Elapsed 读用时。
function Start-LogStopwatch {
    return [System.Diagnostics.Stopwatch]::StartNew()
}

# 把耗时格式化成「1 分 23.4 秒」/「45.6 秒」/「1 时 02 分 03 秒」（可读优先，
# 不用 01:23.4 这类需要心算的写法）。
function Format-Elapsed {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][TimeSpan]$Elapsed)

    if ($Elapsed.TotalHours -ge 1) {
        return ("{0} 时 {1:D2} 分 {2:D2} 秒" -f [int]$Elapsed.TotalHours, $Elapsed.Minutes, $Elapsed.Seconds)
    }
    if ($Elapsed.TotalMinutes -ge 1) {
        return ("{0} 分 {1:0.0} 秒" -f [int]$Elapsed.TotalMinutes, $Elapsed.Seconds + $Elapsed.Milliseconds / 1000)
    }
    return ("{0:0.0} 秒" -f $Elapsed.TotalSeconds)
}

# 记一行「<标签> 耗时 <格式化用时>」，同时进控制台与 log\tools\*.log。
function Log-Elapsed {
    param(
        [Parameter(Mandatory = $true)]$Stopwatch,
        [string]$Label = "总"
    )
    Log ("{0} 耗时：{1}" -f $Label, (Format-Elapsed -Elapsed $Stopwatch.Elapsed))
}
