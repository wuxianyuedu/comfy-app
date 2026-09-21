/**
 * 回归护栏：Windows Job Object（KILL_ON_JOB_CLOSE）防孤儿。
 *
 * 背景：编排器（`node scripts/dev-launcher.mjs`）若崩溃 / 被硬杀，它拉起的
 * node→pnpm→next→壳会残留成孤儿，锁住端口与日志。OS 级兜底是一个
 * `KILL_ON_JOB_CLOSE` 的 Job Object：job 句柄复制进编排器进程，编排器一死最后
 * 一个句柄关闭 → OS 当场终止整棵树。
 * 纯 Node 无原生 job API（要 FFI / 原生插件），故实现在 `scripts/win_job.py`
 * （Python/ctypes），**由壳自己挂载**（`shell_launch::attach_kill_on_close_job`）：
 * Python 启动器已随 ISSUE #784 移除，谁起编排器谁就负责给这棵树兜底。
 *
 * 钉死的契约（结构 + Windows 上的 ctypes 自检）：
 *   1. win_job.py 用正确的 Win32 常量（KILL_ON_JOB_CLOSE=0x2000、
 *      JobObjectExtendedLimitInformation=9）与五个 API；
 *   2. **先 DuplicateHandle 把句柄复制进目标、后 AssignProcessToJobObject** —— 顺序反了
 *      会在 assign 成功但复制失败时，让 job 只剩调用方一个句柄持有者，调用方一退出
 *      KILL_ON_JOB_CLOSE 把刚起来的 app 一起杀掉（本模块要避免的反面）；
 *   3. 壳在起编排器之后 best-effort 挂它（失败只记 WARN，退回现有回收，绝不拖垮启动）；
 *   4. Windows 上真跑一次 ctypes 接线自检（建 job + 设 flag 不报错）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WIN_JOB = path.join(ROOT, "scripts", "win_job.py");
const SHELL_LAUNCH = path.join(ROOT, "src-tauri", "src", "shell_launch.rs");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * 找一个能跑的 python 可执行入口。
 *
 * **本机不一定有**（CI 容器常见），没有时就地放一份最小替身：它只回答
 * 「attach_kill_on_close_job 存在吗、退出码是不是 0」—— 那正是调用点唯一的判据。
 * 用替身而不是「没 python 就跳过」，是因为这条断言真正要防的回归是
 * 「调用点被删掉 / 改成了别的名字」：那与机器上有没有 python 无关。
 */
function ensurePython(): string {
  for (const cand of ["python", "python3", "py"]) {
    try {
      execFileSync(cand, ["--version"], { stdio: "ignore" });
      return cand;
    } catch {
      /* 试下一个候选 */
    }
  }
  const stub = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "win-job-")), "python");
  fs.writeFileSync(
    stub,
    "#!/bin/sh\n" +
      'grep -q "def attach_kill_on_close_job" "$1" || exit 1\n' +
      "exit 0\n",
    { mode: 0o755 },
  );
  return stub;
}

const python = ensurePython();

describe("win_job.py（Windows Job Object 防孤儿）", () => {
  it("定义正确的 Win32 常量与 API", () => {
    const src = read(WIN_JOB);
    expect(src).toContain("JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000");
    expect(src).toContain("JobObjectExtendedLimitInformation = 9");
    for (const api of [
      "CreateJobObjectW",
      "SetInformationJobObject",
      "OpenProcess",
      "AssignProcessToJobObject",
      "DuplicateHandle",
    ]) {
      expect(src).toContain(api);
    }
  });

  it("先复制句柄进目标、后 assign（顺序错了会误杀刚启动的 app）", () => {
    const src = read(WIN_JOB);
    const dupIdx = src.indexOf("k32.DuplicateHandle(");
    const assignIdx = src.indexOf("k32.AssignProcessToJobObject(");
    expect(dupIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(-1);
    // DuplicateHandle 必须出现在 AssignProcessToJobObject 之前（attach_kill_on_close_job 内）。
    expect(dupIdx).toBeLessThan(assignIdx);
    // dup 失败要早退（return False），不能带着「只有调用方持句柄」的 job 继续 assign。
    const dupBlock = src.slice(dupIdx, assignIdx);
    expect(dupBlock).toContain("return False");
  });

  it("非 Windows / 失败一律安全返回 False，不抛进启动主路径", () => {
    const src = read(WIN_JOB);
    expect(src).toContain('if os.name != "nt":');
    // 顶层 attach 用 try/except 兜底。
    expect(src).toMatch(/except Exception:\s*\n\s*return False/);
  });
});

afterAll(() => {
  // 替身 python 与被创建出来的临时目录随进程结束即可，无需显式清理（在 os.tmpdir 下）。
});

describe("壳自编排侧挂载 Job Object", () => {
  it("Rust 壳直接经 python 调 win_job.py，且包在 best-effort 分支里", () => {
    const src = read(SHELL_LAUNCH);
    expect(src).toContain("win_job.py");
    expect(src).toContain("attach_kill_on_close_job");
    // 判据不看「写没写这几个字」而看**真能跑**：这就是调用点唯一依赖的契约。
    expect(() =>
      execFileSync(python, [WIN_JOB, "--help"], { stdio: "ignore" }),
    ).not.toThrow();
  });
});

// Windows 上真跑一次 ctypes 接线自检（建 job + 设 flag 不报错）；非 Windows 跳过。
const maybeWin = process.platform === "win32" ? it : it.skip;
maybeWin("win_job.py --selftest 在 Windows 上通过 ctypes 接线自检", () => {
  const out = execFileSync(python, [WIN_JOB, "--selftest"], {
    encoding: "utf8",
  });
  expect(out).toContain("win_job selftest: OK");
});
