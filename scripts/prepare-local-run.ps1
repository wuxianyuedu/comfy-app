# prepare-local-run.ps1 - 非开发人员本地运行引导（由入口 tools/start/run-local.ps1 调用）
# 职责：检查 node/pnpm -> 补齐 .env -> 补齐 node_modules -> 补齐 comfy-cli 运行环境 -> 提示启动方式
# 说明：面向普通用户，任何失败都要给出人能看懂的中文提示，不静默失败。

param()

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

# 项目根 = 本脚本上一级
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 应用端口解析（.env 显式值 / 按检出路径推导），与启动链路各层同源（§1.1/§1.4）
. (Join-Path $PSScriptRoot "app-port.ps1")

$env:CI = "true"   # 让 pnpm 非交互，不弹「是否重装」对话框

function Say-OK   { Write-Host "[OK]   " -NoNewline -ForegroundColor Green; Write-Host "$args" }
function Say-Warn { Write-Host "[WARN] " -NoNewline -ForegroundColor Yellow; Write-Host "$args" }
function Say-Info { Write-Host "[INFO] " -NoNewline -ForegroundColor Cyan;   Write-Host "$args" }
function Say-Err  { Write-Host "[ERROR]" -NoNewline -ForegroundColor Red;    Write-Host "$args" }

try {
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Comfy APP (T3) 本地运行引导" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "项目目录：$root"
Write-Host ""

# ── 1) 检查 node ──────────────────────────────────────────────
Write-Host "---------- [1/6] 检查 Node.js ----------" -ForegroundColor White
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Say-Err "未检测到 Node.js。"
    Say-Info "请先到 https://nodejs.org/ 下载 LTS 版安装（一路下一步即可），装完重启电脑后再双击本脚本。"
    Read-Host "按回车键关闭"
    exit 1
}
Say-OK "Node.js 版本：$(& node -v)"

# ── 2) 检查 / 开启 pnpm（corepack）────────────────────────────
Write-Host ""
Write-Host "---------- [2/6] 检查 pnpm ----------" -ForegroundColor White
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Say-Warn "未检测到 pnpm，尝试用 Node 自带的 corepack 开启..."
    try {
        & corepack enable
        Say-OK "corepack 已开启 pnpm。"
    } catch {
        Say-Err "自动开启 pnpm 失败：$($_.Exception.Message)"
        Say-Info "请手动执行一次：corepack enable"
        Read-Host "按回车键关闭"
        exit 1
    }
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
}
if ($pnpm) {
    Say-OK "pnpm 可用：$(& pnpm -v)"
} else {
    Say-Err "仍未找到 pnpm，请关闭并重开一个终端执行 'corepack enable' 后再试。"
    Read-Host "按回车键关闭"
    exit 1
}

# ── 3) 版本一致性检查：pnpm 是否与 package.json 的 packageManager 对齐 ──
Write-Host ""
Write-Host "---------- [3/6] 检查 pnpm 版本 ----------" -ForegroundColor White
$expectedPnpm = ""
try {
    $pkgContent = Get-Content -Raw -Path (Join-Path $root "package.json")
    $pkgJson = $pkgContent | ConvertFrom-Json
    if ($pkgJson.packageManager -and $pkgJson.packageManager -match '^pnpm@(\S+)$') {
        $expectedPnpm = $Matches[1]
    }
} catch {
    Say-Warn "解析 package.json 的 packageManager 字段失败：$($_.Exception.Message)"
}

if ($expectedPnpm) {
    $actualPnpm = ""
    try { $actualPnpm = (& pnpm -v 2>$null | Select-Object -First 1) } catch { }
    if ($null -eq $actualPnpm) { $actualPnpm = "" }
    $actualPnpm = $actualPnpm.ToString().Trim()
    $actualClean = $actualPnpm.TrimStart('v')
    $expectedClean = $expectedPnpm.TrimStart('v')
    if ($actualClean -eq $expectedClean) {
        Say-OK "pnpm 版本与项目要求一致（$actualPnpm）。"
    } else {
        Say-Warn "pnpm 版本不一致：本机 $actualPnpm，项目 package.json 要求 pnpm@$expectedPnpm。"
        Say-Info "尝试用 Node 自带 corepack 自动对齐..."
        try {
            & corepack enable
            & corepack prepare "pnpm@$expectedPnpm" --activate
            if ($LASTEXITCODE -eq 0) {
                Say-OK "已自动切换到 pnpm@$expectedPnpm。"
            } else {
                Say-Err "corepack 自动切换失败（exit=$LASTEXITCODE）。"
                Say-Info "请手动在终端执行：corepack enable && corepack prepare pnpm@$expectedPnpm --activate"
                Read-Host "按回车键继续（不阻断初始化，但可能后续报错）"
            }
        } catch {
            Say-Warn "corepack 切换异常：$($_.Exception.Message)。可忽略，若后续 pnpm install 报错再手动处理。"
        }
    }
} else {
    Say-Info "package.json 未声明 pnpm 版本要求，跳过版本比对。"
}

# ── 4) 生成 .env（已存在则跳过）───────────────────────────────
Write-Host ""
Write-Host "---------- [4/6] 生成本地配置 .env ----------" -ForegroundColor White
$envFile = Join-Path $root ".env"
if (Test-Path $envFile) {
    Say-OK "已存在 .env，跳过生成（不覆盖你的配置）。"
} else {
    $example = Join-Path $root ".env.example"
    if (-not (Test-Path $example)) {
        Say-Err "找不到 .env.example，无法生成 .env。"
        exit 1
    }
    try {
        $content = Get-Content -Raw -Path $example
        # 随机生成 better-auth 密钥（64 位 hex，满足 >= 32 位校验要求）
        $secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
        # GitHub OAuth 本地无配置时用占位值（避免空串被当缺失导致启动校验失败）
        $placeholder = "local-dev-placeholder"
        # 逐行按 KEY= 覆盖，兼容 example 未来值的变化（multiline 锚定行首）
        $content = $content -replace '(?m)^BETTER_AUTH_SECRET=.*$', ("BETTER_AUTH_SECRET=`"$secret`"")
        $content = $content -replace '(?m)^BETTER_AUTH_GITHUB_CLIENT_ID=.*$', ("BETTER_AUTH_GITHUB_CLIENT_ID=`"$placeholder`"")
        $content = $content -replace '(?m)^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$', ("BETTER_AUTH_GITHUB_CLIENT_SECRET=`"$placeholder`"")
        Set-Content -Path $envFile -Value $content -Encoding utf8 -Force
        Say-OK "已生成 .env（含自动生成的本地密钥）。"
    } catch {
        Say-Err "生成 .env 失败：$($_.Exception.Message)"
        exit 1
    }
}

# ── 5) 检查 / 安装依赖 node_modules ───────────────────────────
Write-Host ""
Write-Host "---------- [5/6] 检查项目依赖 ----------" -ForegroundColor White
# 只探测"装没装"会漏掉"装的是旧 lockfile"的情况：拉取新增依赖后没重装，依赖是
# 残缺的，但 .modules.yaml 与 next.cmd 都在 → 被当成"已就绪"而跳过安装。
# 追加"lockfile 漂移"判定：pnpm 会把最近一次成功安装的 lockfile 复制到
# node_modules\.pnpm\lock.yaml，与仓库根 pnpm-lock.yaml 有**实质**差异即说明
# 依赖陈旧，需重装。
# 判据只能是"实质差异"、不能是文件哈希：pnpm 复制出去的那份与仓库根那份本就
# 不同形（注释 / 空行 / 条目顺序都不一样），逐字节哈希比对恒为"不一致" →
# 每一次双击入口都跑一遍全量 pnpm install。真正的判据在 Node 侧
# scripts/lockfile/diff-cli.mjs（与启动器 launcher-core/worktree.mjs 同源，
# 全仓唯一实现），退出码：0 一致 / 1 有实质差异 / 2 参数或读取错误。
$instLock    = Join-Path $root "node_modules\.pnpm\lock.yaml"
$drifted     = $false
$hasInstLock = $false
$driftReport = @()
if ((Test-Path (Join-Path $root "node_modules")) -and (Test-Path (Join-Path $root "pnpm-lock.yaml"))) {
    if (-not (Test-Path $instLock)) { $drifted = $true }
    else {
        $hasInstLock = $true
        Push-Location $root
        try {
            $driftReport = & node "scripts\lockfile\diff-cli.mjs" --installed $instLock --root $root 2>&1
            $diffExit    = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        # 退出码 2 是"判不了"（缺文件 / 参数错）—— 保守按已漂移处理，宁可多装一次。
        $drifted = ($diffExit -ne 0)
    }
}
$needInstall = -not (Test-Path (Join-Path $root "node_modules\.modules.yaml")) -or
               -not (Test-Path (Join-Path $root "node_modules\.bin\next.cmd")) -or
               $drifted
if ($drifted) {
    Say-Warn "检测到依赖与 lockfile 不一致（拉取更新后未重装），将补装依赖..."
    # 只报「不一致」用户无从判断是什么变了（ISSUE #550）：把差异逐项打印出来。
    # 差异定位在 Node 侧 scripts/lockfile/lock-diff.mjs（唯一实现，质量门禁复用），
    # 这里只负责展示判定阶段那次调用的结果，不再自己实现一遍解析、也不再调第二次。
    if ($hasInstLock) {
        Say-Info "下面列出不一致的具体位置（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）："
        $driftReport | ForEach-Object { Write-Host $_ }
        Write-Host ""
    } else {
        Say-Info "本次是首次安装（没有可比对的历史 lockfile），跳过差异明细。"
    }
}
if ($needInstall) {
    Say-Warn "依赖尚未完整安装，正在执行 pnpm install（首次较久，请勿关闭窗口）..."
    Write-Host ""
    Push-Location $root
    try {
        # 命令行回显：`pnpm install` 是本脚本最久的一步，先打印再执行（与 .mjs 侧
        # 同一 `>>> ` 前缀；那侧的唯一出口是 launcher-core/command-echo.mjs）。
        Write-Host ">>> pnpm install" -ForegroundColor Yellow
        & pnpm install
        if ($LASTEXITCODE -ne 0) {
            Say-Err "pnpm install 失败（exit=$LASTEXITCODE）。请检查网络后重新双击本脚本。"
            Read-Host "按回车键关闭"
            exit 1
        }
    } finally {
        Pop-Location
    }
    Say-OK "依赖安装完成。"
} else {
    Say-OK "依赖已就绪，跳过安装。"
}

# ── 6) 检查 / 安装 comfy-cli 运行环境 ───────────────────────────
Write-Host ""
Write-Host "---------- [6/6] 检查 comfy-cli 运行环境 ----------" -ForegroundColor White
# raw UI-format（liblib 子图）工作流需要 comfy-cli 做 UI→API 转换，执行器固定使用
# <项目根>/python-venv/comfy-cli 下的 Python 解释器。该 venv 缺失时工作流执行会直接
# 报「未找到 comfy-cli Python 解释器」。本地初始化阶段就把缺失的环境补齐：调用
# scripts\setup-comfy-cli-venv.ps1（幂等：已就绪则跳过；失败也不阻断启动）。
$comfyVenv  = Join-Path $root "python-venv\comfy-cli\Scripts\python.exe"
$comfySetup = Join-Path $root "scripts\setup-comfy-cli-venv.ps1"
if (Test-Path $comfyVenv) {
    Say-OK "comfy-cli 运行环境已就绪，跳过安装。"
} elseif (-not (Test-Path $comfySetup)) {
    Say-Warn "未找到 comfy-cli 安装脚本（$comfySetup），跳过检测。"
} else {
    Say-Warn "未检测到 comfy-cli 运行环境，正在创建并安装（首次较慢，请勿关闭窗口）..."
    Write-Host ""
    try {
        Write-Host ">>> pwsh -ExecutionPolicy Bypass -File scripts\setup-comfy-cli-venv.ps1" -ForegroundColor Yellow
        & $comfySetup
        if ($LASTEXITCODE -ne 0) {
            Say-Err "comfy-cli 运行环境安装失败（exit=$LASTEXITCODE）。"
            Say-Info "工作流执行将不可用，但不影响应用启动；联网后可重新双击本脚本补齐。"
        } else {
            Say-OK "comfy-cli 运行环境已就绪。"
        }
    } catch {
        Say-Err "comfy-cli 安装脚本异常：$($_.Exception.Message)"
        Say-Info "工作流执行将不可用，但不影响应用启动；可重新双击本脚本重试。"
    }
}

# ── 完成提示 ──────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  初始化完成！" -ForegroundColor Green
Write-Host "  接下来请双击 tools\start\start-web.ps1 启动。" -ForegroundColor Green
# 端口取值与启动链路同源（§1.1/§1.4），此处读取后提示真实地址
$showedPort = Get-AppPort $root
Write-Host "  启动后再用浏览器打开：http://localhost:$showedPort" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
}
catch {
    Write-Host ""
    Say-Err "本地初始化脚本出现未预期的错误（请勿关闭本窗口）：$($_.Exception.Message)"
    Say-Err "位置：$($_.InvocationInfo.PositionMessage)"
    Say-Info "请将上方红色错误信息截图反馈给维护者。"
    Read-Host "按回车键关闭窗口"
    exit 1
}
