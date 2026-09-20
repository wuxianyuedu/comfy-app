#!/usr/bin/env python3
"""Windows Job Object（KILL_ON_JOB_CLOSE）辅助。

把**已启动**的编排器进程（node / dev-launcher.mjs）纳入一个「最后一个句柄关闭即整树
终止」的 Job Object，并把该 job 的句柄复制进编排器进程，让编排器自己决定 job 的生死。

为什么在 Python 侧而不是 Node：Job Object 是 Win32 内核对象，纯 Node 无原生 API（要
FFI / 原生插件，而 ctypes 打 Win32 这条路本项目已经在走）；规范 §3.3「平台机制」层里，
Windows 的 job 归这一处。**调用方是 Rust 壳**（`src-tauri/src/shell_launch.rs` 在起完
编排器后 best-effort 挂载）：谁起编排器谁就负责给这棵树兜底 —— Python 启动器已随
ISSUE #784 移除，编排器现在是壳的子进程。

机制（关键约束：挂上 job 之后**壳自己**不能成为唯一句柄持有者）：
  1. CreateJobObjectW 建 job；
  2. SetInformationJobObject(JobObjectBasicLimitInformation,
     LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)；
  3. OpenProcess(目标 pid)；
  4. **先** DuplicateHandle 把 job 句柄复制一份进目标进程（目标全程持有它）；
  5. **再** AssignProcessToJobObject 把目标纳入 job（目标后续子进程自动继承成员身份）；
  6. 本进程退出 → 自己那份句柄关闭，但目标复制的那份仍在 → job 不死、那棵树继续；
  7. 目标（node 编排器）崩溃 / 被杀 → 它那份句柄关闭 → 最后一个句柄 → OS 当场终止整棵
     job（node → pnpm → next → 桌面壳），杜绝孤儿。

顺序为什么是「先复制句柄、后 assign」：若 assign 成功而复制句柄失败，job 里就只剩本进程
一个句柄持有者，本进程一退出 KILL_ON_JOB_CLOSE 会把刚起来的应用一起杀掉（正是本模块要
避免的反面）。先复制、后 assign，则任一步失败时目标要么根本没进 job、要么进的是一个没有
成员的空 job（无害），行为退回现状。

任何一步失败都返回 False（调用方保持现有回收路径），绝不抛进启动主路径。
"""

import ctypes
import os
import sys

# ── 类型（Python 3.13 精简了 ctypes.wintypes，这里全部用 ctypes 原生类型自足定义）──
HANDLE = ctypes.c_void_p
BOOL = ctypes.c_int
DWORD = ctypes.c_uint32
SIZE_T = ctypes.c_size_t
ULONG_PTR = ctypes.c_size_t
LARGE_INTEGER = ctypes.c_int64

# ── Win32 常量 ────────────────────────────────────────────────────────────────
# KILL_ON_JOB_CLOSE 只能经 JobObjectExtendedLimitInformation(9) 设置成功；
# 真机验证 JobObjectBasicLimitInformation(2) 会返回 ERROR_INVALID_PARAMETER(87)。
JobObjectExtendedLimitInformation = 9
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000

PROCESS_TERMINATE = 0x0001
PROCESS_SET_QUOTA = 0x0100
PROCESS_DUP_HANDLE = 0x0040

DUPLICATE_SAME_ACCESS = 0x0002

_INVALID_HANDLE = ctypes.c_void_p(-1).value


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", LARGE_INTEGER),
        ("PerJobUserTimeLimit", LARGE_INTEGER),
        ("LimitFlags", DWORD),
        ("MinimumWorkingSetSize", SIZE_T),
        ("MaximumWorkingSetSize", SIZE_T),
        ("ActiveProcessLimit", DWORD),
        ("Affinity", ULONG_PTR),
        ("PriorityClass", DWORD),
        ("SchedulingClass", DWORD),
    ]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_uint64),
        ("WriteOperationCount", ctypes.c_uint64),
        ("OtherOperationCount", ctypes.c_uint64),
        ("ReadTransferCount", ctypes.c_uint64),
        ("WriteTransferCount", ctypes.c_uint64),
        ("OtherTransferCount", ctypes.c_uint64),
    ]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", SIZE_T),
        ("JobMemoryLimit", SIZE_T),
        ("PeakProcessMemoryUsed", SIZE_T),
        ("PeakJobMemoryUsed", SIZE_T),
    ]


# 启动器进程存活期间持有的 job 句柄（进程退出时由 OS 回收；不提前关闭，
# 否则会在目标尚未持有句柄前触发 KILL_ON_JOB_CLOSE）。
_JOB_HANDLE = None


def _configure_prototypes(k32):
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
    k32.CreateJobObjectW.restype = HANDLE
    k32.SetInformationJobObject.argtypes = [HANDLE, ctypes.c_int, ctypes.c_void_p, DWORD]
    k32.SetInformationJobObject.restype = BOOL
    k32.OpenProcess.argtypes = [DWORD, BOOL, DWORD]
    k32.OpenProcess.restype = HANDLE
    k32.AssignProcessToJobObject.argtypes = [HANDLE, HANDLE]
    k32.AssignProcessToJobObject.restype = BOOL
    k32.DuplicateHandle.argtypes = [
        HANDLE, HANDLE, HANDLE, ctypes.POINTER(HANDLE),
        DWORD, BOOL, DWORD,
    ]
    k32.DuplicateHandle.restype = BOOL
    k32.GetCurrentProcess.restype = HANDLE
    k32.CloseHandle.argtypes = [HANDLE]
    k32.CloseHandle.restype = BOOL


def attach_kill_on_close_job(pid):
    """把已启动的 `pid` 纳入一个 KILL_ON_JOB_CLOSE 的 job，并让该进程持有 job 句柄。

    返回 True = 成功（该进程崩溃 / 被杀时，其整棵子进程树会被 OS 回收）；
    返回 False = 未启用（非 Windows、API 失败、权限不足），调用方应保持现有回收路径。
    本函数不抛异常进启动主路径。
    """
    global _JOB_HANDLE
    if os.name != "nt":
        return False
    if not pid or pid <= 0:
        return False
    try:
        k32 = ctypes.windll.kernel32
        _configure_prototypes(k32)

        hjob = k32.CreateJobObjectW(None, None)
        if not hjob or hjob == _INVALID_HANDLE:
            return False

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        set_ok = k32.SetInformationJobObject(
            hjob,
            JobObjectExtendedLimitInformation,
            ctypes.byref(info),
            DWORD(ctypes.sizeof(info)),
        )
        if not set_ok:
            k32.CloseHandle(hjob)
            return False

        hproc = k32.OpenProcess(
            PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_DUP_HANDLE, False, DWORD(pid)
        )
        if not hproc or hproc == _INVALID_HANDLE:
            k32.CloseHandle(hjob)
            return False

        # 先把 job 句柄复制进目标进程（目标全程持有），再 assign —— 见模块 docstring 的顺序说明。
        cur = k32.GetCurrentProcess()
        h_dup = HANDLE()
        dup_ok = k32.DuplicateHandle(
            cur, hjob, hproc, ctypes.byref(h_dup), 0, True, DUPLICATE_SAME_ACCESS
        )
        if not dup_ok:
            k32.CloseHandle(hproc)
            k32.CloseHandle(hjob)
            return False

        assign_ok = k32.AssignProcessToJobObject(hjob, hproc)
        k32.CloseHandle(hproc)
        if not assign_ok:
            # 目标持有一个「无成员的空 job」句柄，无害；启动器退出时空 job 随之销毁。
            k32.CloseHandle(hjob)
            return False

        # 成功：保留启动器这一侧的句柄直到进程退出（目标已另有一份）。
        _JOB_HANDLE = hjob
        return True
    except Exception:
        return False


def _selftest():
    """在真机上验证 ctypes 接线（建 job + 设 flag）不报错；不针对具体目标进程。

    用法：python scripts/win_job.py --selftest  （非 Windows 上跳过并返回 0）
    """
    if os.name != "nt":
        print("win_job selftest: skipped (not Windows)")
        return 0
    try:
        k32 = ctypes.windll.kernel32
        _configure_prototypes(k32)
        hjob = k32.CreateJobObjectW(None, None)
        if not hjob or hjob == _INVALID_HANDLE:
            print("win_job selftest: FAIL CreateJobObjectW")
            return 1
        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        ok = k32.SetInformationJobObject(
            hjob,
            JobObjectExtendedLimitInformation,
            ctypes.byref(info),
            DWORD(ctypes.sizeof(info)),
        )
        k32.CloseHandle(hjob)
        print("win_job selftest:", "OK" if ok else "FAIL SetInformationJobObject")
        print("  sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION) =", ctypes.sizeof(info))
        return 0 if ok else 1
    except Exception as exc:
        print(f"win_job selftest: ERROR {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
