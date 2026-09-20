/**
 * 回归护栏：Windows Job Object（KILL_ON_JOB_CLOSE）防孤儿。
 *
 * 背景：启动器（start_tauri_launcher.py）用 DETACHED_PROCESS 让编排器（node）在
 * 启动器交班退出后继续存活（规范 §1 分层边界）。但编排器自己崩溃 / 被硬杀时，它拉起
 * 的 node→pnpm→next→壳会残留成孤儿，锁住 `start-tauri\_internal\*.dll`，正是
 * build-launcher 前置检查报的那类占用。此前「Job Object」在文档与进度条里被**当作已
 * 存在**（`launcher-core/job-object.mjs` 幽灵引用 + 「创建 Windows Job Object」进度步），
 * 实现为零。本 PR 把它真正做进 `scripts/win_job.py`（Python/ctypes，Node 无原生 job API）。
 *
 * 钉死的契约（结构 + Windows 上的 ctypes 自检）：
 *   1. win_job.py 用正确的 Win32 常量（KILL_ON_JOB_CLOSE=0x2000、
 *      JobObjectBasicLimitInformation=2）与五个 API；
 *   2. **先 DuplicateHandle 把句柄复制进目标、后 AssignProcessToJobObject** —— 顺序反了
 *      会在 assign 成功但复制失败时，让 job 只剩启动器一个句柄持有者，启动器一退出
 *      KILL_ON_JOB_CLOSE 把刚起来的 app 一起杀掉（本模块要避免的反面）；
 *   3. 启动器在 Popen 之后 best-effort 调 attach_kill_on_close_job，且包在 try 里
 *      （失败退回现有回收，绝不拖垮启动）；
 *   4. Windows 上真跑一次 ctypes 接线自检（建 job + 设 flag 不报错）。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const WIN_JOB = path.join(ROOT, "scripts", "win_job.py");
const LAUNCHER = path.join(ROOT, "scripts", "start_tauri_launcher.py");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

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
    // dup 失败要早退（return False），不能带着「只有启动器持句柄」的 job 继续 assign。
    const dupBlock = src.slice(dupIdx, assignIdx);
    expect(dupBlock).toContain("return False");
  });

  it("非 Windows / 失败一律安全返回 False，不抛进启动主路径", () => {
    const src = read(WIN_JOB);
    expect(src).toContain("if os.name != \"nt\":");
    // 顶层 attach 用 try/except 兜底。
    expect(src).toMatch(/except Exception:\s*\n\s*return False/);
  });
});

describe("start_tauri_launcher.py 挂载 Job Object", () => {
  it("Popen 之后 best-effort attach，且包在 try 里", () => {
    const src = read(LAUNCHER);
    const popenIdx = src.indexOf("proc = subprocess.Popen(");
    const attachIdx = src.indexOf("attach_kill_on_close_job(proc.pid)");
    expect(popenIdx).toBeGreaterThan(-1);
    expect(attachIdx).toBeGreaterThan(-1);
    // attach 必须在 Popen 之后（先有 pid 才能挂 job）。
    expect(attachIdx).toBeGreaterThan(popenIdx);
    // best-effort：attach 调用点附近有 try/except，失败退回现有回收。
    const around = src.slice(attachIdx - 200, attachIdx + 400);
    expect(around).toContain("try:");
    expect(around).toMatch(/except Exception/);
  });
});

// Windows 上真跑一次 ctypes 接线自检（建 job + 设 flag 不报错）；非 Windows 跳过。
const maybeWin = process.platform === "win32" ? it : it.skip;
maybeWin("win_job.py --selftest 在 Windows 上通过 ctypes 接线自检", () => {
  let python: string | null = null;
  for (const cand of ["python", "py", "python3"]) {
    try {
      execFileSync(cand, ["--version"], { stdio: "ignore" });
      python = cand;
      break;
    } catch {
      /* try next */
    }
  }
  if (!python) {
    // 本机没 python 可执行入口（打包环境常见）——结构断言已覆盖，跳过执行自检。
    return;
  }
  const out = execFileSync(python, [WIN_JOB, "--selftest"], {
    encoding: "utf8",
  });
  expect(out).toContain("win_job selftest: OK");
});
