"""窗口交接时刻的前台归属裁定（独立进程运行，由启动器拉起）。

为什么不能在壳里做：应用窗口从启动页（`WS_EX_TOOLWINDOW` 小窗）交接过来时，
任务栏按钮会重建，Windows 把主窗当成**新窗口并把前台放行给它**——壳里任何
`set_focus()` 都会「成功」，于是「不打断用户」的策略在交接这一瞬间被架空，
用户看到的就是「启动好了照样弹到最前」（ISSUE #359 回归）。

也不能只靠启动期的一次性判决（`decide_foreground`）：用户双击后去干别的可以持续
几分钟，等应用真正冒出来时「双击入口还在前台」这条判据早已失真。所以还要在
**窗口真正显示的那一刻**再裁定一次：

- ``give``    —— 用户就在等这个应用（启动期判决允许）：把前台拿到手（含键盘焦点，
  否则输入会落到别的窗口）；
- ``restore`` —— 不该给但系统自己放行了：把前台还回去（只改前台归属，不动输入内容）；
- ``leave``   —— 前台本来就是别的应用（用户切去干别的了）：窗口留在任务栏，
  由壳侧的任务栏闪烁提醒用户。

本文件刻意不依赖启动器（可单独执行，也便于在 Linux CI 上直接测纯判定函数）：
用法 ``python scripts/win32-window-focus.py HWND:123456 app.exe``，日志走 stdout。
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

# ── 与启动器共享的 SendInput 结构布局 ──

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.c_ushort),
        ("wScan", ctypes.c_ushort),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", _KEYBDINPUT)]


class _INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", _INPUTUNION)]


INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
VK_MENU = 0x12  # Alt

SW_RESTORE = 9

# 复核「前台是不是本应用」时的轮询参数：启动页关闭到主窗进前台之间有几十毫秒
# 空档，探太早会把「本来属于我们」误判成「用户切走了」。
FOREGROUND_CHECK_TIMEOUT_S = 1.5
FOREGROUND_CHECK_INTERVAL_S = 0.05

_IS_WINDOWS = os.name == "nt"

if _IS_WINDOWS:  # pragma: no cover - Windows 专用 ctypes 原型
    _user32 = ctypes.WinDLL("user32")
    _kernel32 = ctypes.WinDLL("kernel32")

    _user32.IsWindow.argtypes = [wt.HWND]
    _user32.IsWindow.restype = wt.BOOL
    _user32.IsWindowVisible.argtypes = [wt.HWND]
    _user32.IsWindowVisible.restype = wt.BOOL
    _user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
    _user32.ShowWindow.restype = wt.BOOL
    _user32.SetForegroundWindow.argtypes = [wt.HWND]
    _user32.SetForegroundWindow.restype = wt.BOOL
    _user32.GetForegroundWindow.argtypes = []
    _user32.GetForegroundWindow.restype = wt.HWND
    _user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(ctypes.c_ulong)]
    _user32.GetWindowThreadProcessId.restype = ctypes.c_ulong
    _user32.AttachThreadInput.argtypes = [ctypes.c_ulong, ctypes.c_ulong, wt.BOOL]
    _user32.AttachThreadInput.restype = wt.BOOL
    _user32.GetCurrentThreadId.argtypes = []
    _user32.GetCurrentThreadId.restype = ctypes.c_ulong
    _user32.SetFocus.argtypes = [wt.HWND]
    _user32.SetFocus.restype = wt.HWND
    _user32.SendInput.argtypes = [wt.UINT, ctypes.POINTER(_INPUT), ctypes.c_int]
    _user32.SendInput.restype = wt.UINT

    _kernel32.GetCurrentProcessId.argtypes = []
    _kernel32.GetCurrentProcessId.restype = ctypes.c_ulong
    _kernel32.OpenProcess.argtypes = [ctypes.c_ulong, wt.BOOL, ctypes.c_ulong]
    _kernel32.OpenProcess.restype = wt.HANDLE
    _kernel32.CloseHandle.argtypes = [wt.HANDLE]
    _kernel32.CloseHandle.restype = wt.BOOL

    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _log(message: str) -> None:
    """日志：独立进程直接写 stdout（启动器把它重定向到 log/launcher/foreground-watch.log）。"""
    try:
        print(message, flush=True)
    except Exception:
        pass


def decide_handoff(
    *,
    startup_allowed: bool,
    window_visible: bool,
    window_was_foreground: bool,
) -> str:
    """窗口从启动页交接过来的那一刻，前台归属该怎么处理。

    返回三选一（调用方据此执行）：

    - ``"give"``    —— 把前台交还/拿到应用窗口：启动期判决已认定「用户就在等这个
      应用」（`decide_foreground`：前台本来就是本应用 / 显式冷启动 / 唤起已有
      实例），此时窗口必须真的到前台，用户按过启动就该看到界面；
    - ``"restore"`` —— 把前台还回去：启动期判决是「别打断用户」，但系统在交接瞬间
      **自己把前台放行给了我们**——启动页窗口带 `WS_EX_TOOLWINDOW`，关闭它之后
      主窗的任务栏按钮重建，Windows 把主窗当成新窗口放行。这个前台不是用户要的，
      留着就是用户说的「还是会抢前台」；
    - ``"leave"``   —— 什么都不做：窗口没显示，或前台本来就是别的应用（用户切去
      干别的了），窗口只留在任务栏 + 任务栏闪烁提醒。

    默认落在 ``"leave"``：宁可少给一次前台，也不要多打断用户一次。
    """
    if not window_visible:
        # 窗口没显示（交接还没发生 / 用户已切走）：没有需要处理的前台归属。
        return "leave"
    if startup_allowed:
        return "give"
    if window_was_foreground:
        return "restore"
    return "leave"


def _to_hwnd(value: int):
    """回传地址分两种：进程内用的整数句柄 / 跨进程序列化过的 ``HWND:NNN``。"""
    if isinstance(value, int):
        return wt.HWND(value)
    text = str(value or "").strip()
    if not text:
        return wt.HWND(0)
    if ":" in text:
        text = text.rsplit(":", 1)[1]
    try:
        return wt.HWND(int(text, 16) if text.lower().startswith("0x") else int(text))
    except ValueError:
        return wt.HWND(0)


def foreground_process_name() -> str:
    """当前前台窗口所属进程的 exe 文件名（小写）；取不到返回空串。"""
    if not _IS_WINDOWS:
        return ""
    try:
        hwnd = _user32.GetForegroundWindow()
        if not hwnd:
            return ""
        pid = ctypes.c_ulong(0)
        _user32.GetWindowThreadProcessId(wt.HWND(hwnd), ctypes.byref(pid))
        if not pid.value:
            return ""
        handle = _kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if not handle:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(260)
            size = ctypes.c_ulong(260)
            if _kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                return os.path.basename(buf.value).lower()
        finally:
            _kernel32.CloseHandle(handle)
    except Exception as exc:
        _log(f"foreground-watch: foreground_process_name error: {exc}")
    return ""


def _press_alt() -> None:
    """发一次无副作用的 Alt 按键：仅用于让窗口线程成为前台线程。

    Windows 允许「刚收到输入事件的线程」调用 SetForegroundWindow，而启动器本身
    就是用户双击启动的那个进程（前后台归属变化前一直持有输入权）。单独按 Alt
    不产生任何输入内容（不触发菜单、不切换窗口），配合 AttachThreadInput 用来
    把交接瞬间的前台收回来。这是本项目已知唯一可靠的收回手段——`SetForegroundWindow`
    单独调在「交互前台期」结束后会被前台锁定拦下（实测 `already=focused` /
    任务栏闪烁反复触发即此路径）。
    """
    if not _IS_WINDOWS:
        return
    try:
        inputs = (_INPUT * 2)()
        inputs[0].type = INPUT_KEYBOARD
        inputs[0].union.ki.wVk = VK_MENU
        inputs[1].type = INPUT_KEYBOARD
        inputs[1].union.ki.wVk = VK_MENU
        inputs[1].union.ki.dwFlags = KEYEVENTF_KEYUP
        _user32.SendInput(2, ctypes.cast(inputs, ctypes.POINTER(_INPUT)), ctypes.sizeof(_INPUT))
    except Exception as exc:
        _log(f"foreground-watch: press_alt error: {exc}")


def focus_window(hwnd_value) -> bool:
    """把窗口带到前台（含键盘焦点）。成功返回 True。"""
    if not _IS_WINDOWS:
        return False
    hwnd = _to_hwnd(hwnd_value)
    if not hwnd:
        return False
    try:
        if _user32.IsWindowVisible(hwnd):
            _user32.ShowWindow(hwnd, SW_RESTORE)
        _user32.SetForegroundWindow(hwnd)
        # 键盘焦点：被前台锁定挡下时上面那步只把窗口带前，焦点仍在原窗口，
        # 用户输入会落到别处。用前台线程/本线程 attach + SendInput 补齐。
        foreground_pid = ctypes.c_ulong(0)
        _user32.GetWindowThreadProcessId(_user32.GetForegroundWindow(), ctypes.byref(foreground_pid))
        target_thread = _user32.GetWindowThreadProcessId(hwnd, None)
        current_thread = _kernel32.GetCurrentThreadId()
        if current_thread and target_thread and current_thread != target_thread:
            _user32.AttachThreadInput(current_thread, target_thread, True)
            _user32.SetFocus(hwnd)
            _user32.AttachThreadInput(current_thread, target_thread, False)
        return _user32.GetForegroundWindow() == hwnd
    except Exception as exc:
        _log(f"foreground-watch: focus_window error: {exc}")
        return False


def wait_for_main_window(hwnd_handle, timeout_s: float = 60.0):
    """轮询等待主窗口出现并可交互（给启动器内部复用）。

    交接发生前窗口一直藏着（`visible(false)`），启动器可以在交接后直接调用本函数
    拿主窗口句柄；这里也允许等待，以便复用同一条路径。
    """
    if not _IS_WINDOWS:
        return 0
    hwnd = _to_hwnd(hwnd_handle) if hwnd_handle else wt.HWND(0)
    if not hwnd:
        return 0
    deadline = time.time() + timeout_s
    while time.time() < deadline and _user32.IsWindow(hwnd):
        if _user32.IsWindowVisible(hwnd):
            return hwnd
        time.sleep(0.2)
    return 0


def resolve_action(hwnd, *, startup_allowed: bool) -> tuple[str, bool]:
    """在当前时刻裁定前台归属，返回 (action, window_was_foreground)。

    判定窗口是否已在前台用 **进程 PID 比较**（不是句柄比较）：交接时前台窗口可能
    是主窗内的 WebView 子窗，句柄不一致但进程一致——那同样属于「系统把前台给了
    本应用」。
    """
    foreground_hwnd = _user32.GetForegroundWindow()
    foreground_pid = ctypes.c_ulong(0)
    _user32.GetWindowThreadProcessId(foreground_hwnd, ctypes.byref(foreground_pid))
    window_pid = ctypes.c_ulong(0)
    _user32.GetWindowThreadProcessId(_to_hwnd(hwnd), ctypes.byref(window_pid))
    was_foreground = bool(window_pid.value) and window_pid.value == foreground_pid.value

    # 复核：启动页→主窗交接有几十毫秒空档，探到「不是我们」时先观察一小会儿，
    # 别把过渡态误判成「用户切走了」。
    if not was_foreground:
        probe_until = time.time() + FOREGROUND_CHECK_TIMEOUT_S
        while time.time() < probe_until:
            time.sleep(FOREGROUND_CHECK_INTERVAL_S)
            foreground_pid.value = 0
            _user32.GetWindowThreadProcessId(
                _user32.GetForegroundWindow(), ctypes.byref(foreground_pid)
            )
            was_foreground = bool(window_pid.value) and window_pid.value == foreground_pid.value
            if was_foreground:
                break

    action = decide_handoff(
        startup_allowed=startup_allowed,
        window_visible=bool(_user32.IsWindowVisible(_to_hwnd(hwnd))),
        window_was_foreground=was_foreground,
    )
    return action, was_foreground


def apply_action(hwnd, action: str, was_foreground: bool, *, log_prefix: str = "foreground-watch") -> None:
    """执行裁定：give 把前台拿回来；restore 把系统自放的前台还回去；leave 什么都不做。"""
    hwnd = _to_hwnd(hwnd)
    if action == "give":
        focused = focus_window(hwnd)
        _log(f"{log_prefix}: give -> focused={focused}")
    elif action == "restore":
        _press_alt()
        _log(
            f"{log_prefix}: restore -> foreground handed back "
            f"(shell window was auto-activated, window_was_foreground={was_foreground})"
        )
    else:
        _log(f"{log_prefix}: leave -> window stays in the taskbar")


def run_watch(hwnd_handle=None, window_process: str = "app.exe", timeout_s: float = 60.0) -> int:
    """等主窗口可见，裁定并执行一次前台归属，然后退出。

    由启动器以独立进程拉起（``python scripts/win32-window-focus.py HWND:123456 app.exe``）：
    ``COMFYAPP_FOREGROUND=1`` 表示启动期判决认定「用户就在等这个应用」。

    为什么「可见即裁定」就够：壳在窗口显示**之后紧接着**关闭启动页
    （`show_main_window_without_focus` → `splash.close()`），拿到的窗口已是可见
    主窗；等到它可见时系统该放行的前台也已经放行完，正好是一次裁定。裁定之后再
    多动作只会打扰用户（用户后来自己点了别处，就不该再被拉回去）。
    """
    if not _IS_WINDOWS:
        _log("foreground-watch: not windows, nothing to do")
        return 0
    startup_allowed = os.environ.get("COMFYAPP_FOREGROUND") == "1"
    _log(
        f"foreground-watch: start hwnd={hwnd_handle} process={window_process} "
        f"startup_allowed={startup_allowed}"
    )
    hwnd = wait_for_main_window(hwnd_handle, timeout_s)
    if not hwnd:
        _log("foreground-watch: no visible app window before timeout, nothing to do")
        return 0
    # 窗口刚可见时首帧可能还在渲染：稍等一下，既让系统完成前台放行，也避免在
    # 过渡态上做判定。
    time.sleep(0.4)
    action, was_foreground = resolve_action(hwnd, startup_allowed=startup_allowed)
    apply_action(hwnd, action, was_foreground)
    return 0


if __name__ == "__main__":  # pragma: no cover - 由启动器以独立进程拉起
    _hwnd_arg = sys.argv[1] if len(sys.argv) > 1 else ""
    _proc_arg = sys.argv[2] if len(sys.argv) > 2 else "app.exe"
    sys.exit(run_watch(_hwnd_arg, _proc_arg))
