# prepare-local-run.ps1 - 非开发人员本地运行引导（由入口 tools/start/run-local.ps1 调用）
# 职责：检查 node/pnpm -> 补齐 .env -> 补齐 node_modules -> 提示启动方式
# 说明：面向普通用户，任何失败都要给出人能看懂的中文提示，不静默失败。

param()

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

# 项目根 = 本脚本上一级
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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
Write-Host "---------- [1/4] 检查 Node.js ----------" -ForegroundColor White
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
Write-Host "---------- [2/4] 检查 pnpm ----------" -ForegroundColor White
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

# ── 3) 生成 .env（已存在则跳过）───────────────────────────────
Write-Host ""
Write-Host "---------- [3/4] 生成本地配置 .env ----------" -ForegroundColor White
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

# ── 4) 检查 / 安装依赖 node_modules ───────────────────────────
Write-Host ""
Write-Host "---------- [4/4] 检查项目依赖 ----------" -ForegroundColor White
# 只探测"装没装"会漏掉"装的是旧 lockfile"的情况：拉取新增依赖后没重装，依赖是
# 残缺的，但 .modules.yaml 与 next.cmd 都在 → 被当成"已就绪"而跳过安装。
# 追加"lockfile 漂移"判定：pnpm 会把最近一次成功安装的 lockfile 复制到
# node_modules\.pnpm\lock.yaml，与仓库根 pnpm-lock.yaml 不一致即说明依赖陈旧，需重装。
$instLock = Join-Path $root "node_modules\.pnpm\lock.yaml"
$drifted  = $false
if ((Test-Path (Join-Path $root "node_modules")) -and (Test-Path (Join-Path $root "pnpm-lock.yaml"))) {
    if (-not (Test-Path $instLock)) { $drifted = $true }
    else {
        $hRoot = (Get-FileHash -LiteralPath (Join-Path $root "pnpm-lock.yaml") -Algorithm SHA256).Hash
        $hInst = (Get-FileHash -LiteralPath $instLock -Algorithm SHA256).Hash
        $drifted = ($hRoot -ne $hInst)
    }
}
$needInstall = -not (Test-Path (Join-Path $root "node_modules\.modules.yaml")) -or
               -not (Test-Path (Join-Path $root "node_modules\.bin\next.cmd")) -or
               $drifted
if ($drifted) { Say-Warn "检测到依赖与 lockfile 不一致（拉取更新后未重装），将补装依赖..." }
if ($needInstall) {
    Say-Warn "依赖尚未完整安装，正在执行 pnpm install（首次较久，请勿关闭窗口）..."
    Write-Host ""
    Push-Location $root
    try {
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

# ── 完成提示 ──────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  初始化完成！" -ForegroundColor Green
Write-Host "  接下来请双击 tools\start\start-web.ps1 启动。" -ForegroundColor Green
Write-Host "  启动后再用浏览器打开：http://localhost:3000" -ForegroundColor Green
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
