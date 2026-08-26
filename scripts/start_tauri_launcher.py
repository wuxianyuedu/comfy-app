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

打包为单文件 exe（无控制台窗口）：
    pyinstaller --onefile --windowed --name start-tauri scripts/start_tauri_launcher.py
请将生成的 dist/start-tauri.exe 放在项目根目录（与 scripts/ 同级）。
"""

import os
import sys
import time
import math
import shutil
import threading
import subprocess

import ctypes
from ctypes import wintypes

# ── Win32 常量 ──
# Python 3.13 从 ctypes.wintypes 移除了 LRESULT/WPARAM/LPARAM，手动定义。
LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t

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
DEFAULT_GUI_FONT = 17
FW_NORMAL = 400
FW_BOLD = 700

# ── 暗色极光配色（与 app 的 #0A0A0F 背景 / violet 主色一致）──
BG = 0x0F0A0A  # 0A0A0F in BGR
PANEL = 0x1C1012  # #12101C in BGR
VIOLET = 0xFC5C7C  # #7C5CFC in BGR
GRAY = 0xAF9CA3  # #9CA3AF in BGR
GRAY_DIM = 0x80726B  # #6B7280 in BGR
ERROR_RED = 0x4444EF  # #EF4444 in BGR

SPLASH_W = 420
SPLASH_H = 170


# ── 项目根目录探测 ──
def get_project_root() -> str:
    """打包单文件 exe 时，工作目录通常是用户放 exe 的目录（项目根目录）。"""
    cwd = os.getcwd()
    if os.path.isfile(os.path.join(cwd, "scripts", "dev-launcher.ps1")):
        return cwd
    # 非打包运行：脚本在 scripts/ 下，父目录即项目根目录
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parent = os.path.dirname(script_dir)
    if os.path.isfile(os.path.join(parent, "scripts", "dev-launcher.ps1")):
        return parent
    # 再回退 sys.executable 所在目录
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    if os.path.isfile(os.path.join(exe_dir, "scripts", "dev-launcher.ps1")):
        return exe_dir
    return cwd


# ── Win32 窗口探测：Tauri 主窗口标题为 "Comfy APP" ──
def find_tauri_window() -> bool:
    try:
        user32 = ctypes.windll.user32
        found = [False]

        def callback(hwnd: wintypes.HWND, _lparam: LPARAM) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value or ""
            if "Comfy APP" in title:
                found[0] = True
                return False
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, LPARAM)
        proc = WNDENUMPROC(callback)
        user32.EnumWindows(proc, 0)
        callback._keep = proc  # type: ignore[attr-defined]
        return found[0]
    except Exception:
        return False


# ── Win32 API 原型 ──
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
gdi32 = ctypes.windll.gdi32

user32.CreateWindowExW.argtypes = [
    wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID,
]
user32.CreateWindowExW.restype = wintypes.HWND

user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, WPARAM, LPARAM]
user32.DefWindowProcW.restype = LRESULT

user32.RegisterClassExW.argtypes = [ctypes.c_void_p]
user32.RegisterClassExW.restype = wintypes.ATOM

user32.GetMessageW.argtypes = [ctypes.c_void_p, wintypes.HWND, wintypes.UINT, wintypes.UINT]
user32.GetMessageW.restype = ctypes.c_int

user32.TranslateMessage.argtypes = [ctypes.c_void_p]
user32.TranslateMessage.restype = wintypes.BOOL

user32.DispatchMessageW.argtypes = [ctypes.c_void_p]
user32.DispatchMessageW.restype = LRESULT

user32.PostQuitMessage.argtypes = [ctypes.c_int]

user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.c_void_p]

user32.SetWindowPos.argtypes = [
    wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int, wintypes.UINT,
]
user32.SetWindowPos.restype = wintypes.BOOL

user32.SetTimer.argtypes = [wintypes.HWND, wintypes.UINT_PTR, wintypes.UINT, wintypes.TIMERPROC]
user32.SetTimer.restype = wintypes.UINT_PTR

user32.KillTimer.argtypes = [wintypes.HWND, wintypes.UINT_PTR]
user32.KillTimer.restype = wintypes.BOOL

user32.InvalidateRect.argtypes = [wintypes.HWND, ctypes.c_void_p, wintypes.BOOL]
user32.InvalidateRect.restype = wintypes.BOOL

user32.LoadCursorW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
user32.LoadCursorW.restype = wintypes.HCURSOR

user32.GetDC.argtypes = [wintypes.HWND]
user32.GetDC.restype = wintypes.HDC

user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
user32.ReleaseDC.restype = ctypes.c_int

user32.BeginPaint.argtypes = [wintypes.HWND, ctypes.c_void_p]
user32.BeginPaint.restype = wintypes.HDC

user32.EndPaint.argtypes = [wintypes.HWND, ctypes.c_void_p]
user32.EndPaint.restype = wintypes.BOOL

user32.GetDesktopWindow.restype = wintypes.HWND

user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.c_void_p]
user32.GetWindowRect.restype = wintypes.BOOL

user32.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]

# ── GDI ──
gdi32.CreateSolidBrush.argtypes = [wintypes.COLORREF]
gdi32.CreateSolidBrush.restype = wintypes.HBRUSH

gdi32.CreatePen.argtypes = [ctypes.c_int, ctypes.c_int, wintypes.COLORREF]
gdi32.CreatePen.restype = wintypes.HPEN

gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
gdi32.SelectObject.restype = wintypes.HGDIOBJ

gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
gdi32.DeleteObject.restype = wintypes.BOOL

gdi32.SetTextColor.argtypes = [wintypes.HDC, wintypes.COLORREF]
gdi32.SetTextColor.restype = wintypes.COLORREF

gdi32.SetBkColor.argtypes = [wintypes.HDC, wintypes.COLORREF]
gdi32.SetBkColor.restype = wintypes.COLORREF

gdi32.SetBkMode.argtypes = [wintypes.HDC, ctypes.c_int]
gdi32.SetBkMode.restype = ctypes.c_int

gdi32.Rectangle.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
gdi32.Rectangle.restype = wintypes.BOOL

gdi32.RoundRect.argtypes = [
    wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    ctypes.c_int, ctypes.c_int,
]
gdi32.RoundRect.restype = wintypes.BOOL

gdi32.CreateFontW.argtypes = [
    ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
    wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
    wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD,
    wintypes.LPCWSTR,
]
gdi32.CreateFontW.restype = wintypes.HFONT

gdi32.DrawTextW.argtypes = [
    wintypes.HDC, wintypes.LPCWSTR, ctypes.c_int, ctypes.c_void_p,
    wintypes.UINT,
]
gdi32.DrawTextW.restype = ctypes.c_int


# ── RECT / WNDCLASSEX 结构 ──
class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("style", ctypes.c_uint),
        ("lpfnWndProc", ctypes.c_void_p),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", wintypes.HINSTANCE),
        ("hIcon", wintypes.HICON),
        ("hCursor", wintypes.HCURSOR),
        ("hbrBackground", wintypes.HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
        ("hIconSm", wintypes.HICON),
    ]


class PAINTSTRUCT(ctypes.Structure):
    _fields_ = [
        ("hdc", wintypes.HDC),
        ("fErase", wintypes.BOOL),
        ("rcPaint", RECT),
        ("fRestore", wintypes.BOOL),
        ("fIncUpdate", wintypes.BOOL),
        ("rgbReserved", ctypes.c_byte * 32),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", WPARAM),
        ("lParam", LPARAM),
        ("time", wintypes.DWORD),
        ("pt", POINT),
    ]


# ── 启动画面窗口类 ──
class SplashWindow:
    def __init__(self):
        self.hwnd: wintypes.HWND = 0
        self._closed = False
        self._progress = 0.0
        self._status = "ok"  # ok | error | timeout
        self._msg = "首次启动需编译，约 30–90 秒，请稍候…"
        self._title = "Comfy APP"
        self._subtitle = "正在启动桌面应用…"
        self._wc_atom = 0
        self._class_name = "ComfyAppSplashW"
        self._timer_id = 1

    def _register_class(self) -> bool:
        wnd_proc = ctypes.WINFUNCTYPE(
            LRESULT, wintypes.HWND, wintypes.UINT, WPARAM, LPARAM
        )(self._wnd_proc)
        self._wnd_proc_ref = wnd_proc  # keep reference

        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = ctypes.cast(wnd_proc, ctypes.c_void_p).value
        wc.hInstance = kernel32.GetModuleHandleW(None)
        wc.hCursor = user32.LoadCursorW(None, wintypes.LPCWSTR(32512))  # IDC_ARROW
        wc.hbrBackground = 0
        wc.lpszClassName = self._class_name

        atom = user32.RegisterClassExW(ctypes.byref(wc))
        if atom == 0:
            return False
        self._wc_atom = atom
        return True

    def _wnd_proc(self, hwnd: wintypes.HWND, msg: wintypes.UINT,
                  wparam: WPARAM, lparam: LPARAM) -> LRESULT:
        if msg == WM_PAINT:
            ps = PAINTSTRUCT()
            hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))
            self._paint(hdc)
            user32.EndPaint(hwnd, ctypes.byref(ps))
            return 0
        if msg == WM_TIMER:
            if self._status == "ok":
                self._progress = (self._progress + 0.03) % 1.0
            user32.InvalidateRect(hwnd, None, False)
            return 0
        if msg == WM_LBUTTONDOWN:
            user32.PostQuitMessage(0)
            return 0
        if msg == WM_DESTROY:
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _create_font(self, hdc: wintypes.HDC, size: int, bold: bool = False) -> wintypes.HFONT:
        # 将 pt 转换为逻辑高度（负数表示字符高度）
        dpi = gdi32.GetDeviceCaps(hdc, LOGPIXELSX)
        height = -int(size * dpi / 72)
        return gdi32.CreateFontW(
            height, 0, 0, 0, FW_BOLD if bold else FW_NORMAL,
            0, 0, 0, 0, 0, 0, 0, 0,
            "Microsoft YaHei UI",
        )

    def _paint(self, hdc: wintypes.HDC):
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

        title_font = self._create_font(hdc, 20, bold=True)
        old_font = gdi32.SelectObject(hdc, title_font)
        gdi32.SetTextColor(hdc, VIOLET if self._status != "error" else ERROR_RED)

        title_rc = RECT()
        title_rc.left = pad + 24
        title_rc.top = pad + 22
        title_rc.right = w - pad - 24
        title_rc.bottom = title_rc.top + 32
        gdi32.DrawTextW(hdc, self._title, -1, ctypes.byref(title_rc),
                        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(title_font)

        sub_font = self._create_font(hdc, 12)
        old_font = gdi32.SelectObject(hdc, sub_font)
        gdi32.SetTextColor(hdc, GRAY)
        sub_rc = RECT()
        sub_rc.left = pad + 24
        sub_rc.top = pad + 58
        sub_rc.right = w - pad - 24
        sub_rc.bottom = sub_rc.top + 22
        gdi32.DrawTextW(hdc, self._subtitle, -1, ctypes.byref(sub_rc),
                        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)

        msg_rc = RECT()
        msg_rc.left = pad + 24
        msg_rc.top = pad + 118
        msg_rc.right = w - pad - 24
        msg_rc.bottom = msg_rc.top + 18
        gdi32.SetTextColor(hdc, GRAY_DIM)
        gdi32.DrawTextW(hdc, self._msg, -1, ctypes.byref(msg_rc),
                        DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX)
        gdi32.SelectObject(hdc, old_font)
        gdi32.DeleteObject(sub_font)

        # 进度条
        if self._status == "ok":
            bar_y = pad + 90
            bar_h = 6
            bar_x = pad + 24
            bar_w = w - 2 * pad - 48

            track_brush = gdi32.CreateSolidBrush(0x1C1012)  # 与面板同色稍深，BGR
            track_pen = gdi32.CreatePen(0, 1, 0x1C1012)
            old_b = gdi32.SelectObject(hdc, track_brush)
            old_p = gdi32.SelectObject(hdc, track_pen)
            gdi32.RoundRect(hdc, bar_x, bar_y, bar_x + bar_w, bar_y + bar_h, bar_h, bar_h)
            gdi32.SelectObject(hdc, old_b)
            gdi32.SelectObject(hdc, old_p)
            gdi32.DeleteObject(track_brush)
            gdi32.DeleteObject(track_pen)

            # 流动高亮块
            seg_w = max(40, int(bar_w * 0.25))
            pos = int(self._progress * (bar_w + seg_w)) - seg_w
            x1 = max(bar_x, bar_x + pos)
            x2 = min(bar_x + bar_w, bar_x + pos + seg_w)
            if x2 > x1:
                grad_brush = gdi32.CreateSolidBrush(VIOLET)
                old_b = gdi32.SelectObject(hdc, grad_brush)
                gdi32.RoundRect(hdc, x1, bar_y, x2, bar_y + bar_h, bar_h, bar_h)
                gdi32.SelectObject(hdc, old_b)
                gdi32.DeleteObject(grad_brush)

    def show(self):
        if not self._register_class():
            return False

        hinstance = kernel32.GetModuleHandleW(None)

        # 屏幕居中
        screen = user32.GetDC(0)
        screen_w = gdi32.GetDeviceCaps(screen, 118)  # HORZRES
        screen_h = gdi32.GetDeviceCaps(screen, 117)  # VERTRES
        user32.ReleaseDC(0, screen)
        x = (screen_w - SPLASH_W) // 2
        y = (screen_h - SPLASH_H) // 2

        self.hwnd = user32.CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            self._class_name,
            "ComfyAPP Bootstrap",
            WS_POPUP | WS_VISIBLE,
            x, y, SPLASH_W, SPLASH_H,
            0, 0, hinstance, None,
        )
        if not self.hwnd:
            return False

        user32.SetWindowPos(
            self.hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        user32.SetTimer(self.hwnd, self._timer_id, 40, None)
        return True

    def set_error(self, msg: str):
        self._status = "error"
        self._title = "Comfy APP"
        self._subtitle = "启动失败"
        self._msg = msg
        user32.InvalidateRect(self.hwnd, None, False)

    def set_timeout(self):
        self._status = "timeout"
        self._subtitle = "启动时间较长"
        self._msg = "窗口尚未出现，但启动进程仍在运行，请稍候…"
        user32.InvalidateRect(self.hwnd, None, False)

    def close_later(self, delay_ms: int):
        if self._closed:
            return
        self._closed = True
        user32.KillTimer(self.hwnd, self._timer_id)
        threading.Timer(delay_ms / 1000.0, lambda: user32.PostQuitMessage(0)).start()

    def run_message_loop(self):
        msg = MSG()
        while True:
            ret = user32.GetMessageW(ctypes.byref(msg), 0, 0, 0)
            if ret == 0 or ret == -1:
                break
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))


# ── 启动 dev-launcher.ps1 ──
def launch_dev_server(project_root: str) -> "subprocess.Popen | None":
    ps1 = os.path.join(project_root, "scripts", "dev-launcher.ps1")
    if not os.path.isfile(ps1):
        return None
    pwsh = shutil.which("pwsh") or shutil.which("pwsh.exe")
    if not pwsh:
        pwsh = shutil.which("powershell") or shutil.which("powershell.exe")
    if not pwsh:
        return None
    return subprocess.Popen(
        [pwsh, "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
         "-File", ps1, "-Tauri"],
        cwd=project_root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


# ── 后台监控线程 ──
def monitor(proc: "subprocess.Popen | None", splash: SplashWindow):
    deadline = time.time() + 240
    while time.time() < deadline:
        if splash._closed:
            return
        if find_tauri_window():
            splash.close_later(600)
            return
        if proc is not None and proc.poll() is not None:
            splash.set_error("启动进程已退出，请检查 log/dev-launcher.log")
            splash.close_later(4000)
            return
        time.sleep(0.5)
    splash.set_timeout()
    splash.close_later(3000)


def main() -> int:
    project_root = get_project_root()
    ps1_path = os.path.join(project_root, "scripts", "dev-launcher.ps1")
    if not os.path.isfile(ps1_path):
        ctypes.windll.user32.MessageBoxW(
            0,
            f"找不到启动脚本：{ps1_path}\n请把 start-tauri.exe 放在项目根目录。",
            "Comfy APP 启动器",
            0x10,  # MB_ICONERROR
        )
        return 1

    splash = SplashWindow()
    if not splash.show():
        ctypes.windll.user32.MessageBoxW(
            0,
            "无法创建启动画面窗口。",
            "Comfy APP 启动器",
            0x10,
        )
        return 1

    proc = launch_dev_server(project_root)
    if proc is None:
        splash.set_error("无法找到 PowerShell / pwsh，请安装后重试")
        splash.close_later(4000)
    else:
        t = threading.Thread(target=monitor, args=(proc, splash), daemon=True)
        t.start()

    splash.run_message_loop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
