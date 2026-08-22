@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 切换到脚本所在目录，防止从其它位置双击时找不到项目文件
cd /d "%~dp0"

echo ===================================================
echo   Comfy-APP 本地启动
echo ===================================================

:: ── 0) 清理上次残留的 Node.js 进程 ──────────────────
echo [0/3] 检查残留 Node.js 进程...
tasklist /FI "IMAGENAME eq node.exe" /NH 2>nul | findstr /I "node.exe" >nul 2>&1
if not errorlevel 1 (
  echo       发现残留 Node.js 进程，正在清理...
  taskkill /F /IM node.exe >nul 2>&1
  echo       已清理。
) else (
  echo       无残留进程。
)

:: 检查 Node / npm 是否在 PATH 中
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 node，请先安装 Node.js 并将其加入 PATH。
  goto :error
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm。
  goto :error
)

:: 1) 同步数据库结构（用 npx 调用本地 prisma，不依赖全局安装）
echo [1/3] 同步数据库结构：npx prisma db push
call npx prisma db push --accept-data-loss
if errorlevel 1 (
  echo [错误] prisma db push 失败，请查看上面的报错信息。
  goto :error
)

:: 2) 启动开发服务器（用 Node 包装器，确保关窗口也干净退出）
echo [2/3] 启动开发服务器：node scripts/dev-launcher.js
echo       启动完成后访问 http://localhost:3000
echo.
echo       ★ 重要提示：
echo         - 可以用 Ctrl+C 停止，也可以直接关闭窗口
echo         - 现在关闭窗口也会自动杀掉所有子进程，不会残留
echo.
node scripts/dev-launcher.js

:: 3) 退出后再次兜底清理（极少情况下需要）
echo [3/3] 服务已停止，兜底清理子进程...
taskkill /F /IM node.exe >nul 2>&1
echo       清理完成。

echo.
echo 开发服务器已退出。
goto :done

:error
echo.
echo ===================================================
echo   启动失败，请根据上面的错误信息排查后重试。
echo ===================================================

:done
pause
