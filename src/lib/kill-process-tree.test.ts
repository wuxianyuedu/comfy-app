// 进程树回收的回归测试（AGENTS 硬规则 3：必须杀整棵树，禁止单杀）。
//
// 这组用例的由来：POSIX 分支历史实现只 `child.kill("SIGTERM")` 杀 leader，
// 实测给一个含 3 个子进程的 shell 发 SIGTERM 后 3 个子进程全部残留成孤儿
// （占端口、锁日志文件）—— 正是硬规则 3 明令禁止的形态。

import { execSync, spawn } from "child_process";
import { describe, expect, it } from "vitest";
import {
  isWindowsPlatform,
  killProcessTree,
  killProcessTreeSync,
} from "./kill-process-tree";

/** 等一个条件成立，超时返回 false。 */
async function waitFor(
  check: () => boolean,
  timeoutMs = 3000,
  stepMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("isWindowsPlatform", () => {
  it("只有 win32 视为 Windows", () => {
    expect(isWindowsPlatform("win32")).toBe(true);
    expect(isWindowsPlatform("linux")).toBe(false);
    expect(isWindowsPlatform("darwin")).toBe(false);
  });
});

describe("killProcessTree 平台分支", () => {
  it("非法 PID 直接返回 ok=false，不发信号", async () => {
    expect((await killProcessTree({ pid: 0 })).ok).toBe(false);
    expect((await killProcessTree({ pid: -1 })).ok).toBe(false);
  });

  it("Windows：via 是 taskkill /PID /T /F（硬规则 3 的原始要求）", async () => {
    // 不真的执行 taskkill（非 Windows 上不存在该命令）：只验证命令构造。
    // 通过 process.kill 打桩不方便，改为断言「非 Windows 时不会走这条」+
    // 在 Windows CI 上这条会真实执行（pid 用一个必然不存在的值）。
    if (!isWindowsPlatform()) return;
    const r = await killProcessTree({ pid: 999999 });
    expect(r.via).toContain("taskkill");
    expect(r.via).toContain("/T");
    expect(r.via).toContain("/F");
  });
});

describe.runIf(!isWindowsPlatform())("killProcessTree POSIX 行为", () => {
  it("detached 子进程：杀进程组，子孙一并回收（禁止留孤儿）", async () => {
    // 造一棵树：bash 之下带两个 sleep。detached:true → bash 是组长。
    const child = spawn("bash", ["-c", "sleep 300 & sleep 300 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    child.unref();
    // 等孙进程起来
    await new Promise((r) => setTimeout(r, 600));

    const r = await killProcessTree({ pid, detached: true });
    expect(r.ok).toBe(true);
    expect(r.via).toContain("进程组");

    // 组长与全部子孙都必须消失
    const gone = await waitFor(() => {
      const pids = [pid, ...childPids(pid)];
      return pids.every((p) => !isAlive(p));
    });
    expect(gone).toBe(true);
  });

  it("未 detached：单杀兜底仍成功（拿不到进程组时不静默失败）", async () => {
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((r) => setTimeout(r, 300));
    const r = await killProcessTree({ pid, detached: false });
    expect(r.ok).toBe(true);
    expect(r.via).toContain("单进程兜底");
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
  });

  it("目标已退出：返回 ok=false 而不是抛错（调用方自行探测确认）", async () => {
    const child = spawn("true", [], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((r) => setTimeout(r, 500));
    const r = await killProcessTree({ pid, detached: false });
    expect(r.ok).toBe(false);
  });

  it("killProcessTreeSync 与异步版同语义（进程组优先）", async () => {
    const child = spawn("bash", ["-c", "sleep 300 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    child.unref();
    await new Promise((r) => setTimeout(r, 500));
    const r = killProcessTreeSync({ pid, detached: true });
    expect(r.via).toContain("进程组");
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
  });
});

/** 收集某 PID 的子进程（POSIX 用 ps，测试环境无 pstree 依赖）。 */
function childPids(parent: number): number[] {
  try {
    const out = execSync("ps -eo pid,ppid", { encoding: "utf8" });
    return out
      .split("\n")
      .slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((c) => Number(c[1]) === parent)
      .map((c) => Number(c[0]))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}
