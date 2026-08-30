#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dev_tools_launcher.py — Comfy-APP 开发工具箱（按钮式 GUI 启动器）

把常用的开发 / 维护命令集中到一个窗口里，点一下按钮就执行，并在下方实时
显示输出，避免每次都去翻 scripts/ 目录、敲一长串命令。

特点：
  - 纯标准库 + tkinter（Windows 自带，PyInstaller 可直接打包，无第三方依赖）
  - 每个命令后台线程执行，GUI 不卡顿；长驻进程（dev server）可一键停止
  - 输出实时回显到文本框，自动滚动到底部

打包为无控制台 exe（风格与 start_tauri_launcher.py 一致）：
    pyinstaller --onedir --windowed --name dev-tools --distpath . scripts/dev_tools_launcher.py

生成的 dev-tools/ 目录（含 dev-tools.exe 与 _internal 依赖）放在项目根目录，
双击 dev-tools/dev-tools.exe 即可使用。
"""

from __future__ import annotations

import os
import sys
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import tkinter as tk
from tkinter import ttk, scrolledtext

# 隐藏子进程控制台窗口（Windows）。值同 subprocess.CREATE_NO_WINDOW。
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

BG = "#0a0a0f"
PANEL = "#16161c"
BORDER = "#26262e"
INK = "#ededf2"
MUTED = "#9a9aad"
VIOLET = "#7c5cfc"
ACCENT = "#ec4899"


# ═══════════════════════════════════════════════════════════════════════════════
#  项目根目录探测（兼容直接运行脚本与 onedir 打包两种布局）
# ═══════════════════════════════════════════════════════════════════════════════
def detect_root() -> str:
    candidates: list[str] = []

    cwd = os.getcwd()
    if _is_root(cwd):
        return cwd
    candidates.append(cwd)

    # onedir: dev-tools/dev-tools.exe → 项目根是它上一级；onefile: exe 直接在根目录
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    for directory in (exe_dir, os.path.dirname(exe_dir)):
        if _is_root(directory):
            return directory
        candidates.append(directory)

    try:
        script_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        if _is_root(script_parent):
            return script_parent
    except NameError:
        pass

    return cwd


def _is_root(path: str) -> bool:
    return os.path.isfile(os.path.join(path, "scripts", "dev-launcher.ps1"))


# ═══════════════════════════════════════════════════════════════════════════════
#  工具定义
# ═══════════════════════════════════════════════════════════════════════════════
@dataclass
class Tool:
    name: str
    kind: str  # "pwsh" | "node" | "explorer"
    script: str
    args: tuple[str, ...] = ()
    desc: str = ""
    long_running: bool = False


TOOLS = [
    Tool(
        "启动桌面壳（秒出）",
        "pwsh",
        "scripts/dev-launcher.ps1",
        ("-Prebuilt",),
        "启动 Next.js + 预编译 Tauri 壳（窗口秒出，推荐）",
        long_running=True,
    ),
    Tool(
        "启动 Tauri dev",
        "pwsh",
        "scripts/dev-launcher.ps1",
        ("-Tauri",),
        "pnpm tauri dev，完整 Rust 热重载（首次启动慢）",
        long_running=True,
    ),
    Tool(
        "启动 Web 开发服务器",
        "pwsh",
        "scripts/dev-launcher.ps1",
        (),
        "仅启动 Next.js dev（localhost:3000）",
        long_running=True,
    ),
    Tool(
        "注册 comfyapp:// 协议",
        "pwsh",
        "scripts/install-comfyapp-helper.ps1",
        (),
        "注册浏览器唤起文件夹的自定义协议（仅需一次）",
    ),
    Tool("修复导入", "node", "scripts/repair-imports.cjs", (), "批量修复 import 路径"),
    Tool("检查文件结构", "node", "scripts/check-file-structure.cjs", (), "校验目录 / 文件结构规范"),
    Tool("强制 IPv4 DNS", "node", "scripts/force-ipv4-dns.cjs", (), "规避 localhost 解析到 IPv6 的问题"),
    Tool("Tailwind v4 codemod", "node", "scripts/tw4-canonical-codemod.cjs", (), "规范化 Tailwind v4 用法"),
    Tool("重构 studio", "node", "scripts/restructure-studio.cjs", (), "studio 目录结构重构"),
]


# ═══════════════════════════════════════════════════════════════════════════════
#  GUI
# ═══════════════════════════════════════════════════════════════════════════════
class DevToolsLauncher:
    def __init__(self, root: tk.Tk, project_root: str) -> None:
        self.root = root
        self.root_dir = project_root
        self.running_proc: Optional[subprocess.Popen] = None
        self._pwsh = self._resolve("pwsh", "pwsh.exe") or self._resolve(
            "powershell", "powershell.exe"
        )
        self._node = self._resolve("node", "node.exe")

        root.title("Comfy-APP 开发工具箱")
        root.geometry("780x580")
        root.configure(bg=BG)
        root.minsize(640, 460)
        root.protocol("WM_DELETE_WINDOW", self._on_close)

        self._build_header()
        self._build_button_grid()
        self._build_console()
        self._build_statusbar()

        self._set_status(f"项目根目录：{project_root}")
        self._log(f"Comfy-APP 开发工具箱已就绪。可执行脚本位于 {project_root}/scripts\n")

    # ── 控件 ──
    def _build_header(self) -> None:
        header = tk.Frame(self.root, bg=BG)
        header.pack(fill="x", padx=16, pady=(14, 8))
        tk.Label(
            header,
            text="Comfy-APP 开发工具箱",
            bg=BG,
            fg=VIOLET,
            font=("Microsoft YaHei UI", 16, "bold"),
        ).pack(side="left")
        tk.Label(
            header,
            text="点按钮执行常用命令，下方实时查看输出",
            bg=BG,
            fg=MUTED,
            font=("Microsoft YaHei UI", 10),
        ).pack(side="left", padx=12)

    def _build_button_grid(self) -> None:
        frame = tk.Frame(self.root, bg=BG)
        frame.pack(fill="x", padx=16, pady=(0, 8))
        cols = 3
        for idx, tool in enumerate(TOOLS):
            row, col = divmod(idx, cols)
            btn = tk.Button(
                frame,
                text=tool.name,
                command=lambda t=tool: self._run_tool(t),
                bg=PANEL,
                fg=INK,
                activebackground="#26262e",
                activeforeground=INK,
                bd=1,
                relief="solid",
                highlightbackground=BORDER,
                font=("Microsoft YaHei UI", 11),
                cursor="hand2",
                pady=10,
                wraplength=200,
                justify="center",
            )
            btn.grid(row=row, column=col, padx=5, pady=5, sticky="nsew")
            # 悬停提示
            self._bind_hover(btn)
            ToolTip(btn, tool.desc or tool.name)
        for c in range(cols):
            frame.columnconfigure(c, weight=1)

    def _build_console(self) -> None:
        console_frame = tk.Frame(self.root, bg=BG)
        console_frame.pack(fill="both", expand=True, padx=16, pady=(0, 8))
        self.output = scrolledtext.ScrolledText(
            console_frame,
            bg="#0d0d12",
            fg="#d4d4d8",
            insertbackground=INK,
            font=("Consolas", "10"),
            relief="flat",
            borderwidth=1,
            highlightbackground=BORDER,
            state="disabled",
            wrap="word",
        )
        self.output.pack(fill="both", expand=True)

    def _build_statusbar(self) -> None:
        bar = tk.Frame(self.root, bg=PANEL, height=40)
        bar.pack(fill="x", side="bottom")
        bar.pack_propagate(False)

        self.status_var = tk.StringVar(value="就绪")
        tk.Label(
            bar,
            textvariable=self.status_var,
            bg=PANEL,
            fg=MUTED,
            anchor="w",
            font=("Microsoft YaHei UI", 10),
        ).pack(side="left", padx=14)

        tk.Button(
            bar,
            text="打开项目目录",
            command=lambda: self._run_tool(
                Tool("打开项目目录", "explorer", self.root_dir)
            ),
            bg="#1f1f29",
            fg=INK,
            activebackground="#2a2a36",
            bd=0,
            font=("Microsoft YaHei UI", 10),
            padx=10,
            pady=4,
            cursor="hand2",
        ).pack(side="right", padx=(0, 6))

        self.stop_btn = tk.Button(
            bar,
            text="停止",
            command=self._stop,
            bg="#3a1f24",
            fg="#ff9aa6",
            activebackground="#4a262c",
            bd=0,
            font=("Microsoft YaHei UI", 10, "bold"),
            padx=14,
            pady=4,
            cursor="hand2",
            state="disabled",
        )
        self.stop_btn.pack(side="right", padx=(0, 6))

        tk.Button(
            bar,
            text="清空",
            command=self._clear,
            bg="#1f1f29",
            fg=INK,
            activebackground="#2a2a36",
            bd=0,
            font=("Microsoft YaHei UI", 10),
            padx=10,
            pady=4,
            cursor="hand2",
        ).pack(side="right", padx=(0, 12))

    # ── 执行 ──
    def _run_tool(self, tool: Tool) -> None:
        if self.running_proc is not None:
            self._log("\n[跳过] 已有进程在运行，请先点「停止」。\n")
            return

        cmd = self._build_cmd(tool)
        if cmd is None:
            return

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=self.root_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception as exc:  # noqa: BLE001
            self._log(f"\n[错误] 无法启动命令：{exc}\n")
            return

        self.running_proc = proc
        self.stop_btn.configure(state="normal")
        if tool.long_running:
            self._log(f"\n▶ 启动「{tool.name}」（PID {proc.pid}），点「停止」结束：\n")
        else:
            self._log(f"\n▶ 执行「{tool.name}」…\n")
        self._set_status(f"运行中：{tool.name}", busy=True)

        threading.Thread(target=self._pump, args=(proc, tool), daemon=True).start()

    def _pump(self, proc: "subprocess.Popen[str]", tool: Tool) -> None:
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                self._log(line)
        except Exception:  # noqa: BLE001
            pass
        finally:
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
            self.running_proc = None
            self.root.after(0, lambda: self.stop_btn.configure(state="disabled"))
            self._set_status("就绪")
            self._log(f"\n■ 「{tool.name}」已结束（退出码 {proc.returncode}）。\n")

    def _stop(self) -> None:
        proc = self.running_proc
        if proc is None:
            return
        self._log("\n[停止] 正在终止进程…\n")
        try:
            # 先优雅终止；失败则强制。dev-launcher.ps1 用 Job Object 托管子进程，
            # pwsh 退出后整棵进程树会随之清理。
            proc.terminate()
        except Exception:  # noqa: BLE001
            try:
                proc.kill()
            except Exception:
                pass

    # ── 辅助 ──
    def _build_cmd(self, tool: Tool) -> Optional[list[str]]:
        if tool.kind == "explorer":
            return ["explorer", tool.script]
        if tool.kind == "node":
            if not self._node:
                self._log("[错误] 未找到 node，请先安装 Node.js。\n")
                return None
            return [self._node, tool.script, *tool.args]
        if tool.kind == "pwsh":
            if not self._pwsh:
                self._log("[错误] 未找到 pwsh / powershell，无法运行该命令。\n")
                return None
            return [
                self._pwsh,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                tool.script,
                *tool.args,
            ]
        return None

    @staticmethod
    def _resolve(*names: str) -> Optional[str]:
        for name in names:
            found = shutil_which(name)
            if found:
                return found
        return None

    def _log(self, text: str) -> None:
        self.root.after(0, self._do_log, text)

    def _do_log(self, text: str) -> None:
        self.output.configure(state="normal")
        self.output.insert("end", text)
        self.output.see("end")
        self.output.configure(state="disabled")

    def _clear(self) -> None:
        self.output.configure(state="normal")
        self.output.delete("1.0", "end")
        self.output.configure(state="disabled")

    def _set_status(self, text: str, busy: bool = False) -> None:
        self.status_var.set(text)
        color = VIOLET if busy else MUTED
        # Label 没有好改色的简单 API，保持静默；状态文字已足够清晰。
        _ = color

    def _on_close(self) -> None:
        if self.running_proc is not None:
            try:
                self.running_proc.kill()
            except Exception:
                pass
        self.root.destroy()

    @staticmethod
    def _bind_hover(widget: tk.Widget) -> None:
        enter = widget.cget("background")

        def on_enter(_e):
            widget.configure(background="#1f1f29")

        def on_leave(_e):
            widget.configure(background=enter)

        widget.bind("<Enter>", on_enter)
        widget.bind("<Leave>", on_leave)


def shutil_which(name: str) -> Optional[str]:
    from shutil import which

    return which(name)


# ═══════════════════════════════════════════════════════════════════════════════
#  简易 ToolTip（tkinter 无内置，手搓一个轻量版）
# ═══════════════════════════════════════════════════════════════════════════════
class ToolTip:
    def __init__(self, widget: tk.Widget, text: str, delay: int = 400) -> None:
        self.widget = widget
        self.text = text
        self.delay = delay
        self._after_id: Optional[str] = None
        self._tip: Optional[tk.Toplevel] = None
        widget.bind("<Enter>", self._schedule)
        widget.bind("<Leave>", self._hide)
        widget.bind("<ButtonPress>", self._hide)

    def _schedule(self, _e=None) -> None:
        self._after_id = self.widget.after(self.delay, self._show)

    def _show(self) -> None:
        if self._tip or not self.text:
            return
        x = self.widget.winfo_rootx() + 12
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 4
        tip = tk.Toplevel(self.widget)
        tip.wm_overrideredirect(True)
        tip.wm_geometry(f"+{x}+{y}")
        tip.configure(bg="#1a1a24", borderwidth=1, relief="solid")
        tk.Label(
            tip,
            text=self.text,
            bg="#1a1a24",
            fg="#ededf2",
            font=("Microsoft YaHei UI", 9),
            wraplength=260,
            justify="left",
            padx=8,
            pady=5,
        ).pack()
        self._tip = tip

    def _hide(self, _e=None) -> None:
        if self._after_id:
            self.widget.after_cancel(self._after_id)
            self._after_id = None
        if self._tip:
            self._tip.destroy()
            self._tip = None


def main() -> None:
    root = tk.Tk()
    try:
        # 高 DPI 适配，避免模糊
        from ctypes import windll  # type: ignore

        windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    DevToolsLauncher(root, detect_root())
    root.mainloop()


if __name__ == "__main__":
    main()
