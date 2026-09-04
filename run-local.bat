@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 非开发人员本地运行引导入口
:: 切换到脚本所在目录，防止从其它位置双击时找不到项目文件
cd /d "%~dp0"

echo [INFO] 正在执行本地运行环境自检与初始化...
echo [INFO] 调用 PowerShell 脚本：scripts\prepare-local-run.ps1
echo.

pwsh -NoProfile -ExecutionPolicy Bypass -File "scripts\prepare-local-run.ps1"
set "EXITCODE=%errorlevel%"

if not "%EXITCODE%"=="0" (
    echo.
    echo [ERROR] 初始化未完成，代码 %EXITCODE% 。请阅读上方中文提示。
    echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
    exit /b %EXITCODE%
)

:: 仅双击启动时暂停；从已有终端调用时不暂停
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
