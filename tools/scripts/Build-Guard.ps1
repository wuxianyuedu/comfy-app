# 构建前置守卫（供 tools/scripts 下的构建脚本 dot-source 引用）
#
# 背景：cargo 覆盖 target\release\app.exe 前会先删除旧文件。上一次启动的桌面壳
# 如果还开着（预编译壳 app.exe 是长驻 GUI 进程），删除会被拒绝（os error 5 /
# 拒绝访问），构建在全部编译完成、进入链接收尾时才失败——既浪费几分钟编译时间，
# 报错本身也看不出「壳还在运行」这一根因。这里由构建脚本在动手前主动检测并给出
# 可执行的处置提示（或按需自动关闭）。
#
# 关键：按「进程可执行文件的真实路径」匹配，而不是按进程名或命令行。
# 预编译壳由 dev-launcher.ps1 用 ProcessStartInfo 启动，UseShellExecute=false 时
# 子进程继承父进程环境，命令行里不含项目根路径（dev-launcher 清理残留壳所用的
# CommandLine -like "*$root*" 因此并不可靠）；而 exe 所在目录必然指向项目根的
# src-tauri\target\<profile>\。executablePath 在权限受限时可能取不到，此时退回
# 命令行匹配，宁可多提示一次也不要漏判后白跑一轮编译。
function Get-RunningShellProcess {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $exeName = "app.exe"
    $expected = @()
    foreach ($profile in @("release", "debug")) {
        $dir = Join-Path $ProjectRoot ("src-tauri\target\" + $profile)
        $expected += [System.IO.Path]::GetFullPath((Join-Path $dir $exeName))
    }

    $procs = Get-CimInstance Win32_Process -Filter "Name='app.exe'" -ErrorAction SilentlyContinue
    if (-not $procs) { return @() }

    $result = @()
    foreach ($p in $procs) {
        $path = ""
        try { $path = [string]$p.ExecutablePath } catch { }
        $hit = $false
        if ($path) {
            foreach ($e in $expected) {
                if ($path.Equals($e, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true }
            }
        } elseif ($p.CommandLine -and $p.CommandLine -like ("*" + $ProjectRoot + "*")) {
            $hit = $true
        }
        if ($hit) { $result += [pscustomobject]@{ Id = $p.ProcessId; Path = $path } }
    }
    return $result
}

# 编译前确认目标壳未被占用。
#   AutoCloseShell：先 taskkill /PID <pid> /T /F 回收再复查（禁止单杀，见规范 §3）
# 返回 0 = 可以继续构建；返回 1 = 必须中止，调用方直接 exit 1。
function Assert-ShellNotRunning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [string]$Purpose = "构建",
        [switch]$AutoCloseShell
    )

    $running = @(Get-RunningShellProcess -ProjectRoot $ProjectRoot)
    if ($running.Count -eq 0) { return 0 }

    if ($AutoCloseShell) {
        foreach ($p in $running) {
            Log ("[前置] 关闭正在运行的桌面壳（PID {0}）..." -f $p.Id)
            try { taskkill /PID $p.Id /T /F 2>&1 | Out-Null } catch { }
        }
        Start-Sleep -Milliseconds 500
        $left = @(Get-RunningShellProcess -ProjectRoot $ProjectRoot)
        if ($left.Count -eq 0) {
            Log "[前置] 桌面壳已关闭，继续构建。"
            return 0
        }
        Log "[前置] 桌面壳进程仍在（可能为提权实例），无法自动关闭。"
    }

    Log ""
    Log ("[错误] {0} 目标文件被占用，无法覆盖：src-tauri\target\release\app.exe" -f $Purpose)
    Log ""
    Log "  原因：上一次启动的桌面壳（app.exe）仍在运行，Windows 不允许替换其可执行文件。"
    Log "        直接继续会在链接收尾阶段报「拒绝访问 (os error 5)」，并浪费此前全部编译时间。"
    Log ""
    foreach ($p in $running) { Log ("  正在运行的壳进程：PID {0}  {1}" -f $p.Id, $p.Path) }
    Log ""
    Log "  请先关闭桌面窗口（应用退出时会自行回收 sidecar 进程树），再重新运行本构建。"
    Log "  窗口已无响应时可执行：taskkill /IM app.exe /T /F"
    Log "  （不要用任务管理器「结束任务」单杀壳：Next dev server 等子进程会残留占端口。）"
    Log ""
    return 1
}
