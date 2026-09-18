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

# 列出正在运行的本仓库启动器（prebuilt / dev / standalone 三种入口 exe）。
#
# 为什么单独查它：构建被「上一次启动的桌面壳还开着」挡住时，用户的动作链路是
# 「启动应用 → 关掉窗口 → 重新构建」。关掉桌面窗口后壳通常已被回收，但**启动器
# 自身**可能仍在跑（壳异常退出、启动器仍在等它 / 关闭动作没走到回收分支），它随时
# 会再拉起一个新壳顶上 target\release\app.exe —— 于是构建要么立刻被占用挡住，要么
# 在几分钟的编译途中被新壳顶上，白跑一整轮（os error 5）。判据同样是 exe 真实路径
# 落在本仓库，不按进程名判断（别处的同名进程不算）。
#
# 返回 >=0 的命中数；0 表示启动器没在跑。
function Get-RunningLauncher {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $names = @("start-tauri.exe", "start-tauri-dev.exe", "start-tauri-standalone.exe")
    $dirs = @("start-tauri", "start-tauri-dev", "start-tauri-standalone")
    $expected = @()
    foreach ($d in $dirs) {
        foreach ($n in $names) {
            $expected += [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot ($d + "\" + $n)))
        }
    }

    $result = @()
    foreach ($n in $names) {
        $procs = Get-CimInstance Win32_Process -Filter ("Name='" + $n + "'") -ErrorAction SilentlyContinue
        if (-not $procs) { continue }
        foreach ($p in $procs) {
            $path = ""
            try { $path = [string]$p.ExecutablePath } catch { }
            $hit = $false
            if ($path) {
                foreach ($e in $expected) {
                    if ($path.Equals($e, [System.StringComparison]::OrdinalIgnoreCase)) { $hit = $true }
                }
            } elseif ($p.CommandLine -and $p.CommandLine -like ("*" + $ProjectRoot + "*")) {
                # 取不到 exe 路径时退回命令行（与 Get-RunningShellProcess 同一策略）：
                # 提权实例或受限会话下 ExecutablePath 可能是空串，只按路径判断会「一个
                # 都没查到」——而那时目录照样被锁着，用户拿到的是一句与现场矛盾的结论。
                $hit = $true
            }
            if ($hit) { $result += [pscustomobject]@{ Id = $p.ProcessId; Path = $path } }
        }
    }
    return $result
}

# 列出「把产物目录里的文件映射进自己地址空间」的进程 —— 目录删不掉的直接原因。
#
# 为什么不能只看启动器 exe：启动器拉起的 dev server（node → pnpm → next）会把
# `start-tauri\_internal\*.dll` 映射进自己的进程（实测：pnpm 侧的 VCRUNTIME140.dll
# 就取自产物目录）。于是「启动器已退出、dev server 还在跑」这种孤儿形态同样锁住
# 目录，而按 exe 名 / 路径判断的 Get-RunningLauncher 一个都查不到 —— 现场因此拿到
# 一句指向「start-tauri.exe 仍在运行」的错误结论：用户刚关掉的正是它。
# 判据是**被映射文件的路径**落在产物目录内，因为那才是 Windows 拒绝删除的原因
# （提权 / 系统进程读不到模块表时跳过：宁可少列，也不列错人）。
function Get-ProductDirHolder {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Directory)

    $prefix = [System.IO.Path]::GetFullPath($Directory).TrimEnd([char]92, [char]47) + "\"

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
            $result += [pscustomobject]@{ Id = $p.Id; Name = $p.ProcessName; Module = $module; Path = $exePath }
        }
    }
    return $result
}

# 产物目录清理失败时的**统一出错出口**：真实异常 + 点名占用者 + 可执行动作。
#
# 旧实现把根因写成一句猜出来的「最常见的是启动器仍在运行」，异常对象直接丢掉 ——
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
        foreach ($h in $holders) { Log ("          PID {0}  {1}  ← {2}" -f $h.Id, $h.Name, $h.Module) }
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
# 陈旧 = 起它的启动器已不在进程表里（无主的孤儿壳，窗口多半已关掉、只剩进程），
# 或者连可执行文件路径都指不到本仓库（只有命令行提到项目根的老式残留）。
# 判据宁严勿宽：判成「有人用」只是让用户手动关一次窗口；判成「陈旧」却会在用户
# 正开着应用时把窗口一起杀掉。
function Test-StaleShellProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)]$Process
    )

    if (@(Get-RunningLauncher -ProjectRoot $ProjectRoot).Count -eq 0) { return $true }

    $path = ""
    try { $path = [string]$Process.Path } catch { }
    return [string]::IsNullOrEmpty($path)
}

# 这次构建是否「没人守着终端」：资源管理器双击（父进程 explorer）或由本仓库启动器
# 拉起的后台构建（父进程是 start-tauri*.exe）。这两种情形都没法「按任意键」确认，
# 陈旧壳必须由脚本自己回收而不是问。
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
        if ($name -in @("start-tauri.exe", "start-tauri-dev.exe", "start-tauri-standalone.exe")) { return $true }
    } catch { }
    return $false
}

# 编译前确认目标壳未被占用。
#   AutoCloseShell：先 taskkill /PID <pid> /T /F 回收再复查（禁止单杀，见规范 §3）
#     不传也会回收「陈旧壳」（其启动器已退出的孤儿壳）；非交互构建（双击 / 由启动器
#     拉起）同样自动回收。只有「启动器还在跑 / 用户可能正开着应用」才中止构建。
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
            Log ("[前置] 回收陈旧桌面壳（PID {0}，其启动器已退出）：{1}" -f $p.Id, $p.Path)
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
    if (@(Get-RunningLauncher -ProjectRoot $ProjectRoot).Count -gt 0) {
        Log ""
        Log "  其中还有本仓库的应用启动器（start-tauri*.exe）在运行：它随时会再拉起一个壳顶上"
        Log "  target\release\app.exe。若你只是关了桌面窗口、并不打算继续用应用，请先结束启动器"
        Log "  （关掉它的启动画面 / 控制台窗口），否则构建会在编译途中被新壳占用而白跑一轮。"
    }
    Log ""
    Log "  请先关闭桌面窗口（应用退出时会自行回收 sidecar 进程树），再重新运行本构建。"
    Log "  窗口已无响应时可执行：taskkill /IM app.exe /T /F"
    Log "  （不要用任务管理器「结束任务」单杀壳：Next dev server 等子进程会残留占端口。）"
    Log ""
    return 1
}

# 打包启动器前确认启动器自身没在跑。
#
# 为什么单独一步：`build-launcher*.ps1` 的产物是**整个目录**（`start-tauri\` 或
# `start-tauri-dev\` 等，onedir 布局），`Remove-Item -Recurse -Force` 删不掉被运行中
# 进程占用的 `_internal\*.dll`。旧实现只把失败原因写成一句「可能被其他程序占用（如
# start-tauri.exe 仍在运行）」，却没有查任何进程表——用户看到的现场恰好是「我已经
# 关掉窗口了」（关的是桌面壳，启动器自己作为独立 exe 还在跑），于是提示既指不出是谁
# 占着，也给不出可执行的动作（ISSUE #621）。
#
# 判据与 Assert-ShellNotRunning 的「陈旧壳」一致：按 exe **真实路径**落在本仓库的
# 三个启动器产物目录算命中，别处的同名进程一律不算。这里不自动回收——启动器是用户
# 刚双击过的入口（关掉它的启动画面 = 放弃本次启动），构建侧替用户做这个决定不合适；
# 而且它与壳不同，不存在「无主孤儿」这种判据（窗口是它自己的）。
#
# 第二个判据（ProductDir）：目录被**启动器拉起的子进程**占用（dev server 持有
# `_internal\*.dll`），此时启动器自己可能早就退出了。两条一起报，用户一次就能清完，
# 不必「杀启动器 → 重跑 → 又被告知目录还被占着」来回一轮。
#
# 返回 0 = 没有启动器在跑、产物目录也没被别的进程占用，可以继续打包；
# 1 = 命中占用，调用方应中止并提示用户。
function Assert-LauncherNotRunning {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [string]$Purpose = "打包启动器",
        [string]$ProductDir = ""
    )

    $running = @(Get-RunningLauncher -ProjectRoot $ProjectRoot)

    $holders = @()
    if ($ProductDir) {
        $launcherIds = @($running | ForEach-Object { $_.Id })
        $holders = @(
            Get-ProductDirHolder -Directory $ProductDir |
                Where-Object { $launcherIds -notcontains $_.Id }
        )
    }
    if ($running.Count -eq 0 -and $holders.Count -eq 0) { return 0 }

    Log ""
    if ($running.Count -gt 0) {
        Log ("[错误] {0}：本仓库的启动器仍在运行，产物目录被它占用。" -f $Purpose)
        Log ""
        Log "  原因：启动器（start-tauri*.exe）是独立进程，关掉它的启动画面 / 桌面窗口并不会"
        Log "        让它自己退出；只要它还在跑，产物目录里的 _internal\*.dll 就被锁住，"
        Log "        无法删除重建（就是刚才那句「无法清理 start-tauri」）。"
        Log ""
        foreach ($p in $running) { Log ("  正在运行的启动器：PID {0}  {1}" -f $p.Id, $p.Path) }
        Log ""
        Log "  请先结束上面的启动器进程（关掉它的启动画面 / 控制台窗口），再重新运行本构建。"
        Log "  若窗口已关掉、只剩进程，执行：taskkill /PID <上面的 PID> /T /F"
        Log "  （别用任务管理器单杀：它拉起的 dev server / 壳会残留占端口，见规范 §3。）"
    }
    if ($holders.Count -gt 0) {
        Log ""
        Log ("[错误] {0}：产物目录 {1}\ 被下面这些进程占用（它们不是启动器本身）。" -f $Purpose, (Split-Path -Leaf $ProductDir))
        Log ""
        Log "  原因：启动器拉起的 dev server（node → pnpm → next）会把产物目录里的"
        Log "        _internal\*.dll 映射进自己的进程；启动器一旦异常退出，它们会残留成"
        Log "        孤儿，目录照样删不掉 —— 而关掉启动画面 / 桌面窗口都解不开这一条。"
        Log ""
        foreach ($h in $holders) { Log ("  正在占用的进程：PID {0}  {1}  ← {2}" -f $h.Id, $h.Name, $h.Module) }
        Log ""
        Log "  请结束它们（连带子进程树，别单杀）："
        foreach ($h in $holders) { Log ("    taskkill /PID {0} /T /F" -f $h.Id) }
    }
    Log ""
    return 1
}
