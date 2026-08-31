#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
start_tauri_launcher.py — Comfy-APP 桌面壳启动器（纯 Win32 启动画面）

取代了原来的 start-tauri.vbs：点击后立刻弹出一个暗色启动画面，
明确告知「正在启动」，避免「点了像没反应」的困惑。

职责：
  1. 弹出 Win32 自绘启动画面（暗色极光风格，与 app 一致）。
  2. 在隐藏窗口中调用 scripts/dev-launcher.ps1 -Tauri 启动 Tauri 桌面壳。
  3. 轮询 Win32 窗口，直到 Tauri 主窗口（标题 "Comfy APP"）出现后关闭画面。
  4. 兜底：超过 240s 仍未检测到窗口则关闭画面（不杀启动进程）；
     若启动进程提前异常退出则画面提示失败。

依赖：仅 Python 标准库 + ctypes（无需 tkinter，避免 PyInstaller 打包缺库）。

打包为目录式 exe（onedir，无控制台窗口）：
    pyinstaller --onedir --windowed --name start-tauri --distpath . scripts/start_tauri_launcher.py
生成的 start-tauri/ 目录（含 start-tauri.exe 与 _internal 依赖）放在项目根目录。
使用 --onedir 而非 --onefile：避免单文件运行时解压到 Temp/_MEI* 临时目录，
退出时若子进程持有该目录句柄会清理失败并弹警告。onedir 模式无需解压，
双击 start-tauri/start-tauri.exe 即可启动。
"""

from __future__ import annotations

import os
import sys
import json
import time
import math
import shutil
import threading
import subprocess
import traceback
import tempfile
from datetime import datetime
from pathlib import Path

import ctypes

# ═══════════════════════════════════════════════════════════════════════════════
#  Win32 类型别名
# ═══════════════════════════════════════════════════════════════════════════════
# Python 3.13 大幅精简 ctypes.wintypes，很多 HANDLE 类别名被移除。
# 这里全部用 ctypes 原生类型定义，避免打包后运行时找不到属性。
LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
UINT_PTR = ctypes.c_size_t
BOOL = ctypes.c_int
DWORD = ctypes.c_uint32
UINT = ctypes.c_uint
ATOM = ctypes.c_ushort
COLORREF = ctypes.c_uint32
LPCWSTR = ctypes.c_wchar_p
HANDLE = ctypes.c_void_p
HWND = HANDLE
HINSTANCE = HANDLE
HMENU = HANDLE
HICON = HANDLE
HCURSOR = HANDLE
HBRUSH = HANDLE
HDC = HANDLE
HFONT = HANDLE
HPEN = HANDLE
HGDIOBJ = HANDLE
LPVOID = HANDLE

# 回调类型
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, HWND, LPARAM)

# 预定义光标 ID（IDC_ARROW）通过 MAKEINTRESOURCE 方式传递
IDC_ARROW = ctypes.c_void_p(32512)

# ═══════════════════════════════════════════════════════════════════════════════
#  Win32 常量
# ═══════════════════════════════════════════════════════════════════════════════
CW_USEDEFAULT = 0x80000000
WS_POPUP = 0x80000000
WS_VISIBLE = 0x10000000
WS_EX_LAYERED = 0x00080000
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
WM_DESTROY = 2
WM_PAINT = 15
WM_TIMER = 275
WM_CLOSE = 16
WM_QUIT = 18
WM_LBUTTONDOWN = 0x0201
WM_KEYDOWN = 0x0100
VK_ESCAPE = 0x1B
SRCCOPY = 0x00CC0020
TRANSPARENT = 1
OPAQUE = 2
DT_LEFT = 0x00000000
DT_CENTER = 0x00000001
DT_VCENTER = 0x00000004
DT_SINGLELINE = 0x00000020
DT_NOPREFIX = 0x00000800
HWND_TOPMOST = -1
SWP_FRAMECHANGED = 0x0020
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_SHOWWINDOW = 0x0040
SWP_NOACTIVATE = 0x0010
LOGPIXELSX = 88
SM_CXSCREEN = 0
SM_CYSCREEN = 1
DEFAULT_GUI_FONT = 17
FW_NORMAL = 400
FW_BOLD = 700
MB_ICONERROR = 0x10
MB_ICONWARNING = 0x30
MB_OK = 0x00
PROCESS_DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ctypes.c_void_p(-4)

# ═══════════════════════════════════════════════════════════════════════════════
#  暗色极光配色（与 app 的 #0A0A0F 背景 / violet 主色一致）
# ═══════════════════════════════════════════════════════════════════════════════
BG = 0x0F0A0A  # 0A0A0F in BGR
PANEL = 0x1C1012  # #12101C in BGR
VIOLET = 0xFC5C7C  # #7C5CFC in BGR
GRAY = 0xAF9CA3  # #9CA3AF in BGR
GRAY_DIM = 0x80726B  # #6B7280 in BGR
ERROR_RED = 0x4444EF  # #EF4444 in BGR

SPLASH_W = 520
SPLASH_H = 210

APP_TITLE = "Comfy APP"
APP_WINDOW_TITLE = "Comfy APP"

# ═══════════════════════════════════════════════════════════════════════════════
#  日志（辅助排查，写入项目根目录 log/start-tauri-launcher.log）
# ═══════════════════════════════════════════════════════════════════════════════
_log_file: object | None = None
_log_lock = threading.Lock()


def _ensure_log_dir(project_root: str) -> str:
    log_dir = os.path.join(project_root, "log")
    try:
        os.makedirs(log_dir, exist_ok=True)
    except OSError:
        pass
    return log_dir


def log(message: str) -> None:
    """写一行日志到文件；失败则静默忽略，不阻塞启动流程。"""
    try:
        with _log_lock:
            if _log_file is None:
                return
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
            _log_file.write(f"[{timestamp}] {message}\n")
            _log_file.flush()
    except Exception:
        pass


def init_logging(project_root: str) -> None:
    global _log_file
    try:
        log_dir = _ensure_log_dir(project_root)
        # 按日期轮转，保留最近 5 份
        base = os.path.join(log_dir, "start-tauri-launcher.log")
        if os.path.exists(base) and os.path.getsize(base) > 512 * 1024:
            for i in range(4, 0, -1):
                src = f"{base}.{i}"
                dst = f"{base}.{i + 1}"
                if os.path.exists(src):
                    try:
                        shutil.move(src, dst)
                    except OSError:
                        pass
            try:
                shutil.move(base, f"{base}.1")
            except OSError:
                pass
        # 覆盖模式打开：应用内日志面板只应显示「本次」启动的 launcher 日志，
        # 避免把昨天/之前的启动记录也带进来。历史日志仍通过上方的轮转保留。
        _log_file = open(base, "w", encoding="utf-8", buffering=1)
        log("=== launcher started ===")
        log(f"python={sys.version}")
        log(f"exe={sys.executable}")
        log(f"cwd={os.getcwd()}")
    except Exception:
        _log_file = None


def close_logging() -> None:
    try:
        with _log_lock:
            if _log_file is not None:
                _log_file.close()
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════════════════════════════════════════
def _is_project_root(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "scripts", "dev-launcher.ps1"))


def get_project_root() -> str:
    """
    项目根目录探测顺序：
      1. 当前工作目录（双击 exe 时通常是 exe 所在目录）。
      2. exe 所在目录，及其父目录（兼容 --onedir 布局：start-tauri/start-tauri.exe）。
      3. 脚本源文件所在目录的父目录（开发时直接 python 运行）。
    """
    candidates: list[str] = []

    cwd = os.getcwd()
    if _is_project_root(cwd):
        return cwd
    candidates.append(cwd)

    # --onedir 产物: start-tauri/start-tauri.exe 时，exe_dir 是 start-tauri/，
    # 项目根目录是它的父目录；onefile 产物: start-tauri.exe 直接在根目录。
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    for depth, directory in enumerate([exe_dir, os.path.dirname(exe_dir)]):
        if directory not in candidates and _is_project_root(directory):
            return directory
        candidates.append(f"{directory} (up {depth})")

    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        parent = os.path.dirname(script_dir)
        if parent not in candidates and _is_project_root(parent):
            return parent
        candidates.append(parent)
    except NameError:
        pass

    log(f"warning: cannot locate project root, tried {candidates}")
    return cwd


def find_tauri_window() -> bool:
    """枚举顶层窗口，查找标题包含 APP_WINDOW_TITLE 的可见窗口。"""
    try:
        found = [False]

        def callback(hwnd: HWND, _lparam: LPARAM) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value or ""
            if APP_WINDOW_TITLE in title:
                found[0] = True
                return False
            return True

        proc = WNDENUMPROC(callback)
        user32.EnumWindows(proc, 0)
        callback._keep = proc  # type: ignore[attr-defined]
        return found[0]
    except Exception as exc:
        log(f"find_tauri_window error: {exc}")
        return False


def find_and_focus_tauri_window() -> bool:
    """如果 Tauri 窗口已存在，尝试把它带到前台并返回 True。"""
    try:
        target: HWND = 0

        def callback(hwnd: HWND, _lparam: LPARAM) -> bool:
            nonlocal target
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value or ""
            if APP_WINDOW_TITLE in title:
                target = hwnd
                return False
            return True

        proc = WNDENUMPROC(callback)
        user32.EnumWindows(proc, 0)
        callback._keep = proc  # type: ignore[attr-defined]

        if target:
            user32.ShowWindow(target, 9)  # SW_RESTORE
            user32.SetForegroundWindow(target)
            log("found existing tauri window, brought to foreground")
            return True
        return False
    except Exception as exc:
        log(f"find_and_focus_tauri_window error: {exc}")
        return False


def set_dpi_aware() -> None:
    """高 DPI 屏幕避免模糊。"""
    try:
        user32.SetProcessDpiAwarenessContext(PROCESS_DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
    except Exception:
        try:
            user32.SetProcessDPIAware()
        except Exception:
            pass


def create_mutex(name: str) -> HANDLE:
    """创建命名互斥体，用于防止重复启动。"""
    try:
        return kernel32.CreateMutexW(None, False, name)
    except Exception:
        return 0


def is_another_instance_running(mutex: HANDLE) -> bool:
    if not mutex:
        return False
    err = kernel32.GetLastError()
    return err == 183  # ERROR_ALREADY_EXISTS


# ── 陈旧锁自愈（比纯命名互斥量更容易定位/回收遗留进程）─────────────────────────
def _launcher_lock_file(project_root: str) -> str:
    """记录本实例 PID 的锁文件，供下一次启动判断锁是否陈旧。"""
    return os.path.join(project_root, "run", ".launcher.lock")


def _read_lock_pid(lock_file: str) -> int | None:
    try:
        with open(lock_file, "r", encoding="utf-8") as f:
            return int(f.read().strip())
    except Exception:
        return None


def _write_lock_pid(lock_file: str) -> None:
    try:
        os.makedirs(os.path.dirname(lock_file), exist_ok=True)
        with open(lock_file, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except Exception as e:
        log(f"write lock pid failed: {e}")


def _is_pid_alive(pid: int) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # 进程存在但无信号权限，仍视为存活
        return True
    except Exception:
        return False


def _safe_remove(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass



# ═══════════════════════════════════════════════════════════════════════════════
#  启动状态文件（供 Tauri 内嵌启动页读取）
# ═══════════════════════════════════════════════════════════════════════════════
STATUS_FILE = "launch-status.json"  # 位于 <project_root>/run/ 下

LAUNCH_PHASES = {
    "initial": {"progress": 0.0, "message": "启动器正在初始化…"},
    "port-check": {"progress": 0.05, "message": "检查端口占用…"},
    "port-ready": {"progress": 0.10, "message": "端口已就绪"},
    "cache": {"progress": 0.20, "message": "处理 .next 编译缓存…"},
    "job-object": {"progress": 0.35, "message": "创建 Windows 进程容器…"},
    "dev-server-starting": {"progress": 0.45, "message": "开发服务器进程已启动"},
    "tauri-compiling": {"progress": 0.55, "message": "等待 Tauri 桌面壳启动…"},
    "tauri-shell-started": {"progress": 0.58, "message": "Tauri 桌面壳已启动，等待服务就绪…"},
    "dev-server-ready": {"progress": 0.85, "message": "本地服务已就绪，正在加载应用…"},
    "ready": {"progress": 1.0, "message": "启动完成"},
    "error": {"progress": 1.0, "message": "启动失败"},
    "timeout": {"progress": 1.0, "message": "启动时间较长，但仍在进行中…"},
}


def _status_file_path(project_root: str) -> str:
    return os.path.join(project_root, "run", STATUS_FILE)


def _resolve_dev_log_path(project_root: str) -> str:
    """dev-launcher.ps1 可能因 dev-launcher.log 被占用而回退到其它文件名，

    通过 sentinel 文件定位本次运行的真实日志路径。
    """
    default = os.path.join(project_root, "log", "dev-launcher.log")
    sentinel = os.path.join(project_root, "log", "dev-launcher-current.txt")
    try:
        with open(sentinel, "r", encoding="utf-8") as f:
            path = f.read().strip()
        if path and os.path.isfile(path):
            return path
    except Exception:
        pass
    return default


def _write_status(
    project_root: str,
    phase: str,
    message: str = "",
    *,
    ready: bool = False,
    error: bool = False,
    elapsed: float = 0.0,
    app_url: str = "http://localhost:3000/workspace",
) -> None:
    """把当前启动状态写入 <project_root>/run/launch-status.json。

    Tauri 内嵌启动页通过调用 Rust command 读取该文件并展示进度。
    """
    try:
        info = LAUNCH_PHASES.get(phase, LAUNCH_PHASES["initial"])
        payload = {
            "phase": phase,
            "progress": info["progress"],
            "message": message or info["message"],
            "elapsed": round(elapsed, 1),
            "ready": ready,
            "error": error,
            "app_url": app_url,
            "updated_at": datetime.now().isoformat(),
        }
        path = _status_file_path(project_root)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=None)
            f.flush()
            os.fsync(f.fileno())
    except Exception as exc:
        log(f"write_status error: {exc}")


def _cleanup_status(project_root: str) -> None:
    try:
        _safe_remove(_status_file_path(project_root))
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
#  Win32 API 原型
# ═══════════════════════════════════════════════════════════════════════════════
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
gdi32 = ctypes.windll.gdi32

user32.CreateWindowExW.argtypes = [
    DWORD, LPCWSTR, LPCWSTR, DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    HWND, HMENU, HINSTANCE, LPVOID,
]
user32.CreateWindowExW.restype = HWND

user32.DefWindowProcW.argtypes = [HWND, UINT, WPARAM, LPARAM]
user32.DefWindowProcW.restype = LRESULT

user32.RegisterClassExW.argtypes = [ctypes.c_void_p]
user32.RegisterClassExW.restype = ATOM

user32.UnregisterClassW.argtypes = [LPCWSTR, HINSTANCE]
user32.UnregisterClassW.restype = BOOL

user32.GetMessageW.argtypes = [ctypes.c_void_p, HWND, UINT, UINT]
user32.GetMessageW.restype = ctypes.c_int

user32.TranslateMessage.argtypes = [ctypes.c_void_p]
user32.TranslateMessage.restype = BOOL

user32.DispatchMessageW.argtypes = [ctypes.c_void_p]
user32.DispatchMessageW.restype = LRESULT

user32.PostQuitMessage.argtypes = [ctypes.c_int]

user32.PostMessageW.argtypes = [HWND, UINT, WPARAM, LPARAM]
user32.PostMessageW.restype = BOOL

user32.GetClientRect.argtypes = [HWND, ctypes.c_void_p]

user32.SetWindowPos.argtypes = [
    HWND, HWND, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int, UINT,
]
user32.SetWindowPos.restype = BOOL

# lpTimerFunc 传 None(=NULL) 表示用 WM_TIMER 消息投递到窗口过程，
# 不能用 TIMERPROC 函数指针类型声明（ctypes 不接受把 None 传给函数指针形参）。
user32.SetTimer.argtypes = [HWND, UINT_PTR, UINT, ctypes.c_void_p]
user32.SetTimer.restype = UINT_PTR

user32.KillTimer.argtypes = [HWND, UINT_PTR]
user32.KillTimer.restype = BOOL

user32.InvalidateRect.argtypes = [HWND, ctypes.c_void_p, BOOL]
user32.InvalidateRect.restype = BOOL

user32.LoadCursorW.argtypes = [HINSTANCE, HANDLE]
user32.LoadCursorW.restype = HCURSOR

user32.GetDC.argtypes = [HWND]
user32.GetDC.restype = HDC

user32.ReleaseDC.argtypes = [HWND, HDC]
user32.ReleaseDC.restype = ctypes.c_int

user32.BeginPaint.argtypes = [HWND, ctypes.c_void_p]
user32.BeginPaint.restype = HDC

user32.EndPaint.argtypes = [HWND, ctypes.c_void_p]
user32.EndPaint.restype = BOOL

user32.GetDesktopWindow.restype = HWND

user32.GetWindowRect.argtypes = [HWND, ctypes.c_void_p]
user32.GetWindowRect.restype = BOOL

user32.SetWindowTextW.argtypes = [HWND, LPCWSTR]

user32.IsWindowVisible.argtypes = [HWND]
user32.IsWindowVisible.restype = BOOL

user32.GetWindowTextLengthW.argtypes = [HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int

user32.GetWindowTextW.argtypes = [HWND, LPCWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int

user32.EnumWindows.argtypes = [WNDENUMPROC, LPARAM]
user32.EnumWindows.restype = BOOL

user32.ShowWindow.argtypes = [HWND, ctypes.c_int]
user32.ShowWindow.restype = BOOL

user32.SetForegroundWindow.argtypes = [HWND]
user32.SetForegroundWindow.restype = BOOL

user32.MessageBoxW.argtypes = [HWND, LPCWSTR, LPCWSTR, UINT]
user32.MessageBoxW.restype = ctypes.c_int

user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
user32.SetProcessDpiAwarenessContext.restype = BOOL

user32.SetProcessDPIAware.restype = BOOL

user32.GetCursorPos.argtypes = [ctypes.c_void_p]
user32.GetCursorPos.restype = BOOL

user32.MonitorFromPoint.argtypes = [ctypes.c_long * 2, DWORD]
user32.MonitorFromPoint.restype = HANDLE

user32.GetMonitorInfoW.argtypes = [HANDLE, ctypes.c_void_p]
user32.GetMonitorInfoW.restype = BOOL

kernel32.GetModuleHandleW.argtypes = [LPCWSTR]
kernel32.GetModuleHandleW.restype = HINSTANCE

kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, BOOL, LPCWSTR]
kernel32.CreateMutexW.restype = HANDLE

kernel32.GetLastError.restype = DWORD

kernel32.ReleaseMutex.argtypes = [HANDLE]
kernel32.ReleaseMutex.restype = BOOL

kernel32.CloseHandle.argtypes = [HANDLE]
kernel32.CloseHandle.restype = BOOL

# ── GDI ──
gdi32.CreateSolidBrush.argtypes = [COLORREF]
gdi32.CreateSolidBrush.restype = HBRUSH

gdi32.CreatePen.argtypes = [ctypes.c_int, ctypes.c_int, COLORREF]
gdi32.CreatePen.restype = HPEN

gdi32.SelectObject.argtypes = [HDC, HGDIOBJ]
gdi32.SelectObject.restype = HGDIOBJ

gdi32.DeleteObject.argtypes = [HGDIOBJ]
gdi32.DeleteObject.restype = BOOL

gdi32.SetTextColor.argtypes = [HDC, COLORREF]
gdi32.SetTextColor.restype = COLORREF

gdi32.SetBkColor.argtypes = [HDC, COLORREF]
gdi32.SetBkColor.restype = COLORREF

gdi32.SetBkMode.argtypes = [HDC, ctypes.c_int]
gdi32.SetBkMode.restype = ctypes.c_int

gdi32.Rectangle.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
gdi32.Rectangle.restype = BOOL

gdi32.RoundRect.argtypes = [
    HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int,
]
gdi32.RoundRect.restype = BOOL

gdi32.CreateFontW.argtypes = [
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    DWORD, DWORD, DWORD, DWORD,
    DWORD, DWORD, DWORD, DWORD,
    LPCWSTR,
]
gdi32.CreateFontW.restype = HFONT

gdi32.GetDeviceCaps.argtypes = [HDC, ctypes.c_int]
gdi32.GetDeviceCaps.restype = ctypes.c_int

gdi32.MoveToEx.argtypes = [HDC, ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
gdi32.MoveToEx.restype = BOOL

gdi32.LineTo.argtypes = [HDC, ctypes.c_int, ctypes.c_int]
gdi32.LineTo.restype = BOOL

# DrawTextW 在 user32.dll 中，不是 gdi32
user32.DrawTextW.argtypes = [
    HDC, LPCWSTR, ctypes.c_int, ctypes.c_void_p,
    UINT,
]
user32.DrawTextW.restype = ctypes.c_int

# ═══════════════════════════════════════════════════════════════════════════════
#  RECT / WNDCLASSEX 结构
# ═══════════════════════════════════════════════════════════════════════════════
class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("style", ctypes.c_uint),
        ("lpfnWndProc", ctypes.c_void_p),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", HINSTANCE),
        ("hIcon", HICON),
        ("hCursor", HCURSOR),
        ("hbrBackground", HBRUSH),
        ("lpszMenuName", LPCWSTR),
        ("lpszClassName", LPCWSTR),
        ("hIconSm", HICON),
    ]


class PAINTSTRUCT(ctypes.Structure):
    _fields_ = [
        ("hdc", HDC),
        ("fErase", BOOL),
        ("rcPaint", RECT),
        ("fRestore", BOOL),
        ("fIncUpdate", BOOL),
        ("rgbReserved", ctypes.c_byte * 32),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", DWORD),
        ("rcMonitor", RECT),
        ("rcWork", RECT),
        ("dwFlags", DWORD),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", HWND),
        ("message", UINT),
        ("wParam", WPARAM),
        ("lParam", LPARAM),
        ("time", DWORD),
        ("pt", POINT),
    ]


# ═══════════════════════════════════════════════════════════════════════════════
#  启动画面窗口类
# ═══════════════════════════════════════════════════════════════════════════════
class SplashWindow:
    def __init__(self):
        self.hwnd: HWND = 0
        self._closed = False
        self._progress = 0.0  # 0~1，基于启动阶段的真实进度
        self._marquee = 0.0  # 0~1，进度条上的流动高亮位置
        self._status = "ok"  # ok | error | timeout
        self._msg = "首次启动需编译，约 30–90 秒，请稍候…"
        self._title = APP_TITLE
        self._subtitle = "正在启动桌面应用…"
        self._wc_atom = 0
        self._class_name = "ComfyAppSplashW"
        self._timer_id = 1
        self._dragging = False
        self._drag_start_x = 0
        self._drag_start_y = 0
        self._wnd_proc_ref = None
        self._proc: "subprocess.Popen[str] | None" = None
        self._start_time = time.time()
        self._log_tailer: threading.Thread | None = None
        self._stop_tailer = threading.Event()
        self._close_btn_rect = (0, 0, 0, 0)  # left, top, right, bottom
        self._close_should_terminate = False

    def _register_class(self) -> bool:
        wnd_proc = ctypes.WINFUNCTYPE(
            LRESULT, HWND, UINT, WPARAM, LPARAM
        )(self._wnd_proc)
        self._wnd_proc_ref = wnd_proc  # keep reference

        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = ctypes.cast(wnd_proc, ctypes.c_void_p).value
        wc.hInstance = kernel32.GetModuleHandleW(None)
        wc.hCursor = user32.LoadCursorW(None, IDC_ARROW)
        wc.hbrBackground = 0
        wc.lpszClassName = self._class_name

        atom = user32.RegisterClassExW(ctypes.byref(wc))
        if atom == 0:
            log("RegisterClassExW failed")
            return False
        self._wc_atom = atom
        return True

    def _wnd_proc(self, hwnd: HWND, msg: UINT,
                  wparam: WPARAM, lparam: LPARAM) -> LRESULT:
        if msg == WM_PAINT:
            ps = PAINTSTRUCT()
            hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))
            self._paint(hdc)
            user32.EndPaint(hwnd, ctypes.byref(ps))
            return 0
        if msg == WM_TIMER:
            if self._status == "ok":
                self._marquee = (self._marquee + 0.03) % 1.0
            user32.InvalidateRect(hwnd, None, False)
            return 0
        if msg == WM_LBUTTONDOWN:
            x = ctypes.c_short(lparam & 0xFFFF).value
            y = ctypes.c_short((lparam >> 16) & 0xFFFF).value
            lx, ty, rx, by = self._close_btn_rect
            if lx <= x <= rx and ty <= y <= by:
                self._close_should_terminate = True
                user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
                return 0
            self._dragging = True
            self._drag_start_x = x
            self._drag_start_y = y
            return 0
        if msg == WM_MOUSEMOVE and self._dragging:
            x = ctypes.c_short(lparam & 0xFFFF).value
            y = ctypes.c_short((lparam >> 16) & 0xFFFF).value
            dx = x - self._drag_start_x
            dy = y - self._drag_start_y
            rect = RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            user32.SetWindowPos(
                hwnd, 0,
                rect.left + dx, rect.top + dy,
                0, 0,
                SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
            )
            return 0
        if msg == WM_LBUTTONUP:
            self._dragging = False
            return 0
        if msg == WM_KEYDOWN and wparam == VK_ESCAPE:
            self._close_should_terminate = True
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
            return 0
        if msg == WM_CLOSE or msg == WM_DESTROY:
            if self._close_should_terminate:
                self._terminate_proc()
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _create_font(self, hdc: HDC, size: int, bold: bool = False) -> HFONT:
        # 将 pt 转换为逻辑高度（负数表示字符高度）
        dpi = gdi32.GetDeviceCaps(hdc, LOGPIXELSX)
        height = -int(size * dpi / 72)
        return gdi32.CreateFontW(
            height, 0, 0, 0, FW_BOLD if bold else FW_NORMAL,
            0, 0, 0, 0, 0, 0, 0, 0,
            "Microsoft YaHei UI",
        )

    def _start_log_tailer(self, project_root: str):
        """后台读取 dev-launcher.log，把最新 STEP/OK 消息映射到画面状态与进度。"""
        log_path = _resolve_dev_log_path(project_root)
        last_size = 0
        # 阶段 → 进度百分比（粗略但有效）
        phase_progress = {
            "检查端口占用": 0.05,
            "端口已就绪": 0.10,
            "配置指纹": 0.15,
            "清空 .next": 0.20,
            "创建 Windows Job Object": 0.35,
            "开发服务器进程已启动": 0.45,
            "等待 tauri dev 编译": 0.55,
            "服务器已就绪": 0.85,
        }

        def _tail():
            nonlocal last_size, log_path
            while not self._stop_tailer.is_set():
                try:
                    # dev-launcher.ps1 可能因文件被占用回退到 dev-launcher-<pid>.log，
                    # 通过 sentinel 文件 dev-launcher-current.txt 定位本次运行的真实日志。
                    resolved = _resolve_dev_log_path(project_root)
                    if resolved != log_path:
                        log_path = resolved
                        last_size = 0
                    if not os.path.isfile(log_path):
                        time.sleep(0.5)
                        continue
                    size = os.path.getsize(log_path)
                    if size < last_size:
                        last_size = 0
                    if size == last_size:
                        time.sleep(0.3)
                        continue
                    with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                        f.seek(last_size)
                        text = f.read()
                    last_size = size
                    # 取最后一行非空内容
                    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                    if not lines:
                        continue
                    latest = lines[-1]
                    # 解析 [HH:MM:SS] [LEVEL] Message
                    msg = latest
                    if "[" in latest and "]" in latest:
                        # 去掉时间标签和级别标签
                        parts = latest.split("]")
                        if len(parts) >= 2:
                            msg = "]".join(parts[1:]).strip()
                            msg = msg.lstrip("[]STEP OK WARN ERROR INFO ").strip()
                    if not msg:
                        continue
                    # 根据关键字更新状态/进度
                    matched_progress = None
                    for key, pct in phase_progress.items():
                        if key in latest:
                            matched_progress = pct
                            break
                    if matched_progress is not None:
                        self._progress = matched_progress
                    if "ERROR" in latest or "错误" in latest:
                        self._msg = f"⚠ {msg[:60]}"
                    elif "STEP" in latest or "OK" in latest:
                        self._msg = msg[:70]
                    user32.InvalidateRect(self.hwnd, None, False)
                except Exception as exc:
                    log(f"log tailer error: {exc}")
                    time.sleep(1)

        t = threading.Thread(target=_tail, daemon=True)
        t.start()
        self._log_tailer = t

    def _paint(self, hdc: HDC):
        rc = RECT()
        user32.GetClientRect(self.hwnd, ctypes.byref(rc))
        w, h = rc.right, rc.bottom

        # 背景
        bg_brush = gdi32.CreateSolidBrush(BG)
        old_brush = gdi32.SelectObject(hdc, bg_brush)
        gdi32.Rectangle(hdc, 0, 0, w, h)
        gdi32.SelectObject(hdc, old_brush)
        gdi32.DeleteObject(bg_brush)

        # 面板（带 1px 紫色边框）
        pad = 10
        panel_brush = gdi32.CreateSolidBrush(PANEL)
        panel_pen = gdi32.CreatePen(0, 1, VIOLET)
        old_brush = gdi32.SelectObject(hdc, panel_brush)
        old_pen = gdi32.SelectObject(hdc, panel_pen)
        gdi32.RoundRect(hdc, pad, pad, w - pad, h - pad, 16, 16)
        gdi32.SelectObject(hdc, old_brush)
        gdi32.SelectObject(hdc, old_pen)
        gdi32.DeleteObject(panel_brush)
        gdi32.DeleteObject(panel_pen)

        # 文字
        gdi32.SetBkMode(hdc, TRANSPARENT)

        title_font = self._create_font(hdc, 18, bold=True)
        old_font = gdi32.SelectObject(hdc, title_font)
        gdi32.SetTextColor(hdc, VIOLET if self._status != "error" else ERROR_RED)

        title_rc = RECT()
        title_rc.left = pad + 24
        title_rc.top = pad + 20
        title_rc.right = w - pad - 50  # 给关闭按钮留空
        title_rc.bottom = title_rc.top + 28
        user32.DrawTextW(hdc, self._title, -1, ctypes.byref(title_rc),
                         DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(title_font)

        sub_font = self._create_font(hdc, 11)
        old_font = gdi32.SelectObject(hdc, sub_font)
        gdi32.SetTextColor(hdc, GRAY)
        sub_rc = RECT()
        sub_rc.left = pad + 24
        sub_rc.top = pad + 52
        sub_rc.right = w - pad - 24
        sub_rc.bottom = sub_rc.top + 20
        user32.DrawTextW(hdc, self._subtitle, -1, ctypes.byref(sub_rc),
                         DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)

        # 阶段消息：允许多行折行，显示更多日志内容
        msg_rc = RECT()
        msg_rc.left = pad + 24
        msg_rc.top = pad + 108
        msg_rc.right = w - pad - 24
        msg_rc.bottom = msg_rc.top + 44
        gdi32.SetTextColor(hdc, GRAY_DIM)
        user32.DrawTextW(hdc, self._msg, -1, ctypes.byref(msg_rc),
                         DT_LEFT | DT_TOP | DT_WORDBREAK | DT_NOPREFIX)

        # 已用时间（右下角）
        elapsed = time.time() - self._start_time
        elapsed_text = f"已用 {int(elapsed // 60):02d}:{int(elapsed % 60):02d}"
        time_rc = RECT()
        time_rc.left = w - pad - 90
        time_rc.top = h - pad - 26
        time_rc.right = w - pad - 14
        time_rc.bottom = time_rc.top + 16
        gdi32.SetTextColor(hdc, GRAY_DIM)
        user32.DrawTextW(hdc, elapsed_text, -1, ctypes.byref(time_rc),
                         DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(sub_font)

        # 关闭按钮（右上角 X）
        btn_size = 26
        btn_pad = 16
        self._close_btn_rect = (w - btn_pad - btn_size, btn_pad,
                                w - btn_pad, btn_pad + btn_size)
        lx, ty, rx, by = self._close_btn_rect
        # 绘制半透明白色 hover 区域（简化为固定淡色）
        close_brush = gdi32.CreateSolidBrush(0x2A2024)  # 稍亮的面板色
        old_b = gdi32.SelectObject(hdc, close_brush)
        gdi32.RoundRect(hdc, lx, ty, rx, by, 6, 6)
        gdi32.SelectObject(hdc, old_b)
        gdi32.DeleteObject(close_brush)
        close_pen = gdi32.CreatePen(0, 2, GRAY)
        old_p = gdi32.SelectObject(hdc, close_pen)
        margin = 8
        gdi32.MoveToEx(hdc, lx + margin, ty + margin, None)
        gdi32.LineTo(hdc, rx - margin, by - margin)
        gdi32.MoveToEx(hdc, rx - margin, ty + margin, None)
        gdi32.LineTo(hdc, lx + margin, by - margin)
        gdi32.SelectObject(hdc, old_p)
        gdi32.DeleteObject(close_pen)

        # 进度条
        if self._status in ("ok", "timeout"):
            bar_y = pad + 90
            bar_h = 6
            bar_x = pad + 24
            bar_w = w - 2 * pad - 48

            track_brush = gdi32.CreateSolidBrush(0x1C1012)
            track_pen = gdi32.CreatePen(0, 1, 0x1C1012)
            old_b = gdi32.SelectObject(hdc, track_brush)
            old_p = gdi32.SelectObject(hdc, track_pen)
            gdi32.RoundRect(hdc, bar_x, bar_y, bar_x + bar_w, bar_y + bar_h, bar_h, bar_h)
            gdi32.SelectObject(hdc, old_b)
            gdi32.SelectObject(hdc, old_p)
            gdi32.DeleteObject(track_brush)
            gdi32.DeleteObject(track_pen)

            # phase 进度底（浅紫填充已走部分）
            fill_w = int(bar_w * min(self._progress, 1.0))
            if fill_w > 0:
                fill_brush = gdi32.CreateSolidBrush(0x3E2A4A)  # 半透明紫
                old_b = gdi32.SelectObject(hdc, fill_brush)
                gdi32.RoundRect(hdc, bar_x, bar_y, bar_x + fill_w, bar_y + bar_h, bar_h, bar_h)
                gdi32.SelectObject(hdc, old_b)
                gdi32.DeleteObject(fill_brush)

            if self._status == "ok":
                # 流动高亮块
                seg_w = max(40, int(bar_w * 0.25))
                pos = int(self._marquee * (bar_w + seg_w)) - seg_w
                x1 = max(bar_x, bar_x + pos)
                x2 = min(bar_x + bar_w, bar_x + pos + seg_w)
                if x2 > x1:
                    grad_brush = gdi32.CreateSolidBrush(VIOLET)
                    old_b = gdi32.SelectObject(hdc, grad_brush)
                    gdi32.RoundRect(hdc, x1, bar_y, x2, bar_y + bar_h, bar_h, bar_h)
                    gdi32.SelectObject(hdc, old_b)
                    gdi32.DeleteObject(grad_brush)

    def _center_on_cursor_monitor(self) -> tuple[int, int]:
        """在鼠标所在显示器居中；获取失败则回退到主屏居中。"""
        try:
            pt = POINT()
            if user32.GetCursorPos(ctypes.byref(pt)):
                mi = MONITORINFO()
                mi.cbSize = ctypes.sizeof(MONITORINFO)
                hmon = user32.MonitorFromPoint(
                    (ctypes.c_long * 2)(pt.x, pt.y),
                    2,  # MONITOR_DEFAULTTONEAREST
                )
                if hmon and user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
                    mw = mi.rcMonitor.right - mi.rcMonitor.left
                    mh = mi.rcMonitor.bottom - mi.rcMonitor.top
                    return (
                        mi.rcMonitor.left + (mw - SPLASH_W) // 2,
                        mi.rcMonitor.top + (mh - SPLASH_H) // 2,
                    )
        except Exception as exc:
            log(f"_center_on_cursor_monitor error: {exc}")

        try:
            screen = user32.GetDC(0)
            screen_w = gdi32.GetDeviceCaps(screen, 118)  # HORZRES
            screen_h = gdi32.GetDeviceCaps(screen, 117)  # VERTRES
            user32.ReleaseDC(0, screen)
            return (screen_w - SPLASH_W) // 2, (screen_h - SPLASH_H) // 2
        except Exception as exc:
            log(f"fallback center error: {exc}")
            return 100, 100

    def show(self) -> bool:
        if not self._register_class():
            return False

        hinstance = kernel32.GetModuleHandleW(None)
        x, y = self._center_on_cursor_monitor()

        self.hwnd = user32.CreateWindowExW(
            WS_EX_TOOLWINDOW,
            self._class_name,
            "ComfyAPP Bootstrap",
            WS_POPUP | WS_VISIBLE,
            x, y, SPLASH_W, SPLASH_H,
            0, 0, hinstance, None,
        )
        if not self.hwnd:
            log("CreateWindowExW failed")
            return False

        user32.SetWindowPos(
            self.hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        user32.SetTimer(self.hwnd, self._timer_id, 40, None)
        return True

    def set_error(self, msg: str):
        self._status = "error"
        self._title = APP_TITLE
        self._subtitle = "启动失败"
        self._msg = msg
        user32.InvalidateRect(self.hwnd, None, False)

    def set_timeout(self):
        self._status = "timeout"
        self._subtitle = "启动时间较长"
        self._msg = "窗口尚未出现，但启动进程仍在运行，请稍候…"
        user32.InvalidateRect(self.hwnd, None, False)

    def close_later(self, delay_ms: int, *, terminate: bool = False):
        if self._closed:
            return
        self._closed = True
        self._close_should_terminate = terminate
        user32.KillTimer(self.hwnd, self._timer_id)
        # 必须从 GUI 线程调用 PostQuitMessage 才有效；Timer 线程不能直接发 WM_QUIT。
        # 改发 WM_CLOSE 到窗口，WndProc 在主线程里收到后再 PostQuitMessage。
        def _post_close():
            try:
                user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
            except Exception as exc:
                log(f"post close error: {exc}")
        threading.Timer(delay_ms / 1000.0, _post_close).start()

    def _terminate_proc(self):
        """用户主动关闭/超时时，终止 dev-launcher 进程树，避免后台残留。"""
        self._stop_tailer.set()
        try:
            proc = self._proc
            if proc is not None and proc.poll() is None:
                log(f"terminating dev-launcher pid={proc.pid}")
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    log("dev-launcher did not terminate in 5s, killing")
                    proc.kill()
                    proc.wait(timeout=5)
        except Exception as exc:
            log(f"terminate proc error: {exc}")

    def destroy(self):
        """清理窗口类与 GDI 资源。"""
        self._stop_tailer.set()
        try:
            if self.hwnd:
                user32.KillTimer(self.hwnd, self._timer_id)
                user32.DestroyWindow(self.hwnd)
                self.hwnd = 0
            if self._wc_atom:
                hinst = kernel32.GetModuleHandleW(None)
                user32.UnregisterClassW(self._class_name, hinst)
                self._wc_atom = 0
        except Exception as exc:
            log(f"destroy error: {exc}")

    def run_message_loop(self):
        msg = MSG()
        while True:
            ret = user32.GetMessageW(ctypes.byref(msg), 0, 0, 0)
            if ret == 0 or ret == -1:
                break
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))


# ═══════════════════════════════════════════════════════════════════════════════
#  comfy-cli 虚拟环境准备（后台触发，不阻塞启动）
# ═══════════════════════════════════════════════════════════════════════════════
def _comfy_cli_venv_python(project_root: str) -> str:
    """executor-cli.ts 固定使用的 comfy-cli 虚拟环境解释器路径。"""
    venv_dir = os.path.join(project_root, "python-venv", "comfy-cli")
    if os.name == "nt":
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def ensure_comfy_cli_venv(project_root: str) -> None:
    """启动时检测 comfy-cli 虚拟环境；缺失则后台触发安装。

    raw UI-format（liblib 子图）工作流由 executor-cli.ts 交给项目内的
    comfy-cli venv 做 UI→API 转换；venv 缺失时提交任务会直接 spawn ENOENT，
    用户无从下手。这里在启动时兜底：
      - 已存在 → 仅记一行日志，零额外开销；
      - 缺失   → 以独立进程后台执行 setup-comfy-cli-venv.ps1。
    安装可能耗时数分钟，不能阻塞启动；独立进程组保证 launcher 在 Tauri 窗口
    出现后退出时安装不会被中断。
    """
    venv_py = _comfy_cli_venv_python(project_root)
    if os.path.isfile(venv_py):
        log(f"comfy-cli venv present: {venv_py}")
        return

    setup_ps1 = os.path.join(project_root, "scripts", "setup-comfy-cli-venv.ps1")
    if not os.path.isfile(setup_ps1):
        log(f"comfy-cli venv missing but setup script not found: {setup_ps1}")
        return

    shell = shutil.which("pwsh") or shutil.which("powershell")
    if not shell:
        log("comfy-cli venv missing but no powershell found, skipping bootstrap")
        return

    log(f"comfy-cli venv missing ({venv_py}), bootstrapping via {setup_ps1}")
    try:
        subprocess.Popen(
            [shell, "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-WindowStyle", "Hidden", "-File", setup_ps1],
            cwd=project_root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            start_new_session=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception as exc:
        log(f"comfy-cli bootstrap launch failed: {exc}")


# ═══════════════════════════════════════════════════════════════════════════════
#  启动 dev-launcher.ps1
# ═══════════════════════════════════════════════════════════════════════════════
def launch_dev_server(project_root: str, mode: str = "prebuilt") -> "subprocess.Popen[str] | None":
    ps1 = os.path.join(project_root, "scripts", "dev-launcher.ps1")
    if not os.path.isfile(ps1):
        log(f"dev-launcher.ps1 not found: {ps1}")
        return None

    pwsh = shutil.which("pwsh") or shutil.which("pwsh.exe")
    shell_name = "PowerShell 7"
    if not pwsh:
        pwsh = shutil.which("powershell") or shutil.which("powershell.exe")
        shell_name = "Windows PowerShell"
    if not pwsh:
        log("neither pwsh nor powershell found in PATH")
        return None

    log(f"using shell: {shell_name} ({pwsh})")

    if mode == "tauri":
        ps_args = ["-Tauri"]
        log(f"launching {ps1} -Tauri")
    else:
        ps_args = ["-Prebuilt"]
        log(f"launching {ps1} -Prebuilt")

    # 启动 PowerShell 隐藏窗口；stdin 也关闭避免句柄泄漏
    # stdout/stderr 重定向到文件，方便排查「提前退出但无日志」的问题。
    try:
        out_path = os.path.join(project_root, "log", "dev-launcher-stdout.log")
        err_path = os.path.join(project_root, "log", "dev-launcher-stderr.log")
        for p in (out_path, err_path):
            try:
                with open(p, "w", encoding="utf-8") as f:
                    f.write("")
            except OSError:
                pass
        out = open(out_path, "a", encoding="utf-8", buffering=1)
        err = open(err_path, "a", encoding="utf-8", buffering=1)
        return subprocess.Popen(
            [pwsh, "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
             "-File", ps1] + ps_args,
            cwd=project_root,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=err,
            # close_fds=True: 子进程不继承本进程（含 PyInstaller 运行时）的可继承
            # 句柄，避免它占用 PyInstaller 单文件临时目录导致退出时清理失败。
            # 对 onedir 模式同样有益：子进程不会误持 launcher 目录下的文件句柄。
            close_fds=True,
            # 独立进程组：Ctrl+C / 关闭启动器不会误伤 dev server 与 Tauri 子进程；
            # 它们的清理完全由 dev-launcher.ps1 的 Job Object 负责。
            start_new_session=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception as exc:
        log(f"subprocess.Popen failed: {exc}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  后台监控线程
# ═══════════════════════════════════════════════════════════════════════════════
def monitor(proc: "subprocess.Popen[str] | None", splash: SplashWindow):
    deadline = time.time() + 240
    try:
        while time.time() < deadline:
            if splash._closed:
                log("splash already closed, monitor exiting")
                return
            if find_tauri_window():
                log("tauri window detected, closing splash in 600ms")
                splash.close_later(600, terminate=False)
                return
            if proc is not None and proc.poll() is not None:
                exit_code = proc.returncode
                log(f"dev-launcher process exited early with code {exit_code}")
                splash.set_error("启动进程已退出，请检查 log/dev-launcher.log")
                splash.close_later(5000, terminate=False)
                return
            time.sleep(0.5)
        log("monitor deadline reached (240s)")
        splash.set_timeout()
        splash.close_later(4000, terminate=False)
    except Exception as exc:
        log(f"monitor thread error: {exc}")
        splash.set_error(f"监控线程异常：{exc}")
        splash.close_later(5000, terminate=False)


def _monitor_headless(
    project_root: str,
    proc: "subprocess.Popen[str] | None",
    timeout: float = 240.0,
) -> None:
    """无启动画面模式：后台 tail dev-launcher.log 并写 run/launch-status.json，

    直到 Tauri 主窗口出现、dev-launcher 异常退出或超时。
    """
    start_time = time.time()
    deadline = start_time + timeout
    log_path = _resolve_dev_log_path(project_root)
    last_size = 0
    current_phase = "initial"
    current_message = LAUNCH_PHASES["initial"]["message"]

    log_to_phase = {
        "检查端口占用": "port-check",
        "端口已就绪": "port-ready",
        "配置指纹": "cache",
        "清空 .next": "cache",
        "创建 Windows Job Object": "job-object",
        "开发服务器进程已启动": "dev-server-starting",
        "Next.js dev server 已启动": "dev-server-starting",
        "预编译 Tauri 壳已启动": "tauri-shell-started",
        "Tauri 桌面壳已启动": "tauri-shell-started",
        "正在启动本地服务": "dev-server-starting",
        "等待本地服务就绪": "dev-server-starting",
        "等待 tauri dev 编译": "tauri-compiling",
        "服务器已就绪": "dev-server-ready",
    }

    def elapsed() -> float:
        return time.time() - start_time

    def update_from_log(text: str) -> bool:
        nonlocal current_phase, current_message
        changed = False
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            return False
        for latest in lines:
            msg = latest
            if "[" in latest and "]" in latest:
                parts = latest.split("]")
                if len(parts) >= 2:
                    msg = "]".join(parts[1:]).strip()
                    msg = msg.lstrip("[]STEP OK WARN ERROR INFO ").strip()
            for key, phase in log_to_phase.items():
                if key in latest:
                    if current_phase != phase:
                        current_phase = phase
                        current_message = msg
                        changed = True
                    break
            if "ERROR" in latest or "错误" in latest:
                current_message = f"⚠ {msg[:80]}"
                changed = True
        return changed

    _write_status(project_root, current_phase, message=current_message, elapsed=elapsed())

    try:
        last_write = 0.0
        while time.time() < deadline:
            try:
                # 如果 dev-launcher.ps1 切换了当前日志文件，跟随 sentinel
                resolved = _resolve_dev_log_path(project_root)
                if resolved != log_path:
                    log_path = resolved
                    last_size = 0
                if os.path.isfile(log_path):
                    size = os.path.getsize(log_path)
                    if size < last_size:
                        last_size = 0
                    if size > last_size:
                        with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                            f.seek(last_size)
                            text = f.read()
                        last_size = size
                        if update_from_log(text):
                            _write_status(
                                project_root,
                                current_phase,
                                message=current_message,
                                elapsed=elapsed(),
                            )
                            last_write = time.time()
            except Exception as exc:
                log(f"headless tail error: {exc}")

            # 至少每秒刷新一次状态文件，让启动页感知存活
            if time.time() - last_write >= 1.0:
                _write_status(
                    project_root,
                    current_phase,
                    message=current_message,
                    elapsed=elapsed(),
                )
                last_write = time.time()

            # Tauri 主窗口已出现 -> 启动完成，launcher 可以退出
            if find_tauri_window():
                _write_status(
                    project_root,
                    "ready",
                    message="启动完成",
                    ready=True,
                    elapsed=elapsed(),
                )
                log("tauri window detected, launcher exiting")
                if proc is not None and proc.poll() is None:
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        pass
                return

            # dev-launcher 提前退出（异常）
            if proc is not None and proc.poll() is not None:
                exit_code = proc.returncode
                log(f"dev-launcher process exited early with code {exit_code}")
                _write_status(
                    project_root,
                    "error",
                    message="启动进程已退出，请检查 log/dev-launcher.log",
                    error=True,
                    elapsed=elapsed(),
                )
                return

            time.sleep(0.5)

        log("headless monitor deadline reached (240s)")
        if find_tauri_window():
            _write_status(
                project_root,
                "ready",
                message="启动完成",
                ready=True,
                elapsed=elapsed(),
            )
        else:
            _write_status(
                project_root,
                "timeout",
                message="启动时间较长，但仍在进行中，请稍候…",
                elapsed=elapsed(),
            )
    except Exception as exc:
        log(f"headless monitor error: {exc}")
        _write_status(
            project_root,
            "error",
            message=f"监控线程异常：{exc}",
            error=True,
            elapsed=elapsed(),
        )


# ═══════════════════════════════════════════════════════════════════════════════
#  顶层错误处理与启动入口
# ═══════════════════════════════════════════════════════════════════════════════
def _fatal_box(message: str, title: str = f"{APP_TITLE} 启动器") -> int:
    log(f"FATAL: {message}")
    try:
        user32.MessageBoxW(0, message, title, MB_ICONERROR | MB_OK)
    except Exception:
        pass
    return 1


def _parse_args(argv: list[str]) -> dict[str, bool | str]:
    # 默认使用预编译 Tauri 壳（窗口秒出）；--tauri-dev 走旧版 tauri dev（慢，但支持 Rust 热重载）。
    args: dict[str, bool | str] = {"splash": False, "focus": True, "tauri_dev": False, "standalone": False}
    for arg in argv[1:]:
        a = arg.lower().lstrip("-/")
        if a in ("splash",):
            args["splash"] = True
        elif a in ("no-splash", "nosplash"):
            args["splash"] = False
        elif a in ("tauri-dev", "tauridev", "dev-build"):
            args["tauri_dev"] = True
        elif a in ("standalone", "portable", "no-dev"):
            args["standalone"] = True
        elif a in ("no-focus", "nofocus"):
            args["focus"] = False
        elif a in ("help", "h", "?"):
            args["help"] = True
    return args


def _default_mode_from_exe() -> str:
    """按 exe 文件名决定默认启动模式，使一个源码可打包出三个入口：

    - ``start-tauri.exe``            -> prebuilt  （默认，秒出窗口 + dev server）
    - ``start-tauri-dev.exe``        -> tauri     （Rust 热重载）
    - ``start-tauri-standalone.exe`` -> standalone（独立运行，不连 dev server）

    显式参数（--tauri-dev / --standalone）优先级最高，可覆盖文件名默认值。
    """
    base = os.path.splitext(os.path.basename(sys.executable))[0].lower()
    if base.endswith("-dev"):
        return "tauri"
    if base.endswith("-standalone"):
        return "standalone"
    return "prebuilt"


def _resolve_mode(args: dict) -> str:
    if args.get("standalone"):
        return "standalone"
    if args.get("splash") or args.get("tauri_dev"):
        return "tauri"
    return _default_mode_from_exe()


def _run_standalone(project_root: str, mutex, args) -> int:
    """独立模式：直接运行已构建的 standalone Tauri 壳（app.exe），不连 dev server。

    前置：``tools\\build-standalone.bat``（``pnpm tauri build``）已把 standalone 资源
    （server.js + .next/static + Node sidecar）组装到 app.exe 同级/资源目录。
    资源缺失时明确报错，避免静默黑屏或 Rust 侧 panic。
    """
    set_dpi_aware()
    app_exe = os.path.join(project_root, "src-tauri", "target", "release", "app.exe")
    res_dir = os.path.dirname(app_exe)
    server_js = os.path.join(res_dir, "server.js")
    node_exe = os.path.join(res_dir, "binaries", "node.exe")

    def _cleanup_and_exit(code: int, message: str = "") -> int:
        _safe_remove(_launcher_lock_file(project_root))
        if mutex:
            kernel32.ReleaseMutex(mutex)
            kernel32.CloseHandle(mutex)
        close_logging()
        if message:
            return _fatal_box(message)
        return code

    if not os.path.isfile(app_exe):
        log("standalone mode: app.exe not found")
        return _cleanup_and_exit(
            1,
            f"找不到 standalone 壳：{app_exe}\n\n"
            "请先运行 tools\\build-standalone.bat（pnpm tauri build）构建独立版本。",
        )
    if not os.path.isfile(server_js) or not os.path.isfile(node_exe):
        log("standalone mode: standalone resources missing")
        return _cleanup_and_exit(
            1,
            "standalone 资源缺失（server.js / Node sidecar）。\n\n"
            "请先运行 tools\\build-standalone.bat（pnpm tauri build）完成完整生产构建，\n"
            "请勿用纯 cargo build --release（其 app.exe 不内嵌 standalone 资源）。",
        )

    log(f"standalone mode: launching {app_exe}")
    try:
        proc = subprocess.Popen(
            [app_exe],
            cwd=project_root,
            env={**os.environ, "COMFYAPP_PROJECT_ROOT": project_root},
            close_fds=True,
            start_new_session=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception as exc:
        log(f"standalone mode: failed to launch app.exe: {exc}")
        return _cleanup_and_exit(1, f"无法启动 standalone 壳：{exc}")

    deadline = time.time() + 120
    while time.time() < deadline:
        if find_tauri_window():
            log("standalone mode: tauri window detected, launcher exiting")
            break
        if proc.poll() is not None:
            log("standalone mode: app.exe exited early")
            _fatal_box("standalone 壳启动后异常退出，请查看 log/ 下日志。")
            break
        time.sleep(0.5)
    return _cleanup_and_exit(0)


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv

    args = _parse_args(argv)
    if args.get("help"):
        user32.MessageBoxW(
            0,
            "用法：start-tauri.exe [选项]\n\n"
            "  默认          使用预编译 Tauri 壳（窗口秒出，连 dev server）\n"
            "  --tauri-dev   走 Tauri dev（慢，但支持 Rust 热重载）\n"
            "  --standalone  走独立模式（需先 pnpm tauri build，不连 dev server）\n"
            "  --splash      启用旧版 Win32 启动小弹窗（调试用）\n"
            "  --no-focus    发现已有窗口时不置顶\n"
            "  --help        显示此帮助",
            f"{APP_TITLE} 启动器",
            MB_OK,
        )
        return 0

    set_dpi_aware()

    project_root = get_project_root()
    init_logging(project_root)
    log(f"project_root={project_root}")

    # 启动模式（prebuilt / tauri / standalone）由参数或 exe 文件名决定。
    mode = _resolve_mode(args)
    if mode != "standalone":
        ps1_path = os.path.join(project_root, "scripts", "dev-launcher.ps1")
        if not os.path.isfile(ps1_path):
            return _fatal_box(
                f"找不到启动脚本：{ps1_path}\n请把 start-tauri.exe 放在项目根目录。"
            )
    else:
        ps1_path = None

    # 单实例保护 + 陈旧锁自愈
    lock_file = _launcher_lock_file(project_root)
    _stale_pid = _read_lock_pid(lock_file)
    if _stale_pid is not None and not _is_pid_alive(_stale_pid):
        log(f"stale lock file (pid {_stale_pid} dead), removing")
        _safe_remove(lock_file)

    mutex = create_mutex("Local\\ComfyAppTauriLauncherMutex")
    if is_another_instance_running(mutex):
        # 互斥量被占用：若真有 Tauri 窗口在跑，置顶已有窗口后退出（正常单实例行为）
        if find_and_focus_tauri_window():
            log("another instance is already running (tauri window found), focusing it")
            if mutex:
                kernel32.CloseHandle(mutex)
            close_logging()
            return 0
        # 互斥量被占用但没有任何 Tauri 窗口 -> 判定为陈旧锁
        # （典型场景：上次崩溃 / 调试遗留的 launcher 进程仍攥着互斥量）。
        # 直接覆盖启动，避免被陈旧锁永久阻塞。
        log("another instance detected but NO tauri window -> overriding stale lock")
        if mutex:
            kernel32.CloseHandle(mutex)
        mutex = None

    _write_lock_pid(lock_file)

    # 如果 Tauri 窗口已经存在，直接聚焦（不重复启动）
    if args.get("focus", True) and find_and_focus_tauri_window():
        if mutex:
            kernel32.ReleaseMutex(mutex)
            kernel32.CloseHandle(mutex)
        _safe_remove(lock_file)
        close_logging()
        return 0

    # 把项目根目录与目标 URL 传给 Tauri 侧，让 Rust 能找到 launch-status.json 并正确导航。
    # 2026-08-29：用 127.0.0.1 替代 localhost，避免部分 Windows 把 localhost 优先
    # 解析到 ::1（IPv6）而 Next.js dev server 监听在 IPv4，导致 ERR_CONNECTION_REFUSED。
    os.environ["COMFYAPP_PROJECT_ROOT"] = project_root
    os.environ["COMFYAPP_DEV_URL"] = "http://127.0.0.1:3000/workspace"

    # 检测 comfy-cli 虚拟环境；缺失则后台触发安装（不阻塞启动）
    ensure_comfy_cli_venv(project_root)

    # 启动模式已由 _resolve_mode 根据参数 / exe 文件名决定（见上方 mode 赋值）。
    if mode == "standalone":
        return _run_standalone(project_root, mutex, args)

    if not args.get("splash", True):
        # 默认模式：不显示 Python 小弹窗，启动过程由 Tauri 主窗口内嵌页展示。
        # launcher 负责 tail dev-launcher.log 并把进度写入 run/launch-status.json。
        proc = launch_dev_server(project_root, mode=mode)
        if proc is None:
            if mutex:
                kernel32.CloseHandle(mutex)
            _cleanup_status(project_root)
            close_logging()
            return _fatal_box("无法启动 dev-launcher.ps1，请检查 PowerShell 是否可用。")
        _write_status(project_root, "initial")
        try:
            _monitor_headless(project_root, proc)
        finally:
            if mutex:
                kernel32.ReleaseMutex(mutex)
                kernel32.CloseHandle(mutex)
            _safe_remove(lock_file)
            # 保留状态文件 30 秒，让启动页能读到最终 ready；随后清理。
            threading.Timer(30.0, lambda: _cleanup_status(project_root)).start()
            close_logging()
        return 0

    splash = SplashWindow()
    if not splash.show():
        if mutex:
            kernel32.CloseHandle(mutex)
        close_logging()
        return _fatal_box("无法创建启动画面窗口。")

    proc = launch_dev_server(project_root, mode=mode)
    if proc is None:
        splash.set_error("无法找到 PowerShell / pwsh，请安装后重试")
        splash.close_later(5000)
    else:
        log(f"dev-launcher pid={proc.pid}")
        splash._proc = proc
        splash._start_log_tailer(project_root)
        t = threading.Thread(target=monitor, args=(proc, splash), daemon=True)
        t.start()

    try:
        splash.run_message_loop()
    finally:
        splash.destroy()
        if mutex:
            kernel32.ReleaseMutex(mutex)
            kernel32.CloseHandle(mutex)
        _safe_remove(lock_file)
        _cleanup_status(project_root)
        close_logging()

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        # 顶层兜底：记录日志并弹出友好错误框，而不是 Python 默认的 traceback 弹窗
        try:
            log(f"UNHANDLED EXCEPTION: {exc}\n{traceback.format_exc()}")
        except Exception:
            pass
        try:
            user32.MessageBoxW(
                0,
                f"启动器遇到未预期错误：\n{exc}\n\n"
                f"详细日志请查看 log/start-tauri-launcher.log",
                f"{APP_TITLE} 启动器",
                MB_ICONERROR | MB_OK,
            )
        except Exception:
            pass
        sys.exit(1)
