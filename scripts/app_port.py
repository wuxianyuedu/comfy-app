# -*- coding: utf-8 -*-
"""应用端口解析的唯一事实源（Python 侧），与 Node / PowerShell / Rust 侧
（scripts/app-port.mjs、scripts/app-port.ps1、src-tauri/src/single_instance.rs）
是同一算法的多语言实现，改动必须四处同步（launch-and-build.md §1.1 / §1.4）。

抽取成独立模块的原因（ISSUE #489 缺陷 4）：算法原先内联在一个**只能在 Windows 上
导入**的宿主里（顶层直接取 ctypes.windll / WINFUNCTYPE，那个宿主已随 ISSUE #784
移除）。于是「四语言端口一致性」没法在 Linux / CI 上被验证 —— 只能靠人工读代码。
抽出来后 Node 侧测试可经 `scripts/check-app-port-vectors.py` 拉起本模块，
读**同一份**共享校验向量（tests/fixtures/app-port-vectors.json）做断言。

取值优先级（**四语言实现必须逐条一致**，见 launch-and-build.md §1.1）：
  1. .env 显式 COMFYAPP_PORT（每个检出各自的 .env，要固定端口时配置）；
  2. 按检出绝对路径稳定推导——同一检出恒定同端口，多份检出并行互不冲突；
  3. 兜底 3100（仅在路径推导不可用的异常情况）。

ISSUE #821：「.env 里写死端口」这条对**每一侧**都要生效 —— 壳不经过 Node，
如果只有 Node 读了 .env，壳就会按路径推导出另一个端口并死等，两边永远对不上
（现象是启动页卡在「等 dev server」，而 dev server 其实在另一个端口上跑着）。
"""

from __future__ import annotations

import os
import re

FALLBACK_PORT = 3100
DERIVED_PORT_BASE = 3200
DERIVED_PORT_SPAN = 800


def fnv1a32(data: bytes) -> int:
    """FNV-1a 32 位哈希（与 scripts/app-port.mjs 等多语言实现按字节对齐）。"""
    h = 0x811C9DC5
    for b in data:
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def normalize_root_for_port(project_root: str) -> str:
    """规范化检出路径：转正斜杠 + 转小写 + 去尾斜杠（跨四语言约定，§1.1）。

    只对**相对路径**做 abspath。历史实现无条件 `os.path.abspath()`，而它的
    语义是「相对当前工作目录解析」——同一个检出在不同 cwd 下推出不同端口，
    与「同一检出恒定同端口」的多检出并行承诺矛盾（Node 侧同病，见
    scripts/app-port.mjs 的 normalizeRootForPort）。

    「根锚定」（前导分隔符）必须显式算绝对路径，不能只靠 `os.path.isabs`：
    Python 3.13 起 `ntpath.isabs()` 对「只有根、没有盘符」的路径返回 False
    （`os.path.isabs('/workspace')` → False），这类输入于是掉进 abspath 分支
    被拼上当前盘符（`f:/workspace`）—— 而 Node 的 `path.isAbsolute`、
    PowerShell 的 `IsPathRooted`、Rust 的原样处理都给出 `/workspace`，
    四侧对同一输入端口不一致（§1.1 要求逐字节一致）。这条判据与它们同义，
    且不随 Python 版本变化。
    """
    raw = project_root or ""
    rooted = raw.startswith("/") or raw.startswith("\\")
    win_absolute = bool(re.match(r"^[a-zA-Z]:[\\/]", raw))
    absolute = rooted or win_absolute or os.path.isabs(raw)
    resolved = raw if absolute else os.path.abspath(raw)
    return resolved.replace("\\", "/").lower().rstrip("/")


def derive_app_port(project_root: str) -> int:
    """按检出绝对路径稳定推导端口（多检出并行互不冲突，§1.4）。"""
    normalized = normalize_root_for_port(project_root)
    return DERIVED_PORT_BASE + (fnv1a32(normalized.encode("utf-8")) % DERIVED_PORT_SPAN)


def read_env_port(project_root: str) -> "int | None":
    """读 .env 的 COMFYAPP_PORT；未配置 / 非法 / 文件缺失时返回 None。

    形态与另三侧实现严格对齐（Node readEnvFileValue / PowerShell
    Get-DotEnvAppPort / Rust read_dot_env_value，ISSUE #821）：行首允许空白、
    值去掉成对引号与行尾注释（`# 固定端口` 这写法在 dotenv 里很常见）、
    只取第一个匹配行 —— 四侧对同一份 .env 必须读出同一个值，否则「同一处
    配置、两边端口一致」这条承诺又是文档承诺而非可失败断言。
    """
    try:
        env_path = os.path.join(project_root, ".env")
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\r\n")
                if line.strip().startswith("#"):
                    continue
                m = re.match(r"^\s*COMFYAPP_PORT\s*=\s*(.*)$", line)
                if not m:
                    continue
                val = re.split(r"\s+#", m.group(1))[0].strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                    val = val[1:-1]
                port = int(val)
                if 1 <= port <= 65535:
                    return port
    except (OSError, ValueError):
        pass
    return None


def resolve_app_port(project_root: str) -> int:
    """最终端口：.env 显式值优先，否则按检出路径推导，异常时兜底。"""
    from_env = read_env_port(project_root)
    if from_env is not None:
        return from_env
    try:
        return derive_app_port(project_root)
    except Exception:
        return FALLBACK_PORT
