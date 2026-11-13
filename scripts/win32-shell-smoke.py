"""真实 Windows 会话里的壳冒烟（ISSUE #3570）：观察「窗口到底有没有抢前台 /
任务栏还在不在闪」，补上 cargo test（纯函数）与源码形态判据都够不着的那一层。

跑的是**用户真实路径**：release 版 `app.exe`（双击等价）→ 壳自编排拉起启动器 →
dev server → 启动页 → 主窗交接。读数来自两台机器可读的通道：

- **Win32**：`GetForegroundWindow`（前台归属，按进程名比）、`IsWindowVisible` /
  `IsIconic`、Z 序（`GetWindow(GW_HWNDPREV)` 链上压在主窗上面的可见窗口数）；
- **壳自持日志**（`log/current/shell/shell.log`）：`main window shown without
  stealing focus` / `main window activated` / `window-show diagnostics at exit:
  attempts=N auto_show_skipped=N focus_granted=N`。

覆盖的场景（对应 #3570 的五条）：

1. **不抢前台**：`COMFYAPP_FOREGROUND=0` 启动，启动页出现后把前台切到本冒烟的
   控制台（模拟用户切去干别的）⇒ 主窗安静进任务栏：可见、不在前台、日志是
   `shown without stealing focus`、没有 `activated`；
2. **交接后不重放窗口动作**：观察窗内前台不翻转、无新 `activated`（交接后仍可能有
   零星自动显示**尝试**——dev 模式就绪重导航等——但幂等闸 #3562 会把它们拦成
   `reason=already_shown`，窗口动作一次都不重放）；
3. **二次启动的最小动作**：再起一份 app.exe ⇒ 单实例焦点等待者以
   `request_focus=true` 激活主窗（前台翻转为应用、日志 `activated (request=true`）、
   第二份进程随即退出；窗口已聚焦时再起一份 ⇒ 前台不丢、窗口不重 show；
4. **闪烁收口**：`activated` 那一行在源码里紧随 `request_user_attention(None)`
   （= `FlashWindowEx(FLASHW_STOP)`）之后 —— 日志在場即停止动作在場；全程无
   `foreground request not granted`（不会重新点燃闪烁）。⚠️ Win32 没有「查询
   闪烁状态」的公开 API，这一格只能靠壳日志交叉印证，读不出真值不硬造；
5. **一次性消费**：优雅关闭后读退出诊断 `window-show diagnostics at exit`：
   `focus_granted` 恰好等于显式唤起那两次（重挂多问不会再加），且
   `attempts = 1（交接，走「只显示」档）+ focus_granted + auto_show_skipped`
   —— 每个显示尝试要么给了前台、要么被幂等闸跳过，一笔都对上账。
   运行期计数信号（ISSUE #3569）与壳日志交叉印证。

用法（仓库根）：

    pnpm shell:smoke            # = node scripts/shell-smoke.mjs（建议入口）
    python scripts/win32-shell-smoke.py   # 等价直跑

前提：`src-tauri/target/release/app.exe` 已按硬规则 5 重编
（`cd src-tauri && cargo build --release --features custom-protocol`）；
本机没有别的 app.exe 在跑（单实例按检出隔离，但同名窗口会污染读数）。

退出码：0 = 五个场景全过；1 = 有场景失败（逐条念读数）；2 = 前提不成立。
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
EXE_PATH = REPO_ROOT / "src-tauri" / "target" / "release" / "app.exe"
SHELL_LOG = REPO_ROOT / "log" / "current" / "shell" / "shell.log"
REAP_ENTRY = REPO_ROOT / "scripts" / "reap-process.mjs"

MAIN_TITLE = "Comfy APP"
SPLASH_TITLE = "Comfy APP 启动中"
APP_PROC = "app.exe"

# 等待主窗：冷检出上 Next dev 首编译可能要一两分钟，给足余量；
# 其余等待都是秒级交互（前台翻转 / 单实例退出）。
MAIN_WINDOW_TIMEOUT_S = 300.0
FOREGROUND_TIMEOUT_S = 15.0
INSTANCE_EXIT_TIMEOUT_S = 15.0
GRACE_EXIT_TIMEOUT_S = 30.0
OBSERVE_WINDOW_S = 3.0

WM_CLOSE = 0x0010
GW_HWNDPREV = 3

_IS_WINDOWS = os.name == "nt"

if _IS_WINDOWS:  # pragma: no cover - Windows 专用 ctypes 原型
    _user32 = ctypes.WinDLL("user32")
    _kernel32 = ctypes.WinDLL("kernel32")

    _user32.IsWindow.argtypes = [wt.HWND]
    _user32.IsWindow.restype = wt.BOOL
    _user32.IsWindowVisible.argtypes = [wt.HWND]
    _user32.IsWindowVisible.restype = wt.BOOL
    _user32.IsIconic.argtypes = [wt.HWND]
    _user32.IsIconic.restype = wt.BOOL
    _user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
    _user32.GetWindowTextW.restype = ctypes.c_int
    _user32.GetForegroundWindow.argtypes = []
    _user32.GetForegroundWindow.restype = wt.HWND
    _user32.SetForegroundWindow.argtypes = [wt.HWND]
    _user32.SetForegroundWindow.restype = wt.BOOL
    _user32.GetWindow.argtypes = [wt.HWND, ctypes.c_uint]
    _user32.GetWindow.restype = wt.HWND
    _user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(ctypes.c_ulong)]
    _user32.GetWindowThreadProcessId.restype = ctypes.c_ulong
    _user32.AttachThreadInput.argtypes = [ctypes.c_ulong, ctypes.c_ulong, wt.BOOL]
    _user32.AttachThreadInput.restype = wt.BOOL
    _kernel32.GetCurrentThreadId.argtypes = []
    _kernel32.GetCurrentThreadId.restype = ctypes.c_ulong
    _user32.PostMessageW.argtypes = [wt.HWND, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    _user32.PostMessageW.restype = wt.BOOL
    _kernel32.GetConsoleWindow.argtypes = []
    _kernel32.GetConsoleWindow.restype = wt.HWND
    _kernel32.QueryFullProcessImageNameW.argtypes = [
        wt.HANDLE,
        ctypes.c_ulong,
        wt.LPWSTR,
        ctypes.POINTER(ctypes.c_ulong),
    ]
    _kernel32.QueryFullProcessImageNameW.restype = wt.BOOL
    _kernel32.OpenProcess.argtypes = [ctypes.c_ulong, wt.BOOL, ctypes.c_ulong]
    _kernel32.OpenProcess.restype = wt.HANDLE
    _kernel32.CloseHandle.argtypes = [wt.HANDLE]
    _kernel32.CloseHandle.restype = wt.BOOL

    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _log(message: str) -> None:
    """读数逐行落 stdout：成功的证据与失败的原因都在屏幕上可读。"""
    try:
        print(message, flush=True)
    except Exception:
        pass


def window_title(hwnd) -> str:
    buf = ctypes.create_unicode_buffer(256)
    _user32.GetWindowTextW(hwnd, buf, 256)
    return buf.value


def pid_of(hwnd) -> int:
    pid = ctypes.c_ulong(0)
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def process_name_of(hwnd) -> str:
    """窗口所属进程的 exe 文件名（小写）；取不到返回空串。"""
    pid = pid_of(hwnd)
    if not pid:
        return ""
    handle = _kernel32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(260)
        size = ctypes.c_ulong(260)
        if _kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
    finally:
        _kernel32.CloseHandle(handle)
    return ""


def foreground_hwnd():
    return _user32.GetForegroundWindow()


def foreground_name() -> str:
    hwnd = foreground_hwnd()
    return process_name_of(hwnd) if hwnd else ""


def windows_of_process(pid: int) -> "list[tuple[int, str]]":
    """枚举该进程的全部顶层窗口（句柄 + 标题）。"""
    found: list[tuple[int, str]] = []
    if not _IS_WINDOWS:
        return found

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def on_window(hwnd, _lparam):
        if pid_of(hwnd) == pid:
            found.append((int(hwnd), window_title(hwnd)))
        return True

    _user32.EnumWindows(on_window, 0)
    return found


def find_main_window(pid: int) -> int:
    """主窗 = 本进程可见的、标题为「Comfy APP」的顶层窗口（启动页标题不同，天然排除）。"""
    for hwnd, title in windows_of_process(pid):
        if title == MAIN_TITLE and _user32.IsWindowVisible(hwnd):
            return hwnd
    return 0


def find_splash_window(pid: int) -> int:
    for hwnd, title in windows_of_process(pid):
        if title == SPLASH_TITLE and _user32.IsWindowVisible(hwnd):
            return hwnd
    return 0


def visible_windows_above(hwnd) -> int:
    """Z 序读数：压在这个窗口上面的可见顶层窗口数（0 = 就在最前）。"""
    above = 0
    cursor = _user32.GetWindow(hwnd, GW_HWNDPREV)
    steps = 0
    while cursor and steps < 512:
        if _user32.IsWindowVisible(cursor):
            above += 1
        cursor = _user32.GetWindow(cursor, GW_HWNDPREV)
        steps += 1
    return above


def force_foreground(hwnd) -> bool:
    """把前台交给指定窗口（绕开前台锁定：Alt 输入 + 附加线程输入）。

    与 `win32-window-focus.py` 的 `focus_window()` 同一手段：Windows 只允许
    「刚收到输入事件的线程」调 `SetForegroundWindow`，单独调用会被前台锁定拦下。
    """
    if not _IS_WINDOWS or not hwnd:
        return False
    for _ in range(3):
        if foreground_hwnd() == hwnd:
            return True
        foreground_thread = _user32.GetWindowThreadProcessId(foreground_hwnd(), None)
        target_thread = _user32.GetWindowThreadProcessId(hwnd, None)
        current_thread = _kernel32.GetCurrentThreadId()
        attached = False
        if current_thread and target_thread and current_thread != target_thread:
            attached = bool(_user32.AttachThreadInput(current_thread, target_thread, True))
        try:
            _user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                _user32.AttachThreadInput(current_thread, target_thread, False)
        if foreground_hwnd() == hwnd:
            return True
        time.sleep(0.2)
    return foreground_hwnd() == hwnd


class LogTail:
    """壳自持日志的增量读数：`new_text()` 只还本次启动之后写进去的那一段，
    `all_text()` 聚合全程（跨场景的断言用这一份）。日志被轮转 / 重开时退回
    整份再接着记 —— 宁可多读，不漏读。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.chunks: list[str] = []
        try:
            self.offset = path.stat().st_size
        except OSError:
            self.offset = 0

    def new_text(self) -> str:
        try:
            raw = self.path.read_bytes()
        except OSError:
            return ""
        if len(raw) < self.offset:
            self.offset = 0
        text = raw[self.offset :].decode("utf-8", errors="replace")
        self.offset = len(raw)
        if text:
            self.chunks.append(text)
        return text

    def all_text(self) -> str:
        return "".join(self.chunks)


def wait_until(predicate, timeout_s: float, interval_s: float = 0.25):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(interval_s)
    return None


def reap(pid: int) -> None:
    """整树回收走 `scripts/reap-process.mjs`（AGENTS 硬规则 3 的非 TS 宿主入口）。"""
    subprocess.run(
        ["node", str(REAP_ENTRY), str(pid)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        timeout=60,
    )


class Scenario:
    """逐场景记账：名字 + 是否通过 + 当场读数（收尾逐条念出来）。"""

    def __init__(self) -> None:
        self.rows: list[tuple[str, bool, str]] = []

    def record(self, name: str, ok: bool, detail: str) -> bool:
        self.rows.append((name, ok, detail))
        _log(f"[shell-smoke] {'PASS' if ok else 'FAIL'} · {name} · {detail}")
        return ok

    def summarize(self) -> int:
        failed = [row for row in self.rows if not row[1]]
        _log(f"[shell-smoke] ── 结果：{len(self.rows) - len(failed)}/{len(self.rows)} 过 ──")
        for name, ok, detail in self.rows:
            _log(f"[shell-smoke] {'✓' if ok else '✗'} {name}: {detail}")
        return 0 if not failed else 1


def app_already_running() -> bool:
    """粗检同机有没有别的 app.exe：单实例虽按检出隔离，同名窗口会污染前台 / Z 序读数。"""
    probe = subprocess.run(
        ["tasklist", "/FI", f"IMAGENAME eq {APP_PROC}", "/FO", "CSV", "/NH"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    return APP_PROC in (probe.stdout or "").lower()


def main() -> int:
    if not _IS_WINDOWS:
        _log("[shell-smoke] 需要 Windows 真实会话（本脚本观察的就是 Win32 窗口行为）。")
        return 2
    if not EXE_PATH.exists():
        _log(
            f"[shell-smoke] 找不到 {EXE_PATH} —— 先按硬规则 5 重编壳："
            "cd src-tauri && cargo build --release --features custom-protocol"
        )
        return 2
    if app_already_running():
        _log("[shell-smoke] 已有 app.exe 在跑。先收掉再跑（同名窗口会污染前台 / Z 序读数）。")
        return 2

    log_tail = LogTail(SHELL_LOG)
    _log(f"[shell-smoke] 启动 {EXE_PATH}（COMFYAPP_FOREGROUND=0，双击等价）")
    env = dict(os.environ)
    env["COMFYAPP_FOREGROUND"] = "0"
    app = subprocess.Popen([str(EXE_PATH)], cwd=str(EXE_PATH.parent), env=env)

    scenarios = Scenario()
    try:
        run_scenarios(scenarios, app, log_tail)
    finally:
        if app.poll() is None:
            # 正常路径上面已经 WM_CLOSE 优雅退出（退出读数也来自那条路）；
            # 走到这里说明中途失败，按硬规则 3 整树收掉再报红。
            reap(app.pid)
            _log("[shell-smoke] 应用未优雅退出，已按整树回收（reap-process.mjs）。")
    return scenarios.summarize()


def run_scenarios(scenarios: Scenario, app: subprocess.Popen, log_tail: LogTail) -> None:
    """五个场景按启动时序串行执行；任何一步的前提塌了就带着读数早退。"""
    # ── 等启动页出现（壳建窗后由启动器把它带到前台一次，#576 的口径）。 ──
    splash = wait_until(lambda: find_splash_window(app.pid), MAIN_WINDOW_TIMEOUT_S)
    if not splash:
        tail = log_tail.all_text()[-1500:]
        scenarios.record(
            "前提：启动页出现",
            False,
            f"等待 {MAIN_WINDOW_TIMEOUT_S:.0f}s 未见到「{SPLASH_TITLE}」窗口；壳日志尾部：{tail!r}",
        )
        return
    # ── S1 的前置：模拟「用户切去干别的」。控制台窗口就是另一应用。 ──
    console = _kernel32.GetConsoleWindow()
    took = force_foreground(console) if console else False
    if not took:
        scenarios.record(
            "S1 前置：把前台切到别的窗口",
            False,
            f"SetForegroundWindow 被前台锁定拦下（console={bool(console)}，foreground={foreground_name()!r}）",
        )
        return
    _log("[shell-smoke] 前台已切到控制台（模拟用户切走），等主窗交接…")

    # 等主窗交接，期间**反复把前台按回控制台**：启动器那侧的 splash-front 是
    # 「启动页可见时抢一次前台」的一次性动作（#576），可能晚于我们第一次下手 ——
    # 谁后动手谁赢。反复按回，保证主窗显示那一刻（判据采样的那一刻）前台确实
    # 在「别的应用」手里，S1 的「用户已让出前台」才成立。
    main_hwnd = 0
    deadline = time.time() + MAIN_WINDOW_TIMEOUT_S
    while time.time() < deadline:
        force_foreground(console)
        main_hwnd = find_main_window(app.pid)
        if main_hwnd:
            break
        time.sleep(0.5)
    if not main_hwnd:
        tail = log_tail.all_text()[-1500:]
        scenarios.record(
            "前提：主窗交接出现",
            False,
            f"超时未见到「{MAIN_TITLE}」窗口；壳日志尾部：{tail!r}",
        )
        return
    # 交接刚完成时首帧可能还在渲染、前台放行也有几十毫秒空档：稳一下再取证。
    time.sleep(1.0)

    # ── S1：不抢前台。 ──
    fg = foreground_name()
    scenarios.record(
        "S1 不抢前台：主窗可见但前台在别的应用",
        bool(fg) and fg != APP_PROC and bool(_user32.IsWindowVisible(main_hwnd)),
        f"foreground={fg!r} visible={bool(_user32.IsWindowVisible(main_hwnd))} "
        f"z_above={visible_windows_above(main_hwnd)}",
    )
    text = log_tail.new_text()
    scenarios.record(
        "S1 日志：走的是「只显示不激活」那一档",
        "main window shown without stealing focus" in text
        and "main window activated" not in text,
        "log 含 shown-without-stealing-focus 且无 activated",
    )

    # ── S2：交接完成后，观察窗内不再发生「窗口动作」级别的重放。 ──
    # 交接后仍可能冒出零星的自动显示**尝试**（dev 模式下就绪重导航等）——幂等闸
    # （#3562）会把它们拦成 `reason=already_shown`，这正是 #3569 计数的用途；
    # 要钉的是**结果**：前台不翻转、没有新的 `activated`（没有窗口动作真的重放）。
    fg_at_start = foreground_name()
    time.sleep(OBSERVE_WINDOW_S)
    fg_at_end = foreground_name()
    text = log_tail.new_text()
    scenarios.record(
        "S2 交接后不重放窗口动作：前台不翻转、无新激活",
        fg_at_start != APP_PROC
        and fg_at_end != APP_PROC
        and text.count("main window activated") == 0,
        f"观察 {OBSERVE_WINDOW_S:.0f}s：foreground {fg_at_start!r}→{fg_at_end!r}，"
        f"already_shown 跳过 {text.count('reason=already_shown')} 次，新 activated "
        f"{text.count('main window activated')} 行",
    )

    # ── S3a：二次启动 ⇒ 单实例焦点等待者以 request_focus=true 激活主窗。 ──
    second = subprocess.Popen([str(EXE_PATH)], cwd=str(EXE_PATH.parent), env=dict(os.environ))
    second_exited = wait_until(lambda: second.poll() is not None, INSTANCE_EXIT_TIMEOUT_S)
    got_foreground = wait_until(lambda: foreground_name() == APP_PROC, FOREGROUND_TIMEOUT_S)
    text = log_tail.new_text()
    new_activated = text.count("main window activated")
    scenarios.record(
        "S3 二次启动：焦点等待者激活主窗、第二份即退",
        second_exited is not None and bool(got_foreground) and new_activated >= 1,
        f"second_exit={second_exited is not None} foreground={foreground_name()!r} "
        f"新增 activated 行={new_activated}",
    )
    if second.poll() is None:
        reap(second.pid)

    # ── S3b：已聚焦再起一份 ⇒ 前台不丢、窗口不重 show（最小动作）。 ──
    third = subprocess.Popen([str(EXE_PATH)], cwd=str(EXE_PATH.parent), env=dict(os.environ))
    third_exited = wait_until(lambda: third.poll() is not None, INSTANCE_EXIT_TIMEOUT_S)
    still_foreground = foreground_name() == APP_PROC
    still_visible = bool(_user32.IsWindowVisible(main_hwnd)) and not bool(_user32.IsIconic(main_hwnd))
    scenarios.record(
        "S3 已聚焦再起一份：前台不丢、窗口状态不动",
        third_exited is not None and still_foreground and still_visible,
        f"third_exit={third_exited is not None} foreground={foreground_name()!r} "
        f"visible={bool(_user32.IsWindowVisible(main_hwnd))} iconic={bool(_user32.IsIconic(main_hwnd))}",
    )
    if third.poll() is None:
        reap(third.pid)

    # ── S4：闪烁收口（日志交叉印证；Win32 无查询闪烁状态的公开 API）。 ──
    whole = log_tail.all_text()
    scenarios.record(
        "S4 闪烁收口：激活即 FLASHW_STOP、无未批准前台请求",
        "main window activated" in whole and "foreground request not granted" not in whole,
        f"activated 行在场={'main window activated' in whole} "
        f"not-granted 行数={whole.count('foreground request not granted')}",
    )

    # ── S5 + 收口：优雅关闭，读退出诊断。 ──
    # 一次性消费（#3562/#3569）：focus_granted 只允许来自**显式唤起**（二次启动
    # 的焦点等待者）那两次；交接后重挂 / 多问不会再加分毫。自动显示尝试只许
    # 被跳过（attempts = focus_granted + auto_show_skipped，一笔都对上账）。
    _user32.PostMessageW(main_hwnd, WM_CLOSE, None, None)
    exited = wait_until(lambda: app.poll() is not None, GRACE_EXIT_TIMEOUT_S)
    if not exited:
        reap(app.pid)
    text = log_tail.new_text()
    exit_line = ""
    for line in text.splitlines():
        if "window-show diagnostics at exit" in line:
            exit_line = line.strip()
    ok = False
    detail = f"grace_exit={exited is not None} 退出读数：{exit_line or '(没读到 —— 壳未优雅退出)'}"
    match = re.search(
        r"attempts=(\d+) auto_show_skipped=(\d+) focus_granted=(\d+)", exit_line or ""
    )
    if match:
        attempts, skipped, granted = (int(g) for g in match.groups())
        # 账目恒等式：交接那一次走「只显示」档（不给前台也不算跳过），此后所有
        # request_focus=false 的自动尝试都被幂等闸接住 ⇒
        #   attempts = 1（交接）+ focus_granted（显式唤起）+ auto_show_skipped（被拦的重放）
        ok = (
            exited is not None
            and granted == 2
            and attempts == granted + skipped + 1
        )
        detail = (
            f"grace_exit={exited is not None} attempts={attempts} "
            f"auto_show_skipped={skipped} focus_granted={granted}"
            "（focus_granted 应恰为二次启动那两次显式唤起；交接那一次不计入两栏）"
        )
    scenarios.record("S5 一次性消费：focus_granted 只算显式唤起，尝试全部有账", ok, detail)


if __name__ == "__main__":  # pragma: no cover - 直接执行
    sys.exit(main())
