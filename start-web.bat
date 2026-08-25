@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 切换到脚本所在目录，防止从其它位置双击时找不到项目文件
cd /d "%~dp0"

echo [INFO] 启动 Comfy-APP Web 开发模式（控制台显示日志）...
echo [INFO] 使用 PowerShell 脚本：scripts\dev-launcher.ps1
echo.

pwsh -NoProfile -ExecutionPolicy Bypass -File "scripts\dev-launcher.ps1"

set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" (
    echo [ERROR] 启动器异常退出，代码 %EXITCODE%
)

:: 仅双击启动时暂停；从已有终端调用时不暂停
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
