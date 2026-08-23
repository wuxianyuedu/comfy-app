@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ============================================================
REM Pure-ASCII launcher: all Chinese UI lives in dev-launcher.ps1
REM ============================================================

set "PS1_SCRIPT=%~dp0scripts\dev-launcher.ps1"

if not exist "%PS1_SCRIPT%" (
    echo [ERROR] scripts\dev-launcher.ps1 not found.
    goto :end
)

REM ---- Pick PowerShell: pwsh 7 first (PATH -> well-known paths), fallback to 5.1 ----
set "PS_EXE="

where pwsh >nul 2>nul && set "PS_EXE=pwsh"

if not defined PS_EXE if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PS_EXE=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined PS_EXE if exist "%ProgramFiles(x86)%\PowerShell\7\pwsh.exe" set "PS_EXE=%ProgramFiles(x86)%\PowerShell\7\pwsh.exe"
if not defined PS_EXE set "PS_EXE=powershell"

echo [INFO] Using PowerShell: %PS_EXE%

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1_SCRIPT%" %*
set "EXITCODE=%errorlevel%"

if not "%EXITCODE%"=="0" (
    echo [ERROR] dev-launcher.ps1 exited with code %EXITCODE%
) else (
    echo [INFO] dev-launcher.ps1 finished normally.
)

:end
echo.
echo ============================================
echo   Finished. Press any key to close.
echo ============================================

REM Only pause when double-clicked; skip when called from existing terminal
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
