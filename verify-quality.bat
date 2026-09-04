@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM Comfy-APP-T3 本地质量门禁（一键验证，给非开发人员用）
REM
REM 默认跑全部三项：typecheck / eslint(零警告) / vitest。
REM 用法（可选参数透传给 scripts\quality-gate.ps1）：
REM   verify-quality.bat                全部三项
REM   verify-quality.bat typecheck      仅类型检查
REM   verify-quality.bat lint           仅 eslint
REM   verify-quality.bat test           仅 vitest（排除已知基线失败）
REM
REM 依赖：本机需先装好 Node + pnpm，并已在项目根执行过 `pnpm install`。
REM 失败定位与"新增校验怎么补"见 scripts\quality-gate.ps1 头部注释。
REM ============================================================

set "EXITCODE=0"

if not exist "node_modules\.bin" (
    echo [ERROR] 未检测到 node_modules\.bin。
    echo         请先在项目根目录用开发人员帮忙执行：pnpm install
    set "EXITCODE=1"
    goto :end
)

set "MODE=%~1"
if "%MODE%"=="" set "MODE=all"

echo [INFO] 开始质量验证，模式：%MODE% （typecheck/lint/test/all）
echo [INFO] 底层脚本：scripts\quality-gate.ps1
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\quality-gate.ps1" -Mode %MODE%
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
    echo [ERROR] 质量门禁失败，退出码 %EXITCODE%
    echo         请查看上方红字标出的失败步骤，修复后重新双击本脚本。
) else (
    echo [OK] 全部质量门禁通过。
)

:end
echo.
echo ============================================
echo   验证结束，按任意键关闭。
echo ============================================
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
exit /b %EXITCODE%
