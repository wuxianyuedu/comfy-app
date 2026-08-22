@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ============================================================
REM One-time registration of the comfyapp:// custom URL protocol.
REM Double-click this file to run scripts/install-comfyapp-helper.ps1
REM (user-level HKCU write, NO administrator privileges required).
REM ============================================================

set "PS1_SCRIPT=%~dp0scripts\install-comfyapp-helper.ps1"

if not exist "%PS1_SCRIPT%" (
    echo [ERROR] scripts\install-comfyapp-helper.ps1 not found.
    goto :end
)

echo [INFO] Registering comfyapp:// protocol (HKCU, no admin needed)...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1_SCRIPT%"
set "EXITCODE=%errorlevel%"

echo.
if not "%EXITCODE%"=="0" (
    echo [ERROR] Installer exited with code %EXITCODE%.
) else (
    echo [OK] comfyapp:// protocol registered. You can now use "Open Folder" in task history.
)

:end
echo.
echo ============================================
echo   Finished. Press any key to close.
echo ============================================
echo %cmdcmdline% | findstr /i /c:"%~nx0" >nul && pause >nul
