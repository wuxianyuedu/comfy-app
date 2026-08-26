#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
start_tauri_launcher.py — Comfy-APP 桌面壳启动器（带启动画面）

取代了原来的 start-tauri.vbs：点击后立刻弹出一个暗色启动画面，
明确告知「正在启动」，避免「点了像没反应」的困惑。

职责：
  1. 弹出 tkinter 启动画面（暗色极光风格，与 app 一致）。
  2. 在隐藏窗口中调用 scripts/dev-launcher.ps1 -Tauri 启动 Tauri 桌面壳。
  3. 轮询 Win32 窗口，直到 Tauri 主窗口（标题 "Comfy APP"）出现后关闭画面。
  4. 兜底：超过 240s 仍未检测到窗口则关闭画面（不杀启动进程）；
     若启动进程提前异常退出则画面提示失败。

打包为单文件 exe（无控制台窗口）：
    pyinstaller --onefile --windowed --name start-tauri scripts/start_tauri_launcher.py
请将生成的 dist/start-tauri.exe 放在项目根目录（与 scripts/ 同级）。
"""

import os
import sys
import time
import shutil
import subprocess
import threading

import tkinter as tk
from tkinter import ttk

# ── 暗色极光配色（与 app 的 #0A0A0F 背景 / violet 主色一致）──
BG = "#0A0A0F"
PANEL = "#12101C"
VIOLET = "#7C5CFC"
GRAY = "#9CA3AF"
GRAY_DIM = "#6B7280"


# ── Win32 窗口探测：Tauri 主窗口标题为 "Comfy APP" ──
def find_tauri_window() -> bool:
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        found = [False]

        def callback(hwnd, _lparam):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            title = buf.value or ""
            # Tauri 窗口标题是 "Comfy APP"（带空格），本启动画面标题不含该串，
            # 因此不会误匹配自身。
            if "Comfy APP" in title:
                found[0] = True
                return False  # 停止枚举
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
        proc = WNDENUMPROC(callback)
        user32.EnumWindows(proc, 0)
        # 保持对 proc 的引用，防止被 GC 回收导致回调崩溃
        callback._keep = proc  # type: ignore[attr-defined]
        return found[0]
    except Exception:
        return False


def build_splash():
    root = tk.Tk()
    root.title("ComfyAPP Bootstrap")  # 不含 "Comfy APP"，避免被探测命中
    root.overrideredirect(True)  # 无标题栏，纯启动画面
    root.configure(bg=BG)
    root.resizable(False, False)

    w, h = 380, 150
    screen_w = root.winfo_screenwidth()
    screen_h = root.winfo_screenheight()
    root.geometry(f"{w}x{h}+{(screen_w - w) // 2}+{(screen_h - h) // 2}")

    frame = tk.Frame(root, bg=PANEL, highlightthickness=1, highlightbackground="#7C5CFC33")
    frame.place(x=8, y=8, width=w - 16, height=h - 16)

    tk.Label(
        frame, text="Comfy APP", bg=PANEL, fg=VIOLET,
        font=("Segoe UI", 18, "bold"),
    ).place(x=20, y=18)

    tk.Label(
        frame, text="正在启动桌面应用…", bg=PANEL, fg=GRAY,
        font=("Segoe UI", 11),
    ).place(x=22, y=52)

    bar = ttk.Progressbar(frame, mode="indeterminate", length=w - 64)
    bar.place(x=22, y=88, width=w - 64)
    bar.start(15)

    hint = tk.Label(
        frame, text="首次启动需编译，约 30–90 秒，请稍候…", bg=PANEL, fg=GRAY_DIM,
        font=("Segoe UI", 9),
    )
    hint.place(x=22, y=116)

    return root, bar, hint


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


def monitor(proc, root, bar, hint, finished):
    deadline = time.time() + 240  # 兜底超时
    while time.time() < deadline:
        if finished[0]:
            return
        if find_tauri_window():
            root.after(0, lambda: close_splash(root, bar, "ok"))
            return
        if proc is not None and proc.poll() is not None:
            # 启动进程退出但窗口未出现 → 大概率失败
            root.after(0, lambda: close_splash(root, bar, "error"))
            return
        time.sleep(0.5)
    # 超时：不杀进程，仅关闭画面（应用可能仍在编译）
    root.after(0, lambda: close_splash(root, bar, "timeout"))


def close_splash(root, bar, status):
    try:
        bar.stop()
    except Exception:
        pass
    if status == "error":
        # 给出失败提示，停留 4s 让用户看到，再关闭
        try:
            root.configure(bg=BG)
            for widget in root.winfo_children():
                widget.destroy()
            tk.Label(root, text="Comfy APP", bg=PANEL, fg="#ef4444",
                     font=("Segoe UI", 18, "bold")).place(x=20, y=40)
            tk.Label(root, text="启动失败，请检查 scripts/dev-launcher.ps1 日志",
                     bg=PANEL, fg=GRAY, font=("Segoe UI", 11)).place(x=22, y=80)
        except Exception:
            pass
        root.after(4000, root.destroy)
    else:
        root.after(600, root.destroy)


def main():
    project_root = os.path.dirname(os.path.abspath(sys.argv[0]))
    root, bar, hint = build_splash()
    finished = [False]

    proc = launch_dev_server(project_root)
    if proc is None:
        # 无法启动：立即提示
        close_splash(root, bar, "error")
        root.mainloop()
        return

    t = threading.Thread(target=monitor, args=(proc, root, bar, hint, finished), daemon=True)
    t.start()

    root.mainloop()


if __name__ == "__main__":
    main()
