#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
start_tauri_launcher.py — Comfy-APP 桌面壳启动器（纯 Win32 启动画面）

取代了原来的 start-tauri.vbs（2026-09-04 起该 dev 入口改为 tools/start/start-tauri-dev.ps1）：
点击后立刻弹出一个暗色启动画面，
明确告知「正在启动」，避免「点了像没反应」的困惑。

职责（分层：本文件是**入口**，编排在 scripts/dev-launcher.mjs）：
  1. 弹出 Win32 自绘启动画面（暗色极光风格，与 app 一致）。
  2. 在隐藏窗口中调用 `node scripts/dev-launcher.mjs --mode ...` 启动编排。
  3. 轮询 Win32 窗口，直到 Tauri 主窗口（标题 "Comfy APP"）出现后关闭画面。
  4. 兜底：超过 240s 仍未检测到窗口则关闭画面（不杀启动进程）；
     若启动进程提前异常退出则画面提示失败。

**为什么是 node 而不是 PowerShell**：编排的唯一实现是跨平台的
`scripts/dev-launcher.mjs`（规范 §3），`scripts/dev-launcher.ps1` 只是它的
Windows 调用入口。启动器直接调 mjs 可以少一层宿主进程，也让「Linux/macOS 上
没有 pwsh 也能走同一条编排」这件事在架构上不成立都不行——不存在的分支不会漂移。

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
import re
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

# 端口推导算法抽到 scripts/app_port.py（纯逻辑、跨平台可导入），此处只做薄委托。
# 抽出的原因（ISSUE #489 缺陷 4）：本模块顶层直接取 ctypes.windll / WINFUNCTYPE，
# **只能在 Windows 上导入**，导致「四语言端口一致性」无法在 Linux / CI 上验证。
# 共享校验向量与 Node 侧测试见 scripts/check-app-port-vectors.py。
from app_port import (
    derive_app_port as _derive_app_port,
    fnv1a32 as _fnv1a32,
    normalize_root_for_port as _normalize_root_for_port,
    resolve_app_port as _read_app_port,
)

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
SW_MINIMIZE = 6
SW_RESTORE = 9
SW_HIDE = 0
SW_SHOW = 5
GW_HWNDNEXT = 2
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

# Win32 启动画面（--splash 调试用 / 壳弹出前的占位）的尺寸。
#
# 与 Tauri 启动页同一条取向（ISSUE #412）：**窗口即内容**，开成一条紧凑的窄条
# 居中显示，不铺满屏幕留出大片空白。窗口是 WS_POPUP 无边框的，最小化 / 关闭
# 由画面右上角自绘的两个按钮提供（原先只有一个 ✕，且位置与标题挤在一起）。
#
# 数值**逐字对齐** `src-tauri/tauri.conf.json` 的 splash 窗口尺寸与启动页
# `public/splash.html` 的紧凑档：同一张「启动中」画面在本链路有两个实现
# （壳内嵌启动页 / 启动器 Win32 弹窗），尺寸各写一份就会一次改一处、两边不一致。
# `tests/check-file-structure.test.ts` 有一条用例盯着这三处必须同值。
SPLASH_W = 744
SPLASH_H = 216

APP_TITLE = "Comfy APP"
APP_WINDOW_TITLE = "Comfy APP"

# 按检出隔离的窗口识别前缀（多检出并行，§1.4）：main() 在拿到项目根后立即写入
# 「本检出绝对路径 + 分隔符」（小写）。为空 = 未初始化（退回仅按进程名识别的
# 旧行为）；非空时只有 exe 路径落在前缀下的 app.exe 才算本检出的壳——否则
# 另一份检出的同名壳会被误认成自己的实例，后启动的检出把别人的窗口顶到前台。
_SHELL_OWN_PREFIX = ""

# ═══════════════════════════════════════════════════════════════════════════════
#  日志（辅助排查，写入项目根目录 log/launcher/start-tauri-launcher.log）
# ═══════════════════════════════════════════════════════════════════════════════
_log_file: object | None = None
_log_lock = threading.Lock()


def _ensure_log_dir(project_root: str) -> str:
    log_dir = os.path.join(project_root, "log", "launcher")
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
def _launcher_entry(project_root: str) -> str:
    """启动编排器的入口（跨平台唯一实现）。"""
    return os.path.join(project_root, "scripts", "dev-launcher.mjs")


def _is_project_root(path: str) -> bool:
    return os.path.isfile(_launcher_entry(path))


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


def _window_process_path(hwnd: HWND) -> str:
    """返回窗口所属进程的 exe 完整路径（小写），取不到返回空串。

    多检出并行时按路径区分「这份检出」与「别份检出」的壳：进程名都是
    app.exe，只有路径能说明归属。
    """
    try:
        pid = DWORD(0)
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return ""
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not h:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(260)
            size = DWORD(260)
            if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                return buf.value.lower()
        finally:
            kernel32.CloseHandle(h)
    except Exception:
        return ""
    return ""


def _window_process_name(hwnd: HWND) -> str:
    """返回窗口所属进程的 exe 文件名（小写），失败返回空串。

    用于窗口识别防误判：浏览器打开 localhost:3100 时标签页标题同样是
    "Comfy APP"，仅按标题子串匹配会把浏览器窗口误认成 Tauri 壳，
    导致双击启动器只聚焦浏览器就退出、应用根本没启动。
    """
    path = _window_process_path(hwnd)
    return os.path.basename(path) if path else ""


def _is_app_shell_window(hwnd: HWND, title: str, exact: bool = False) -> bool:
    """标题命中且窗口属于本项目 Tauri 壳（app.exe）才算应用窗口。

    exact=True 要求标题精确等于「Comfy APP」（主窗口）：启动页窗口标题带
    「启动中」后缀，从壳启动那一刻就可见——按子串匹配会把启动页误判为
    「应用已就绪」，launcher 提前退出并在 30s 后删除状态文件，启动页从此
    只能显示假进度（2026-09-02 假进度问题根因）。
    """
    title = title or ""
    if not title:
        return False
    matched = title.strip() == APP_WINDOW_TITLE if exact else APP_WINDOW_TITLE in title
    # exe 名按平台判据取：Windows 是 app.exe，Linux/macOS 是无后缀的 app。
    # 写死 "app.exe" 会让「同一条启动链在 POSIX 上永远找不到窗口」——而这条
    # 判据的失败形态很安静（只是找不到，不报错）。
    if not matched or _window_process_name(hwnd) != app_window_process_name():
        return False
    # 多检出并行：exe 路径必须落在本检出内（前缀未初始化时退回旧行为）
    if _SHELL_OWN_PREFIX and not _window_process_path(hwnd).startswith(_SHELL_OWN_PREFIX):
        return False
    return True


def find_tauri_window(exact: bool = False) -> bool:
    """枚举顶层窗口，查找可见的应用壳窗口。

    exact=True 只认主窗口（标题精确「Comfy APP」），用于就绪判定；
    默认子串匹配，启动页/主窗口都算。
    """
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
            if _is_app_shell_window(hwnd, buf.value, exact):
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
            if _is_app_shell_window(hwnd, buf.value):
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


def foreground_window_process() -> str:
    """当前系统前台窗口所属进程的 exe 文件名（小写），取不到返回空串。

    只用于「这次启动要不要给前台」的判断（见 decide_foreground）；供调试时单独
    调用查看，也是该判据在测试里的打桩点。
    """
    try:
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ""
        return _window_process_name(hwnd)
    except Exception:
        return ""


def _foreground_window_path() -> str:
    """当前前台窗口所属进程的 exe 完整路径（小写），取不到返回空串。"""
    try:
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return ""
        return _window_process_path(hwnd)
    except Exception:
        return ""


def decide_foreground(*, cold_start: bool = False, already_running: bool = False) -> bool:
    """决定这次启动是否允许应用窗口在加载完成后自动顶到前台。

    默认**不允许**：应用启动要几十秒，用户完全可能切去别的窗口干活，等页面加载
    完成再弹到最前面会把正在看的内容打断（用户先看到的就是这个）。这时只把窗口
    显示到任务栏 + 请求任务栏闪烁提醒，用户自己点开。命中下面任一条则允许给前台
    ——这些情形要么用户就在等这个应用，要么前台本来就是它，都不存在「打断」：

    - 已有实例在跑，这次只是把它唤到前面（用户点了启动就该看到界面，且此刻
      就唤起、不存在「几十秒后突然弹出」）；
    - 冷启动（脚本 / 终端敲命令拉起，不是「点了就去忙别的」的路径）；
    - 前台本来就是本应用（用户从应用里重启、更新后重启）。

    曾经把「前台是双击入口（explorer / 启动器自身）」也判为允许——但双击之后
    切去干别的正是常态：启动期此刻前台还是 explorer，几十秒后正式窗口冒出来时
    用户早就在别处工作了，于是出现「弹到最前打断两次」（第二次是交接复核按
    「用户就在等」强拉回前台）。双击启动因此一律不给前台，任务栏闪烁提醒即可。

    返回值经 `COMFYAPP_FOREGROUND` 环境变量传给 Tauri 壳，由
    `show_main_window_without_focus` 消费（见 launch-and-build.md §1.3）。
    """
    if already_running:
        log("foreground allowed: an instance is already running (user asked to raise it)")
        return True
    if cold_start:
        log("foreground allowed: cold start from a shell")
        return True
    foreground = foreground_window_process()
    # 「前台本来就是本应用」按**本检出**判定：另一份检出的壳在前台时给不给
    # 前台应走默认判决（用户在看的可能就是别份检出），不能因为进程同名就放行。
    foreground_own = (
        foreground.startswith("app")
        and (
            not _SHELL_OWN_PREFIX
            or _foreground_window_path().startswith(_SHELL_OWN_PREFIX)
        )
    )
    if foreground_own:
        log("foreground allowed: this app is already the foreground window")
        return True
    log("foreground denied: startup may finish while the user is elsewhere")
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
    """Windows 安全的进程探活。

    注意：绝不能用 os.kill(pid, 0)——Windows CPython 的实现是
    OpenProcess + TerminateProcess(handle, 0)，探活即击杀，会把锁文件里
    记录的存活启动器（或 PID 复用后的无关进程）直接终止。
    这里改用 OpenProcess(SYNCHRONIZE) + WaitForSingleObject(0) 非阻塞探测。
    """
    if not pid or pid <= 0:
        return False
    try:
        SYNCHRONIZE = 0x00100000
        WAIT_TIMEOUT = 0x00000102
        ERROR_ACCESS_DENIED = 5
        handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
        if not handle:
            # 打开失败：拒绝访问说明进程存在（受保护/其他用户）→ 存活；
            # 进程不存在时 OpenProcess 失败且非 access denied → 已退出。
            return kernel32.GetLastError() == ERROR_ACCESS_DENIED
        try:
            return kernel32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    except Exception:
        # 探测本身出错时保守返回 False（配合互斥体的窗口检测，不会误杀进程）
        return False


def _safe_remove(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _shell_pid_file(project_root: str) -> str:
    """记录本次启动器拉起的桌面壳 PID（由编排器 dev-launcher.mjs 写入）。

    编排器只在壳退出时回收它；而「启动器 / 监控线程先退出、壳还活着」
    这条路径没人善后——最典型的是用户直接关掉启动器窗口后，app.exe 变成无主的常驻
    进程：桌面窗口没了，进程还在，下次编译还会锁住 target\release\app.exe。

    **上一轮留下的 PID 文件必须先删掉**：这个文件是「上一次 run 的残留」，而
    编排器是被本次启动器另起的进程，等它走到写 PID 那一步之前，文件里
    还留着上一轮的旧 PID。旧 PID 很可能已被系统回收给别的无关进程（Windows 会复用
    PID），一旦兜底回收路径读到它就会去杀一个不相干的进程。先删 = 窗口期内读不到
    文件（_kill_shell_from_pid_file 直接返回），语义安全。
    """
    return os.path.join(project_root, "log", "launcher", "tauri-shell.pid")


def _reset_shell_pid_file(project_root: str) -> None:
    """清掉上一轮的桌面壳 PID 文件（在拉起编排器之前调用）。"""
    _safe_remove(_shell_pid_file(project_root))


def _kill_shell_from_pid_file(project_root: str) -> None:
    """回收本次启动器拉起的桌面壳（整棵进程树）。

    只在编排器已退出、壳仍在运行的兜底路径调用：此时编排器自己的回收路径没机会
    跑，必须由启动器补刀。PID 取不到 / 不是数字 / 进程已退出都直接返回，不做任何
    猜测性击杀。

    **回收动作本身也不在这里拼命令**：转交 `scripts/launcher-core/shell.mjs` 的
    平台实现（Windows `taskkill /PID /T /F`，POSIX 进程组信号）—— 启动器是
    Windows 专属入口，但「怎么杀整棵树」这条判据必须与编排侧同源，否则又是一处
    会静默分叉的平台分支。
    """
    path = _shell_pid_file(project_root)
    try:
        with open(path, "r", encoding="utf-8") as f:
            pid = int(f.read().strip())
    except Exception:
        return
    finally:
        _safe_remove(path)
    if not _is_pid_alive(pid):
        return
    log(f"shell process {pid} still alive after launcher exit, reaping process tree")
    try:
        node = _node_exe()
        reaper = os.path.join(project_root, "scripts", "reap-process.mjs")
        if node and os.path.isfile(reaper):
            subprocess.run(
                [node, reaper, str(pid)],
                cwd=project_root,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
    except Exception as exc:
        log(f"kill shell process failed: {exc}")


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
    "cancelled": {"progress": 1.0, "message": "已取消本次启动"},
}


def _status_file_path(project_root: str) -> str:
    return os.path.join(project_root, "run", STATUS_FILE)


def _resolve_dev_log_path(project_root: str) -> str:
    """编排器可能因 dev-launcher.log 被占用而回退到其它文件名，

    通过 sentinel 文件定位本次运行的真实日志路径。
    """
    default = os.path.join(project_root, "log", "launcher", "dev-launcher.log")
    sentinel = os.path.join(project_root, "log", "launcher", "dev-launcher-current.txt")
    try:
        with open(sentinel, "r", encoding="utf-8") as f:
            path = f.read().strip()
        if path and os.path.isfile(path):
            return path
    except Exception:
        pass
    return default


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _read_log_tail(path: str, lines: int = 25) -> str:
    """读取日志最后 N 行（去 ANSI 颜色码），失败返回空串。"""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = _strip_ansi(f.read())
        return "\n".join(content.splitlines()[-lines:]).strip()
    except Exception:
        return ""


def is_launch_cancelled(stderr_tail: str) -> bool:
    """本次启动是否由用户主动放弃（关掉了启动页）。

    壳在「启动页收到关闭请求、而主窗还没显示」时会落一行
    ``... exiting app (launch abandoned)``（见 src-tauri/src/lib.rs 的
    splash CloseRequested 分支），启动器把壳的 stderr 重定向到
    dev-launcher-stderr.log 且**每次启动前清空**——读到即属本次。

    判据取日志标记而不是退出码：这条路径上壳是 exit(0)，与「正常收尾」无从区分；
    而用户此刻跑的可能是上一轮编出来的旧壳，新加退出码在旧壳里并不存在，
    但这一行旧壳同样会写。
    """
    return "launch abandoned" in (stderr_tail or "").lower()


def _launch_cancelled(project_root: str) -> bool:
    """读本次启动的壳 stderr 尾巴，判断是否「用户关闭启动页放弃本次启动」。"""
    tail = _read_log_tail(
        os.path.join(project_root, "log", "launcher", "dev-launcher-stderr.log"), 200
    )
    return is_launch_cancelled(tail)


def _newest_nextjs_log(project_root: str, prefix: str) -> str:
    """`log/nextjs/` 下**最新**的某类按次命名日志（按 mtime，不按文件名）。

    为什么不按文件名排序：这里的历史命名混过两套格式（`…T<time>.log` 与
    `…_<time>.log`），字典序会把旧命名排到 `T` 之后 —— 「最新」于是恒定指向
    上一次运行的文件，用户照着弹窗里的路径去看，看到的是别的现场（ISSUE #576）。
    文件时间戳才是「哪一份更新」的事实。
    """
    directory = os.path.join(project_root, "log", "nextjs")
    try:
        candidates = [
            os.path.join(directory, name)
            for name in os.listdir(directory)
            if name.startswith(prefix)
        ]
    except OSError:
        return ""
    if not candidates:
        return ""
    return max(candidates, key=lambda p: os.path.getmtime(p))


def _build_failure_message(project_root: str, detail: str) -> str:
    """组装启动失败的 MessageBox 文案：结论 + 日志尾部 + 日志位置。

    历史教训：dev-launcher 提前退出时若只把错误写进 30 秒后自删的状态文件，
    对用户完全静默（表现为「双击没反应」）。失败必须有人类可见的出口。

    「详细」的标准是**用户不需要再去翻别处**：启动失败最关键的现场是 dev server
    自己的输出（Next 编译错、端口被占、pnpm 起不来都落在那里），而它此前完全不在
    弹窗里 —— 用户照着「详细日志」那两行去翻，翻到的还是启动器日志（ISSUE #576：
    「启动失败，还是看不出哪有问题，日志需要详细」）。现在把 nextjs 的 stderr 尾部
    一并贴上来，并列出它的绝对路径。
    """
    dev_log = _resolve_dev_log_path(project_root)
    tail_dev = _read_log_tail(dev_log, 20)
    tail_err = _read_log_tail(os.path.join(project_root, "log", "launcher", "dev-launcher-stderr.log"), 15)
    parts = [f"应用启动失败：{detail}"]
    if tail_err:
        parts.append("— 启动器错误输出（dev-launcher-stderr.log）—\n" + tail_err)
    if tail_dev:
        parts.append("— 启动器日志尾部（dev-launcher.log）—\n" + tail_dev)
    # dev server 自身的输出：失败最常见的落点，必须直接给出来（否则用户只能看到
    # 「dev server 退出了」这句结论，仍不知道为什么）。
    next_err = _newest_nextjs_log(project_root, "nextjs-stderr-")
    next_out = _newest_nextjs_log(project_root, "nextjs-stdout-")
    tail_next_err = _read_log_tail(next_err, 25) if next_err else ""
    tail_next_out = _read_log_tail(next_out, 15) if next_out else ""
    if tail_next_err:
        parts.append("— dev server 错误输出（nextjs-stderr.log）—\n" + tail_next_err)
    elif tail_next_out:
        parts.append("— dev server 输出尾部（nextjs-stdout.log）—\n" + tail_next_out)
    logs = [dev_log, os.path.join(project_root, "log", "launcher", "dev-launcher-stderr.log")]
    for path in (next_err, next_out):
        if path:
            logs.append(path)
    parts.append("详细日志：\n" + "\n".join(f"  {p}" for p in logs))
    parts.append(
        "下一步：先看上面 dev server 的错误输出；确认工具链可用的自查入口是\n"
        "  pnpm check:toolchain（打印选中的 pnpm 与探测结果）"
    )
    return "\n\n".join(parts)


def _write_status(
    project_root: str,
    phase: str,
    message: str = "",
    *,
    ready: bool = False,
    error: bool = False,
    elapsed: float = 0.0,
    app_url: str | None = None,
) -> None:
    """把当前启动状态写入 <project_root>/run/launch-status.json。

    Tauri 内嵌启动页通过调用 Rust command 读取该文件并展示进度。
    """
    if app_url is None:
        app_url = "http://127.0.0.1:%d/workspace" % _read_app_port(project_root)
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

user32.GetForegroundWindow.argtypes = []
user32.GetForegroundWindow.restype = HWND

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

user32.GetWindow.argtypes = [HWND, UINT]
user32.GetWindow.restype = HWND

user32.IsWindow.argtypes = [HWND]
user32.IsWindow.restype = BOOL

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
        self._min_btn_rect = (0, 0, 0, 0)  # left, top, right, bottom
        self._hover_btn = ""  # "" | "min" | "close"，仅用于按钮悬停高亮
        self._close_should_terminate = False
        # 最小化状态：置顶弹窗不能被 ShowWindow(SW_MINIMIZE) 最小化（见 _minimize），
        # 这里用「隐藏 + 撤置顶 + 把前台还回去」实现，需要定时器周期维持。
        self._minimized = False
        self._below_hwnd = 0
        self._below_checked = False
        # 启动前提示（如「壳可能过期」）钉住正文，不被日志 tail 顶掉。
        self._pinned_warning = False
        # 项目根：启动完成时用它在后台复核窗口交接后的前台归属
        # （见 spawn_foreground_watch）。
        self._project_root = ""

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
            # 置顶（TOPMOST）的弹窗不能被最小化：ShowWindow(SW_MINIMIZE) 走的是
            # 「最小化整个 owned 窗口组」，而本窗口属于启动器进程（无主窗口组），
            # 系统找不到可最小化的父窗口，于是调用不生效——表现为「点最小化没反应」。
            # 真正有效的做法是改走「隐藏 + 撤置顶 + 交还前台」，需要一个能在
            # 非激活状态下持续执行的循环，这里借已有的 40ms 定时器（见
            # _keep_minimized / WM_TIMER 是本窗口唯一的周期钩子）。
            if self._minimized:
                self._keep_minimized()
                return 0
            if self._status == "ok":
                self._marquee = (self._marquee + 0.03) % 1.0
            user32.InvalidateRect(hwnd, None, False)
            return 0
        if msg == WM_LBUTTONDOWN:
            x = ctypes.c_short(lparam & 0xFFFF).value
            y = ctypes.c_short((lparam >> 16) & 0xFFFF).value
            if self._hit(self._min_btn_rect, x, y):
                self._minimize()
                return 0
            if self._hit(self._close_btn_rect, x, y):
                # 关闭 = 放弃本次启动（进程树由 dev-launcher 兜底回收）。
                self._close_should_terminate = True
                user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
                return 0
            self._dragging = True
            self._drag_start_x = x
            self._drag_start_y = y
            return 0
        if msg == WM_MOUSEMOVE and not self._dragging:
            # 悬停高亮：无边框窗口只有这一处视觉反馈，给用户「这是按钮」的信号。
            x = ctypes.c_short(lparam & 0xFFFF).value
            y = ctypes.c_short((lparam >> 16) & 0xFFFF).value
            hover = ""
            if self._hit(self._min_btn_rect, x, y):
                hover = "min"
            elif self._hit(self._close_btn_rect, x, y):
                hover = "close"
            if hover != self._hover_btn:
                self._hover_btn = hover
                user32.InvalidateRect(self.hwnd, None, False)
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

    @staticmethod
    def _hit(rect: tuple[int, int, int, int], x: int, y: int) -> bool:
        """点是否落在按钮矩形内（left, top, right, bottom）。"""
        lx, ty, rx, by = rect
        return lx <= x <= rx and ty <= y <= by

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
                    # 编排器可能因文件被占用回退到 dev-launcher-<pid>.log，
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
                    # 「壳可能过期」这类启动前提示是处置建议，不该被后续日志行顶掉
                    # （它只在启动前设一次，日志一直在变，顶掉就再也看不到了）。
                    if not self._pinned_warning:
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
        """自绘启动画面：一条紧凑的窄条，右上角是最小化 / 关闭。

        布局自上而下：标题行（品牌 + 右上角窗口按钮）→ 阶段状态 → 进度条 →
        脚注（已用时间 / 提示），全部按窗口高度自上而下铺开、底部留 14px 内边距。
        窗口尺寸本身就按内容给（见 SPLASH_W / SPLASH_H），所以这里不预留
        空白区域，画完即内容边界。
        """
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
        pad = 8
        panel_brush = gdi32.CreateSolidBrush(PANEL)
        panel_pen = gdi32.CreatePen(0, 1, VIOLET)
        old_brush = gdi32.SelectObject(hdc, panel_brush)
        old_pen = gdi32.SelectObject(hdc, panel_pen)
        gdi32.RoundRect(hdc, pad, pad, w - pad, h - pad, 14, 14)
        gdi32.SelectObject(hdc, old_brush)
        gdi32.SelectObject(hdc, old_pen)
        gdi32.DeleteObject(panel_brush)
        gdi32.DeleteObject(panel_pen)

        gdi32.SetBkMode(hdc, TRANSPARENT)

        # ── 标题行：品牌 + 右上角窗口按钮 ──
        # 按钮先算矩形（同时给命中判定用），文本右边界据此让位，避免文字压到按钮。
        btn_size = 24
        btn_gap = 6
        btn_top = pad + 10
        close_right = w - pad - 12
        self._close_btn_rect = (close_right - btn_size, btn_top,
                                close_right, btn_top + btn_size)
        self._min_btn_rect = (close_right - btn_size * 2 - btn_gap, btn_top,
                              close_right - btn_size - btn_gap, btn_top + btn_size)

        title_font = self._create_font(hdc, 14, bold=True)
        old_font = gdi32.SelectObject(hdc, title_font)
        gdi32.SetTextColor(hdc, VIOLET if self._status != "error" else ERROR_RED)
        title_rc = RECT()
        title_rc.left = pad + 14
        title_rc.top = btn_top
        title_rc.right = self._min_btn_rect[0] - 10
        title_rc.bottom = btn_top + btn_size
        user32.DrawTextW(hdc, self._title, -1, ctypes.byref(title_rc),
                         DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(title_font)

        self._draw_window_button(hdc, self._min_btn_rect, "min")
        self._draw_window_button(hdc, self._close_btn_rect, "close")

        # ── 阶段状态（副标题 + 消息）：标题行下方 ──
        sub_font = self._create_font(hdc, 10)
        old_font = gdi32.SelectObject(hdc, sub_font)
        gdi32.SetTextColor(hdc, GRAY)
        sub_rc = RECT()
        sub_rc.left = pad + 14
        sub_rc.top = btn_top + btn_size + 8
        sub_rc.right = w - pad - 14
        sub_rc.bottom = sub_rc.top + 18
        user32.DrawTextW(hdc, self._subtitle, -1, ctypes.byref(sub_rc),
                         DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)

        msg_rc = RECT()
        msg_rc.left = pad + 14
        msg_rc.top = sub_rc.bottom + 2
        msg_rc.right = w - pad - 14
        msg_rc.bottom = msg_rc.top + 34
        gdi32.SetTextColor(hdc, GRAY_DIM)
        user32.DrawTextW(hdc, self._msg, -1, ctypes.byref(msg_rc),
                         DT_LEFT | DT_TOP | DT_WORDBREAK | DT_NOPREFIX)

        # 已用时间（进度条右端）
        elapsed = time.time() - self._start_time
        elapsed_text = f"已用 {int(elapsed // 60):02d}:{int(elapsed % 60):02d}"
        time_rc = RECT()
        time_rc.left = w - pad - 100
        time_rc.top = h - pad - 54
        time_rc.right = w - pad - 14
        time_rc.bottom = time_rc.top + 16
        gdi32.SetTextColor(hdc, GRAY_DIM)
        user32.DrawTextW(hdc, elapsed_text, -1, ctypes.byref(time_rc),
                         DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(sub_font)

        # ── 进度条（贴近底部，右侧为已用时间让位）──
        if self._status in ("ok", "timeout"):
            bar_h = 6
            bar_x = pad + 14
            bar_w = w - 2 * pad - 28 - 92
            bar_y = h - pad - 12 - bar_h

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

        # 脚注：把「右上角两个按钮各做什么」写清楚（无边框窗口没有标题栏提示位）。
        hint_font = self._create_font(hdc, 9)
        old_font = gdi32.SelectObject(hdc, hint_font)
        gdi32.SetTextColor(hdc, GRAY_DIM)
        hint_rc = RECT()
        hint_rc.left = pad + 14
        hint_rc.top = h - pad - 24
        hint_rc.right = self._min_btn_rect[0] - 12
        hint_rc.bottom = hint_rc.top + 16
        user32.DrawTextW(hdc, "关闭（右上角 ✕）即放弃本次启动；最小化后可从任务栏还原",
                         -1, ctypes.byref(hint_rc),
                         DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(hint_font)

    def _draw_window_button(self, hdc: HDC, rect: tuple[int, int, int, int],
                            kind: str) -> None:
        """绘制右上角的最小化 / 关闭按钮（含悬停高亮）。

        无边框窗口没有系统标题栏，这两个按钮是启动画面唯一的窗口出口，
        因此必须自绘并给出悬停反馈（见 _wnd_proc 的 WM_MOUSEMOVE 与命中判定）。
        """
        lx, ty, rx, by = rect
        hovered = self._hover_btn == kind
        if kind == "close":
            bg = ERROR_RED if hovered else 0x2A2024
            fg = 0xFFFFFF if hovered else GRAY
        else:
            bg = 0x3A2E34 if hovered else 0x2A2024
            fg = 0xFFFFFF if hovered else GRAY

        brush = gdi32.CreateSolidBrush(bg)
        old_b = gdi32.SelectObject(hdc, brush)
        gdi32.RoundRect(hdc, lx, ty, rx, by, 6, 6)
        gdi32.SelectObject(hdc, old_b)
        gdi32.DeleteObject(brush)

        pen = gdi32.CreatePen(0, 1, fg)
        old_p = gdi32.SelectObject(hdc, pen)
        margin = 7
        cy = (ty + by) // 2
        if kind == "min":
            gdi32.MoveToEx(hdc, lx + margin, cy, None)
            gdi32.LineTo(hdc, rx - margin, cy)
        else:
            gdi32.MoveToEx(hdc, lx + margin, ty + margin, None)
            gdi32.LineTo(hdc, rx - margin, by - margin)
            gdi32.MoveToEx(hdc, rx - margin, ty + margin, None)
            gdi32.LineTo(hdc, lx + margin, by - margin)
        gdi32.SelectObject(hdc, old_p)
        gdi32.DeleteObject(pen)

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

    def set_warning(self, msg: str):
        """提示（不影响启动流程）：副标题换成警告语，正文给可执行的处置。

        置为「钉住」：正文是处置建议，不能让后续日志行把它顶掉。

        与 set_error 的区别只在语义：窗口按钮「点了没反应」这类问题的成因常是
        「壳过期」，但启动本身还能继续——把处置写出来即可，不该把画面变成失败态。
        """
        self._subtitle = "⚠ 壳可能过期"
        self._msg = msg
        self._pinned_warning = True
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
        # 用户可能先把窗口最小化过：结束前把状态清掉并让窗口回到可见，
        # 否则销毁的是「隐藏 + 未置顶」的那个，用户看不出它已经走了。
        self._minimized = False
        self._reset_below_hwnd()
        user32.KillTimer(self.hwnd, self._timer_id)
        # 必须从 GUI 线程调用 PostQuitMessage 才有效；Timer 线程不能直接发 WM_QUIT。
        # 改发 WM_CLOSE 到窗口，WndProc 在主线程里收到后再 PostQuitMessage。
        def _post_close():
            try:
                user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
            except Exception as exc:
                log(f"post close error: {exc}")
        threading.Timer(delay_ms / 1000.0, _post_close).start()

    # ── 最小化（置顶弹窗的正确做法） ──
    # 点右上角的最小化必须有反应，这里不能只写 ShowWindow(SW_MINIMIZE)：
    # 窗口带 WS_EX_TOPMOST 且属于启动器进程（无同进程主窗口组），系统会去
    # 最小化「它的整个窗口组」——找不到可最小化的父窗口，调用等于没发生。
    # 所以改成两条动作合起来：
    #   ① 撤掉置顶（TOPMOST 不撤，窗口会一直压在别人上面，等于没最小化）；
    #   ② 隐藏窗口（启动器按进度用 Activate 唤起「相关窗口」时不会再翻出它），
    #      并把前台交还给原本压在下面的窗口。
    # 恢复（原样回到屏幕上的位置）由启动器自己在需要时调用 _restore。
    def _minimize(self):
        self._minimized = True
        self._reset_below_hwnd()
        self._keep_minimized()

    def _reset_below_hwnd(self):
        self._below_hwnd = 0
        self._below_checked = False

    def _keep_minimized(self):
        """把窗口维持在被用户「最小化」后的状态（定时器每 40ms 调一次）。

        幂等：已经是隐藏态时只做一次前台交还，不重复抢。
        """
        try:
            if user32.IsWindowVisible(self.hwnd):
                if not self._below_checked:
                    self._below_checked = True
                    self._below_hwnd = user32.GetWindow(self.hwnd, GW_HWNDNEXT) or 0
                user32.SetWindowPos(
                    self.hwnd, 0, 0, 0, 0, 0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
                )
                user32.ShowWindow(self.hwnd, SW_HIDE)
                # 前台还回去：否则用户点了「最小化」，画面上的活跃窗口还是消失的
                # 那个（键盘输入落不到任何可见窗口）。
                if self._below_hwnd and user32.IsWindow(self._below_hwnd):
                    user32.SetForegroundWindow(self._below_hwnd)
        except Exception as exc:
            log(f"keep_minimized error: {exc}")

    def _restore(self):
        """最小化后恢复：还原置顶与可见性，回到屏幕上原来的位置。"""
        if not self._minimized:
            return
        self._minimized = False
        self._reset_below_hwnd()
        try:
            user32.ShowWindow(self.hwnd, SW_SHOW)
            user32.SetWindowPos(
                self.hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            )
            user32.SetForegroundWindow(self.hwnd)
        except Exception as exc:
            log(f"restore splash error: {exc}")

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
#  启动完成后的前台归属复核（窗口交接那一刻，独立进程）
# ═══════════════════════════════════════════════════════════════════════════════
def app_window_process_name() -> str:
    """应用壳窗口所属进程的 exe 文件名（小写）。

    Windows 下壳是 `app.exe`；Linux / macOS 下无后缀（`app`，macOS 为 .app 包内
    的同名可执行文件）。判据一处定义、两个调用点复用 —— 写死后缀会让 POSIX 侧
    「找不到窗口」而不报错，是最难查的那类静默失败。
    """
    return "app.exe" if os.name == "nt" else "app"


def _find_app_window() -> HWND:
    """当前可见的应用壳窗口句柄（主窗口或启动页），找不到返回 0。"""
    found: list[HWND] = [0]

    def callback(hwnd: HWND, _lparam: LPARAM) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if _is_app_shell_window(hwnd, buf.value):
            found[0] = hwnd
            return False
        return True

    try:
        proc = WNDENUMPROC(callback)
        user32.EnumWindows(proc, 0)
        callback._keep = proc  # type: ignore[attr-defined]
    except Exception as exc:
        log(f"_find_app_window error: {exc}")
    return found[0]


def spawn_foreground_watch(project_root: str) -> None:
    """交接复核：窗口真正显示之后，再裁定一次前台归属（见 scripts/win32-window-focus.py）。

    启动期的 `decide_foreground` 只回答「双击之后用户是不是马上走开了」——用户切去
    干别的可以持续几分钟，等应用真正冒出来时「双击入口还在前台」这条判据早已失真；
    更关键的是窗口交接那一刻 Windows 会把前台**自动放行**给新显示的主窗（启动页是
    WS_EX_TOOLWINDOW，关闭后任务栏按钮重建），壳里任何 `set_focus()` 都「成功」，
    「不打断用户」的策略当场被架空。复核进程负责把这个不该给的前台还回去。

    独立进程而非线程：前台输入相关的动作（AttachThreadInput / SendInput /
    SetForegroundWindow）都绑定调用线程的输入状态，混进 GUI 线程会干扰窗口消息。
    日志写 log/launcher/foreground-watch.log——交接发生在启动完成之后，那时启动器
    主日志已经收尾，独立落盘才排得到。
    """
    hwnd = _find_app_window()
    if not hwnd:
        log("foreground watch: no app shell window found, skip")
        return
    focus_script = os.path.join(project_root, "scripts", "win32-window-focus.py")
    if not os.path.isfile(focus_script):
        log(f"foreground watch: script missing: {focus_script}")
        return
    try:
        log_dir = _ensure_log_dir(project_root)
        out = open(os.path.join(log_dir, "foreground-watch.log"), "a", encoding="utf-8", buffering=1)
        child_env = {**os.environ, "COMFYAPP_FOREGROUND": os.environ.get("COMFYAPP_FOREGROUND", "0")}
        subprocess.Popen(
            [sys.executable, focus_script, "HWND:%d" % int(hwnd), app_window_process_name()],
            cwd=project_root,
            env=child_env,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=out,
            close_fds=True,
            # 熔断保护：复核最迟 60s 自己退出，不留常驻进程。
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        log(f"foreground watch spawned (hwnd={int(hwnd)}, process={app_window_process_name()})")
    except Exception as exc:
        log(f"foreground watch spawn failed: {exc}")


def spawn_splash_front(project_root: str) -> None:
    """壳一启动就把**启动页窗口**带到前台（独立进程，见 win32-window-focus.py）。

    为什么必须有人做这件事：启动页是用户双击启动的直接反馈，而 Windows 在
    「GUI 进程由另一个进程拉起」时并不保证新窗口进前台——尤其双击入口在文件
    资源管理器里时，启动页会被压在它后面，用户看到的是「双击了没反应」
    （ISSUE #576）。壳侧那次 `set_focus()` 在前台锁定下常常拿不到前台，
    所以交给本仓库已验证可靠的这条路径（Alt + AttachThreadInput，见
    win32-window-focus.py 的 focus_window）。

    只抢「首次可见」那一下：用户随后切走是他的选择（这正是启动页与「应用窗口」
    两套策略的分界，见 decide_foreground / decide_handoff）。
    """
    hwnd = _find_app_window()
    if not hwnd:
        log("splash front: no app shell window found, skip")
        return
    focus_script = os.path.join(project_root, "scripts", "win32-window-focus.py")
    if not os.path.isfile(focus_script):
        log(f"splash front: script missing: {focus_script}")
        return
    try:
        log_dir = _ensure_log_dir(project_root)
        out = open(os.path.join(log_dir, "foreground-watch.log"), "a", encoding="utf-8", buffering=1)
        subprocess.Popen(
            [sys.executable, focus_script, "--splash", "HWND:%d" % int(hwnd), app_window_process_name()],
            cwd=project_root,
            env=os.environ.copy(),
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=out,
            close_fds=True,
            creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        log(f"splash front spawned (hwnd={int(hwnd)})")
    except Exception as exc:
        log(f"splash front spawn failed: {exc}")


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
    """启动时确保 comfy-cli 虚拟环境就绪（缺失则安装，落后则升级）。

    raw UI-format（liblib 子图）工作流由 executor-cli.ts 交给项目内的
    comfy-cli venv 做 UI→API 转换；venv 缺失时提交任务会直接 spawn ENOENT，
    comfy-cli 过旧时子图 wrapper 的覆盖不生效（提示词/种子整段失效）。
    因此每次启动都后台触发一次 setup-comfy-cli-venv.ps1，由它统一决定：
      - venv 缺失 / comfy_cli 不可导入 → 建 venv + 安装；
      - 已就绪 → 按节流窗口（默认 24h）联网比版本，落后才升级。
    判断逻辑只放在脚本里，这里不做早退，否则 venv 一旦建好就再也不会升级。
    安装/升级可能耗时数分钟，不能阻塞启动；独立进程组保证 launcher 在 Tauri
    窗口出现后退出时安装不会被中断。
    """
    venv_py = _comfy_cli_venv_python(project_root)
    setup_ps1 = os.path.join(project_root, "scripts", "setup-comfy-cli-venv.ps1")
    if not os.path.isfile(setup_ps1):
        log(f"comfy-cli setup script not found: {setup_ps1}")
        return

    shell = shutil.which("pwsh") or shutil.which("powershell")
    if not shell:
        log("no powershell found, skipping comfy-cli venv ensure")
        return

    if os.path.isfile(venv_py):
        log(f"comfy-cli venv present ({venv_py}), delegating upgrade check to {setup_ps1}")
    else:
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
# ═══════════════════════════════════════════════════════════════════════════════
#  启动编排器（node scripts/dev-launcher.mjs）
# ═══════════════════════════════════════════════════════════════════════════════
def _warn_if_stale_shell(project_root: str) -> str:
    """壳二进制比壳源码旧时记一条可定位的警告，返回警告文本（空串表示没问题）。

    为什么在启动器里查一次：「窗口按钮点了没反应」这类问题里，最常见的一组成因
    是**壳没重编**——`src-tauri/src/**`、`tauri.conf.json`、启动页改了之后仍跑着
    旧 `app.exe`，于是新启动页调的命令在旧壳里不存在（`win_minimize` /
    `win_close` 报 not allowed / not found 之类）。纯文件时间戳比较不可能给出
    确切结论，但它能把「先重编壳」这一步提到用户面前——这比让人对着一个没反应的
    按钮猜要省事得多。

    与编排器 `shellStaleWarning()` 的壳时效检查（stale_shell）同源、同判据。
    """
    try:
        shell_sources = [
            os.path.join(project_root, "src-tauri", "tauri.conf.json"),
            os.path.join(project_root, "src-tauri", "build.rs"),
        ]
        src_dir = os.path.join(project_root, "src-tauri", "src")
        if os.path.isdir(src_dir):
            for name in os.listdir(src_dir):
                if name.endswith(".rs"):
                    shell_sources.append(os.path.join(src_dir, name))
        for rel in ("splash-assets/splash.html", "splash-assets/index.html"):
            shell_sources.append(os.path.join(project_root, "src-tauri", rel))

        newest = 0.0
        for path in shell_sources:
            try:
                newest = max(newest, os.path.getmtime(path))
            except OSError:
                continue
        if newest <= 0:
            return ""

        for exe in (
            os.path.join(project_root, "src-tauri", "target", "release", "app.exe"),
            os.path.join(project_root, "src-tauri", "target", "debug", "app.exe"),
        ):
            try:
                if os.path.getmtime(exe) < newest:
                    return (
                        "正在运行旧版桌面壳（app.exe 比壳源码/配置旧），界面可能不是最新逻辑；"
                        "建议重编：cd src-tauri && cargo build --release --features custom-protocol"
                    )
            except OSError:
                continue
        return ""
    except Exception as exc:
        log(f"stale shell check failed: {exc}")
        return ""


def _node_exe() -> str:
    """解析 node 可执行文件（不硬编码安装路径，但**不选调度不了的形态**）。

    为什么不能用 `shutil.which("node")` 一把梭（ISSUE #636 同族）：`which` 是按
    `PATHEXT` 找**存在的文件**，命中后交给 `subprocess.Popen` 起 —— 而 bat/cmd 由
    `CreateProcess` 起不来（`EINVAL`、Windows 上的批处理只有 cmd.exe 会解释它），
    corepack 那类**无扩展名**的 shim 也可能因为不是 PE 镜像而失败。三种形态里只有
    「真的能跑起来」的那个可用，判据与 Node 侧 `launcher-core/shell.mjs` 同口径：
    `.exe` / 不带扩展名（真的 PE 或已配好文件关联）优先，`.cmd` / `.bat` 垫底且
    必须经 `cmd.exe /c` 起。

    返回的是「可直接交给 Popen 的命令」——可能是 `cmd.exe` 配 `/c <bat>`，
    调用方按 `[exe] + node_args` 使用。
    """
    candidates: list[str] = []
    for name in ("node", "node.exe", "node.cmd", "node.bat"):
        found = shutil.which(name)
        if found and found not in candidates:
            candidates.append(found)
    if not candidates:
        return ""

    def rank(path: str) -> int:
        ext = os.path.splitext(path)[1].lower()
        if ext == ".exe":
            return 0
        if ext == "":
            return 1
        return 2  # .cmd / .bat：只能经 cmd.exe

    best = min(candidates, key=rank)
    ext = os.path.splitext(best)[1].lower()
    if ext in (".cmd", ".bat"):
        comspec = os.environ.get("ComSpec") or "cmd.exe"
        if _is_node_usable([comspec, "/c", best]):
            return comspec
        return ""
    if not _is_node_usable([best, "--version"]):
        # 存在但调度不了（不是 PE 镜像 / 权限不对）：宁可为空让调用方给可见出口，
        # 也不要拉起一个必然 EINVAL 的进程。
        return ""
    return best


def _is_node_usable(argv: list[str]) -> bool:
    """真起一次确认「这个形态能跑」（判据与 Node 侧 usableCommand 同口径）。"""
    try:
        proc = subprocess.run(
            argv,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return proc.returncode == 0
    except Exception:
        return False


def _node_argv(node: str, node_args: list[str]) -> list[str]:
    """把 node 命令与脚本参数拼成 Popen 的 argv（bat/cmd 形态要经 cmd.exe）。

    `cmd /c node <args>`：由 cmd.exe 自己按 PATHEXT 解析 `node`，与用户在终端敲
    `node <args>` 同语义 —— 而 `cmd.exe` 的参数是 `subprocess.list2cmdline` 拼的
    带引号形式，`/c` 后面的整串会被 cmd 重新解析一次，这是它能工作、Node 的
    `spawn` 不能的原因。
    """
    if os.path.splitext(node)[1].lower() in (".cmd", ".bat"):
        return [node, "/c", "node", *node_args]
    return [node, *node_args]


def _shell_exe(project_root: str) -> str:
    """预编译壳的可执行文件（按平台后缀解析：Windows app.exe，POSIX 无后缀）。

    与编排器的 `defaultShellExe()` 同判据、同候选顺序；这里显式传进去是为了让
    「启动器看到的壳」与「编排器拉起的壳」一定是同一个文件。
    """
    names = ("app.exe",) if os.name == "nt" else ("app",)
    for profile in ("release", "debug"):
        for name in names:
            candidate = os.path.join(project_root, "src-tauri", "target", profile, name)
            if os.path.isfile(candidate):
                return candidate
    return ""


def launch_dev_server(project_root: str, mode: str = "prebuilt") -> "subprocess.Popen[str] | None":
    """拉起跨平台启动编排器（scripts/dev-launcher.mjs）。

    参数按编排器的 CLI 约定传：`--mode tauri` / `--mode prebuilt`。返回 Popen
    句柄：调用方（启动画面 / headless 监控）靠它判「编排器是否提前退出」，并用
    PID 文件对仍存活的壳做兜底回收。
    """
    entry = _launcher_entry(project_root)
    if not os.path.isfile(entry):
        log(f"launcher entry not found: {entry}")
        return None

    node = _node_exe()
    if not node:
        log("node not found in PATH (dev-launcher.mjs needs it)")
        return None
    log(f"using node: {node}")

    node_args = [entry, "--mode", "tauri" if mode == "tauri" else "prebuilt"]
    if mode != "tauri":
        shell = _shell_exe(project_root)
        if shell:
            node_args += ["--shell-exe", shell]
            log(f"prebuilt shell: {shell}")

    # 拉起编排器之前先清掉上一轮留下的壳 PID 文件：窗口期内读到的只会是
    # 「上一轮的旧 PID」，而那号可能已被无关进程占用（见 _shell_pid_file）。
    _reset_shell_pid_file(project_root)

    # 隐藏窗口起 node；stdin 关闭避免句柄泄漏。stdout/stderr 重定向到文件，
    # 方便排查「提前退出但无日志」的问题。
    try:
        out_path = os.path.join(project_root, "log", "launcher", "dev-launcher-stdout.log")
        err_path = os.path.join(project_root, "log", "launcher", "dev-launcher-stderr.log")
        for p in (out_path, err_path):
            try:
                with open(p, "w", encoding="utf-8") as f:
                    f.write("")
            except OSError:
                pass
        out = open(out_path, "a", encoding="utf-8", buffering=1)
        err = open(err_path, "a", encoding="utf-8", buffering=1)
        return subprocess.Popen(
            _node_argv(node, node_args),
            cwd=project_root,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=err,
            # close_fds=True: 子进程不继承本进程（含 PyInstaller 运行时）的可继承
            # 句柄，避免它占用 PyInstaller 单文件临时目录导致退出时清理失败。
            # 对 onedir 模式同样有益：子进程不会误持 launcher 目录下的文件句柄。
            close_fds=True,
            # 让编排器脱离启动器的进程树独立存活：启动器在主窗口出现后即退出，
            # 若 dev-launcher 随其一起被回收，便无法在桌面窗口关闭时回收 dev server，
            # 导致 next dev 进程树残留为孤儿（锁端口、占资源）。启动与构建流程规范
            # §1 分层边界明确要求「Python 启动器退出时 dev-launcher 必须还能活着继续工作」。
            # DETACHED_PROCESS 使其脱离启动器控制台/进程组；CREATE_NEW_PROCESS_GROUP
            # 让其成为独立进程组根，不被启动器的控制台事件波及。
            creationflags=(
                getattr(subprocess, "CREATE_NO_WINDOW", 0)
                | getattr(subprocess, "DETACHED_PROCESS", 0)
                | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            ),
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
            if find_tauri_window(exact=True):
                log("tauri window detected, closing splash in 600ms")
                # 用户可能把启动画面最小化过：交接这一下要让他看得见（窗口还原
                # 后再关闭），否则「启动完成了但界面上什么都没发生」。
                splash._restore()
                spawn_foreground_watch(splash._project_root)  # type: ignore[attr-defined]
                splash.close_later(600, terminate=False)
                return
            if proc is not None and proc.poll() is not None:
                exit_code = proc.returncode
                log(f"dev-launcher process exited early with code {exit_code}")
                splash.set_error("启动进程已退出，请检查 log/launcher/dev-launcher.log")
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

    # 启动页「首次可见」时抢一次前台（见 spawn_splash_front）：one-shot，
    # 只做一次，之后用户切走就不该再拉回来。
    splash_front_done = False

    try:
        last_write = 0.0
        while time.time() < deadline:
            # 启动页窗口先于主窗口出现：它一可见就把前台拿到手（双击启动的反馈）。
            # 放在这里而不是启动前，是因为此刻窗口刚建好、系统已完成首次显示，
            # 抢前台不会与「窗口还没建」抢跑。
            if not splash_front_done and find_tauri_window():
                splash_front_done = True
                spawn_splash_front(project_root)
            try:
                # 如果编排器切换了当前日志文件，跟随 sentinel
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
            if find_tauri_window(exact=True):
                _write_status(
                    project_root,
                    "ready",
                    message="启动完成",
                    ready=True,
                    elapsed=elapsed(),
                )
                log("tauri window detected, launcher exiting")
                # 交接已完成（主窗口已可见）：复核前台归属，把「不该给的前台」还回去。
                spawn_foreground_watch(project_root)
                if proc is not None and proc.poll() is None:
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        pass
                return

            # dev-launcher 提前退出：先分清「用户自己关掉启动页、放弃本次启动」
            # 与真正的失败——前者再弹一个红色「启动失败」是误报：用户刚刚亲手按的 ✕，
            # 弹窗只会让人以为启动坏了（退出码也看不出区别，这条路径壳是 exit(0)）。
            if proc is not None and proc.poll() is not None:
                exit_code = proc.returncode
                log(f"dev-launcher process exited early with code {exit_code}")
                _kill_shell_from_pid_file(project_root)
                if _launch_cancelled(project_root):
                    log("launch cancelled by user (splash closed), no failure dialog")
                    _write_status(
                        project_root,
                        "cancelled",
                        message="已取消本次启动",
                        elapsed=elapsed(),
                    )
                    return 0
                _write_status(
                    project_root,
                    "error",
                    message="启动进程已退出，请检查 log/launcher/dev-launcher.log",
                    error=True,
                    elapsed=elapsed(),
                )
                # 失败必须有人类可见的出口：历史版本只写 30 秒后自删的状态
                # 文件，用户看到的是「双击没反应」。弹窗展示日志尾部。
                _fatal_box(
                    _build_failure_message(
                        project_root,
                        f"启动进程 dev-launcher.mjs 提前退出（exit={exit_code}）。",
                    )
                )
                return 1

            time.sleep(0.5)

        log("headless monitor deadline reached (240s)")
        if proc is not None and proc.poll() is not None:
            # 正常收尾路径：dev-launcher 已退出（用户关掉桌面窗口），回收壳 PID 文件；
            # 壳若仍活着说明它脱离了启动器，同样补刀。
            _kill_shell_from_pid_file(project_root)
        if find_tauri_window(exact=True):
            _write_status(
                project_root,
                "ready",
                message="启动完成",
                ready=True,
                elapsed=elapsed(),
            )
            spawn_foreground_watch(project_root)
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
        _kill_shell_from_pid_file(project_root)
        _fatal_box(_build_failure_message(project_root, f"启动器监控异常：{exc}"))
        return 1
    return 0


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
    args: dict[str, bool | str] = {
        "splash": False,
        "focus": True,
        "tauri_dev": False,
        "standalone": False,
        "cold_start": False,
        "foreground": False,
        "background": False,
    }
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
        elif a in ("cold-start", "coldstart"):
            args["cold_start"] = True
        elif a in ("foreground", "activate"):
            args["foreground"] = True
        elif a in ("background", "no-foreground"):
            args["background"] = True
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

    前置：``tools\\build\\build-standalone.ps1``（``pnpm tauri build``）已把 standalone 资源
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
            "请先运行 tools\\build\\build-standalone.ps1（pnpm tauri build）构建独立版本。",
        )
    if not os.path.isfile(server_js) or not os.path.isfile(node_exe):
        log("standalone mode: standalone resources missing")
        return _cleanup_and_exit(
            1,
            "standalone 资源缺失（server.js / Node sidecar）。\n\n"
            "请先运行 tools\\build\\build-standalone.ps1（pnpm tauri build）完成完整生产构建，\n"
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
        if find_tauri_window(exact=True):
            log("standalone mode: tauri window detected, launcher exiting")
            spawn_foreground_watch(project_root)
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
            "  --cold-start  本次是脚本/终端拉起：启动完成后允许给前台\n"
            "  --foreground  启动完成后强制把应用窗口置前\n"
            "  --background  启动完成后一律不置前（留在任务栏闪烁提醒）\n"
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
    # 把启动模式透传给 Rust 壳，让 dev/standalone 不再依赖 resource_dir 探测：
    #   standalone -> 壳必须走内嵌 server.js（缺失即报错，不回退 dev）
    #   其它        -> 壳直接加载 COMFYAPP_DEV_URL（由编排器起 dev server）
    os.environ["COMFYAPP_LAUNCH_MODE"] = mode
    if mode != "standalone":
        entry_path = _launcher_entry(project_root)
        if not os.path.isfile(entry_path):
            return _fatal_box(
                f"找不到启动编排器：{entry_path}\n请把 start-tauri.exe 放在项目根目录。"
            )
    else:
        entry_path = None

    # 单实例保护 + 陈旧锁自愈
    # 互斥量按检出隔离（§1.4）：名字带上检出路径哈希，另一份检出的启动器
    # 与本检出互不可见，各自的单实例 / 唤起语义独立生效。
    global _SHELL_OWN_PREFIX
    _SHELL_OWN_PREFIX = (
        os.path.abspath(project_root).lower().rstrip("\\/") + os.sep
    )
    lock_file = _launcher_lock_file(project_root)
    _stale_pid = _read_lock_pid(lock_file)
    if _stale_pid is not None and not _is_pid_alive(_stale_pid):
        log(f"stale lock file (pid {_stale_pid} dead), removing")
        _safe_remove(lock_file)

    mutex = create_mutex(
        "Local\\ComfyAppTauriLauncherMutex-%08x"
        % _fnv1a32(_SHELL_OWN_PREFIX.encode("utf-8"))
    )
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

    # 如果 Tauri 窗口已经存在，直接聚焦（不重复启动）。
    # 这是用户主动唤起已有实例，先把「允许前台」告诉壳：壳收到单实例回调时也走给前台路径。
    if args.get("focus", True) and find_tauri_window():
        os.environ["COMFYAPP_FOREGROUND"] = "1"
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
    os.environ["COMFYAPP_DEV_URL"] = "http://127.0.0.1:%d/workspace" % _read_app_port(project_root)

    # 启动完成是否允许应用窗口自动抢前台：默认否（启动耗时期间用户可能已切走，
    # 突然弹到最前面会打断他正在看的内容），见 decide_foreground。
    if args.get("foreground"):
        force_foreground = True
    elif args.get("background"):
        force_foreground = False
    else:
        force_foreground = decide_foreground(cold_start=bool(args.get("cold_start")))
    os.environ["COMFYAPP_FOREGROUND"] = "1" if force_foreground else "0"

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
            return _fatal_box("无法启动 scripts/dev-launcher.mjs，请检查 Node.js 是否可用。")
        _write_status(project_root, "initial")
        monitor_code = 0
        try:
            monitor_code = _monitor_headless(project_root, proc)
        finally:
            if mutex:
                kernel32.ReleaseMutex(mutex)
                kernel32.CloseHandle(mutex)
            _safe_remove(lock_file)
            # 保留状态文件 30 秒，让启动页能读到最终 ready；随后清理。
            threading.Timer(30.0, lambda: _cleanup_status(project_root)).start()
            close_logging()
        return monitor_code

    splash = SplashWindow()
    splash._project_root = project_root
    # 旧壳会让启动页的窗口按钮失效（新命令在旧壳里不存在）。这条只记日志、
    # 提醒重编，不阻断启动——判据是文件时间戳，不足以据此拒绝启动。
    stale_shell_warn = _warn_if_stale_shell(project_root)
    if not splash.show():
        if mutex:
            kernel32.CloseHandle(mutex)
        close_logging()
        return _fatal_box("无法创建启动画面窗口。")

    if stale_shell_warn:
        splash.set_warning(stale_shell_warn)

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
                f"详细日志请查看 log/launcher/start-tauri-launcher.log",
                f"{APP_TITLE} 启动器",
                MB_ICONERROR | MB_OK,
            )
        except Exception:
            pass
        sys.exit(1)
