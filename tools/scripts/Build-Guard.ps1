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

# 列出「把某个目录里的文件映射进自己地址空间」的进程 —— 目录删不掉的直接原因。
#
# 为什么不能只看「谁在跑那个 exe」：任何一个把该目录下的 dll 映射进自己进程的
# 子进程（实测：pnpm 侧的 VCRUNTIME140.dll 就取自启动器产物目录）都会锁住整个
# 目录，而它在进程名 / 路径上都与那个 exe 无关 —— 按 exe 名判断的写法在这里
# 一个都查不到，用户拿到的是一句指向错误对象的结论（ISSUE #621）。
# 判据是**被映射文件的路径**落在该目录内，因为那才是 Windows 拒绝删除的原因
# （提权 / 系统进程读不到模块表时跳过：宁可少列，也不列错人）。
function Get-ProductDirHolder {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Directory)

    $prefix = [System.IO.Path]::GetFullPath($Directory).TrimEnd([char]92, [char]47) + "\"

    # 命令行 / 父 PID 只有 Win32_Process（CIM）有，Get-Process 拿不到。一次性建 PID→CIM
    # 索引，给每个命中进程补「它到底跑的什么、被谁拉起」——用户据此判断该连带杀哪棵子树，
    # 而不是照着 PID 盲杀（孤儿 pnpm-native 此前看不出是谁的子孙）。CIM 取不到时留空、不猜。
    $cimById = @{}
    try {
        foreach ($c in Get-CimInstance Win32_Process -ErrorAction SilentlyContinue) {
            $procId = [int]$c.ProcessId
            if (-not $cimById.ContainsKey($procId)) { $cimById[$procId] = $c }
        }
    } catch { }

    $result = @()
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
        $module = ""
        try {
            foreach ($m in $p.Modules) {
                $fileName = [string]$m.FileName
                if ($fileName -and $fileName.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $module = $fileName
                    break
                }
            }
        } catch {
            # 读不到该进程的模块表：不猜
        }
        if ($module) {
            $exePath = ""
            try { $exePath = [string]$p.Path } catch { }
            $cmdLine = ""
            $ppid = 0
            $parentName = ""
            if ($cimById.ContainsKey($p.Id)) {
                $c = $cimById[$p.Id]
                $cmdLine = [string]$c.CommandLine
                $ppid = [int]$c.ParentProcessId
                if ($cimById.ContainsKey($ppid)) { $parentName = [string]$cimById[$ppid].Name }
            }
            $result += [pscustomobject]@{
                Id = $p.Id; Name = $p.ProcessName; Module = $module; Path = $exePath
                CommandLine = $cmdLine; ParentId = $ppid; ParentName = $parentName
            }
        }
    }
    return $result
}

# 把单个占用者的补充信息（可执行文件 / 命令行 / 父进程）逐行打到日志，缩进由调用方给。
# 抽成一处，避免「清理失败出口」与「前置检查出口」两处各抄一份、日后漂移。
function Write-HolderDetail {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Indent,
        [Parameter(Mandatory = $true)]$Holder
    )
    if ($Holder.Path) { Log ("{0}可执行文件: {1}" -f $Indent, $Holder.Path) }
    if ($Holder.CommandLine) { Log ("{0}命令行: {1}" -f $Indent, $Holder.CommandLine) }
    if ($Holder.ParentId -gt 0) {
        $pn = if ($Holder.ParentName) { " ({0})" -f $Holder.ParentName } else { "" }
        Log ("{0}父进程: PID {1}{2}" -f $Indent, $Holder.ParentId, $pn)
    }
}

# 目录清理失败时的**统一出错出口**：真实异常 + 点名占用者 + 可执行动作。
#
# 旧实现把根因写成一句猜出来的「最常见的是没关掉那个窗口」，异常对象直接丢掉 ——
# 用户照提示关掉窗口、重跑，第二条提示还是同一句（真正的占用者在别处），
# 失败路径既没有日志也没有能走通的出口。
function Write-ProductDirLockHint {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [string]$Purpose = "打包启动器",
        [string]$Name = "",
        [string]$Detail = ""
    )

    if (-not $Name) { $Name = Split-Path -Leaf $Directory }
    $full = [System.IO.Path]::GetFullPath($Directory)

    Log ""
    Log ("[错误] {0}：无法清理 {1} —— 目录里的文件被其他程序占用（Windows 拒绝删除已映射的文件）。" -f $Purpose, $Name)
    if ($Detail) { Log ("        系统报错：{0}" -f $Detail) }
    Log ("        目录：{0}" -f $full)

    $holders = @(Get-ProductDirHolder -Directory $full)
    if ($holders.Count -gt 0) {
        Log ""
        Log "        持有该目录里文件的进程（查出来的，不是猜的）："
        foreach ($h in $holders) {
            Log ("          PID {0}  {1}  ← {2}" -f $h.Id, $h.Name, $h.Module)
            Write-HolderDetail -Indent "            " -Holder $h
        }
        Log ""
        Log "        结束它们（连带子进程树，别在任务管理器里单杀）："
        foreach ($h in $holders) { Log ("          taskkill /PID {0} /T /F" -f $h.Id) }
        Log "        之后重新运行本构建。"
    } else {
        Log ""
        Log "        没有查到持有文件的进程，常见于杀毒 / 索引服务正在扫描该目录，"
        Log "        或本进程权限不足（提权残留的 pyinstaller）。稍后重试；仍不行则重启后重试。"
    }
    Log ""
}

# 判断某个壳进程是否「本次构建期间无人会再用」的陈旧壳。
#
# 只自动回收这一种，凡「用户可能正开着应用」的一律留给调用方中止构建：
# 陈旧 = 连可执行文件路径都指不到本仓库（只有命令行提到项目根的老式残留，
# 或提权实例取不到路径），窗口多半已关掉、只剩进程。
# 判据宁严勿宽：判成「有人用」只是让用户手动关一次窗口；判成「陈旧」却会在用户
# 正开着应用时把窗口一起杀掉。
function Test-StaleShellProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)]$Process
    )

    $path = ""
    try { $path = [string]$Process.Path } catch { }
    return [string]::IsNullOrEmpty($path)
}

# 这次构建是否「没人守着终端」：资源管理器双击（父进程 explorer）等无人可确认的
# 场景。这两种情形都没法「按任意键」确认，陈旧壳必须由脚本自己回收而不是问。
function Test-UnattendedBuild {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    try {
        $self = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $PID) -ErrorAction SilentlyContinue
        $parentId = 0
        if ($self) { $parentId = [int]$self.ParentProcessId }
        if ($parentId -le 0) { return $false }
        $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $parentId) -ErrorAction SilentlyContinue
        if (-not $parent) { return $false }
        $name = [string]$parent.Name
        if ($name -ieq "explorer.exe") { return $true }
    } catch { }
    return $false
}

# 编译前确认目标壳未被占用。
#   AutoCloseShell：先 taskkill /PID <pid> /T /F 回收再复查（禁止单杀，见规范 §3）
#     不传也会回收「陈旧壳」（其 exe 路径已指不到本仓库的残留进程）；非交互构建
#     （资源管理器双击）同样自动回收。只有「用户可能正开着应用」才中止构建。
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

    # 陈旧壳先回收：留着只会让每次构建都被挡一次，而它已无人使用。
    $left = @()
    $reclaimed = 0
    foreach ($p in $running) {
        if (Test-StaleShellProcess -ProjectRoot $ProjectRoot -Process $p) {
            Log ("[前置] 回收陈旧桌面壳（PID {0}，其 exe 路径已指不到本仓库）：{1}" -f $p.Id, $p.Path)
            try { taskkill /PID $p.Id /T /F 2>&1 | Out-Null } catch { }
            $reclaimed++
        } else {
            $left += $p
        }
    }
    if ($reclaimed -gt 0) {
        Start-Sleep -Milliseconds 500
        $left = @(Get-RunningShellProcess -ProjectRoot $ProjectRoot)
    }
    $running = $left
    if ($running.Count -eq 0) { return 0 }

    # 非交互构建没人能「按任意键」确认关窗口，剩余壳一律自动回收。
    if (-not $AutoCloseShell -and (Test-UnattendedBuild -ProjectRoot $ProjectRoot)) {
        Log "[前置] 本次为非交互构建（双击 / 由启动器拉起），自动关闭仍在运行的桌面壳。"
        $AutoCloseShell = $true
    }

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
    Log "  请先关闭桌面窗口（应用退出时会自行回收 dev server / sidecar 进程树），再重新运行本构建。"
    Log "  窗口已无响应时可执行：taskkill /IM app.exe /T /F"
    Log "  （不要用任务管理器「结束任务」单杀壳：Next dev server 等子进程会残留占端口。）"
    Log ""
    return 1
}
