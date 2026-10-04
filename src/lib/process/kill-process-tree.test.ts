// 进程树回收的回归测试（AGENTS 硬规则 3：必须杀整棵树，禁止单杀）。
//
// 这组用例的由来有三层，每层都对应一次实测事故：
//   ① 最早 POSIX 分支只 `child.kill("SIGTERM")` 杀 leader，实测给一个含
//      3 个子进程的 shell 发 SIGTERM 后全部残留成孤儿（占端口、锁日志）；
//   ② 收口到本模块后，实现按 `detached` 布尔值直接 `kill(-pid)`，隐含假设
//      「spawn 出来的子进程就是组长」。但经 `sh -c` / `pnpm exec` 两层中转后
//      组长是更上层的 shell，`kill(-2866)` 抛 ESRCH 静默落回单杀 —— 实测
//      `pnpm dev` 真实进程树（PID 2866 / PGID 2838）留下 5 个孤儿；
//   ③ 改为「运行时读 PGID」后，若不加自身组判据，`kill(-pgid)` 会打到
//      **调用者自己的进程组**（bound 模式子进程与父同组，实测 vitest worker
//      被自己派发的信号 Killed）—— 这是比「留孤儿」更严重的「自杀」。
//
// 因此用例分三条线：真起多进程树数残留（① ②）、验证同组禁用组路径（③）、
// 以及 via 描述只作为辅助断言，不作为唯一证据 —— 「只检查命令构造」正是让
// 第 ② 类缺陷漏过去的原因（`via` 报的 `kill -SIGTERM -2866（进程组）` 看着
// 完全正确，实际根本没杀到）。

import { execSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isWindowsPlatform,
  killProcessTree,
  killProcessTreeSync,
  readPgid,
} from "./kill-process-tree";

/** 等一个条件成立，超时返回 false。 */
async function waitFor(
  check: () => boolean,
  timeoutMs = 4000,
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

/** 递归收集某 PID 的整棵子孙树（ppid 邻接表，不依赖 pstree）。 */
function descendantPids(root: number): number[] {
  let out: string;
  try {
    out = execSync("ps -eo pid,ppid", { encoding: "utf8" });
  } catch {
    return [];
  }
  const byParent = new Map<number, number[]>();
  for (const line of out.split("\n").slice(1)) {
    const [pidStr, ppidStr] = line.trim().split(/\s+/);
    const pid = Number(pidStr);
    const ppid = Number(ppidStr);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const arr = byParent.get(ppid) ?? [];
    arr.push(pid);
    byParent.set(ppid, arr);
  }
  const acc: number[] = [];
  const stack = [...(byParent.get(root) ?? [])];
  while (stack.length) {
    const p = stack.pop()!;
    if (acc.includes(p)) continue;
    acc.push(p);
    stack.push(...(byParent.get(p) ?? []));
  }
  return acc;
}

function pgidOf(pid: number): number | null {
  try {
    const out = execSync(`ps -o pgid= -p ${pid}`, { encoding: "utf8" });
    const n = Number.parseInt(out.trim(), 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
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
    // 真跑（含「命令确实发出去了」）见 kill-process-tree.windows.test.ts ——
    // 那里注入一个同名假 taskkill，把 Windows 分支在本机完整跑一遍。
    // 这条只做平台判据的冒烟：非 Windows 上不该走 taskkill 分支。
    if (!isWindowsPlatform()) {
      const r = await killProcessTree({ pid: 999999 });
      expect(r.via).not.toContain("taskkill");
      return;
    }
    const r = await killProcessTree({ pid: 999999 });
    expect(r.via).toContain("/T");
    expect(r.via).toContain("/F");
  });
});

describe.runIf(!isWindowsPlatform())("readPgid（组长归属由 OS 回答）", () => {
  it("读出目标进程的真实 PGID", async () => {
    const child = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    const pid = child.pid!;
    child.unref();
    await new Promise((r) => setTimeout(r, 400));
    const pgid = await readPgid(pid);
    expect(pgid).not.toBeNull();
    // detached 拉起 = 自身即组长 ⇒ PGID == PID（与 ps 直读一致）
    expect(pgid).toBe(pgidOf(pid));
    expect(pgid).toBe(pid);
    await killProcessTree({ pid, force: true });
  });

  it("目标已退出：返回 null（调用方退回单杀兜底，不抛错）", async () => {
    const child = spawn("true", [], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((r) => setTimeout(r, 500));
    expect(await readPgid(pid)).toBeNull();
  });
});

describe.runIf(!isWindowsPlatform())("killProcessTree POSIX 行为", () => {
  it("detached 进程组：整棵树 0 残留（禁止留孤儿）", async () => {
    // detached 拉起 = 独立新组，组长是目标自己 ⇒ 组路径可安全使用。
    const child = spawn("sh", ["-c", "sleep 300 & sleep 301 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    child.unref();
    await new Promise((r) => setTimeout(r, 700));

    const all = [pid, ...descendantPids(pid)];
    expect(all.length).toBeGreaterThanOrEqual(3); // sh + 两个 sleep
    expect(pgidOf(pid)).toBe(pid);

    const r = await killProcessTree({ pid, detached: true });
    expect(r.ok).toBe(true);
    expect(r.via).toContain("进程组");

    const gone = await waitFor(() => all.every((p) => !isAlive(p)));
    expect(gone).toBe(true);
    expect(all.filter((p) => isAlive(p))).toEqual([]);
  });

  it("与调用者同组：禁用组路径，只单杀 leader（防杀到自己）", async () => {
    // 关键回归：普通 spawn 的子进程与调用者同 PGID。若不加判据就
    // `kill(-pgid)`，信号会打向 vitest worker 自己的进程组 —— 实测表现为
    // 整个测试进程被 Killed。这里断言「不杀组」，且 leader 仍被回收。
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((r) => setTimeout(r, 400));

    const own = pgidOf(process.pid);
    expect(pgidOf(pid)).toBe(own); // 前提成立：同组

    const r = await killProcessTree({ pid, detached: false });
    expect(r.ok).toBe(true);
    // 必须走单杀兜底分支并标明「禁杀组」，绝不能是 `kill -SIGTERM -<pgid>`
    expect(r.via).toContain("单进程兜底");
    expect(r.via).toContain("禁杀组");
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
  });

  it("【反向验证锚点】detached 标记与实际组不一致时，不得按 pid 猜组长杀组", async () => {
    // 模拟 keepAlive 的标记与实际进程组不一致：调用方传 detached:true（它以为
    // pid 是组长），但实际 pid 与调用者同组、并非组长。旧实现直接 `kill(-pid)`
    // —— 若该组恰好存在（同组场景），信号会打到调用者自己；这里断言新实现
    // 以 OS 读到的 PGID 为准，绝不走「按 pid 猜」的组路径。
    const child = spawn("sh", ["-c", "sleep 300 & wait"], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((r) => setTimeout(r, 500));
    expect(pgidOf(pid)).toBe(pgidOf(process.pid));
    const r = await killProcessTree({ pid, detached: true });
    expect(r.via).toContain("禁杀组");
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

  it("killProcessTreeSync 与异步版同语义（detached 组优先，不留孤儿）", async () => {
    const child = spawn("sh", ["-c", "sleep 300 & sleep 301 & wait"], {
      detached: true,
      stdio: "ignore",
    });
    const pid = child.pid!;
    child.unref();
    await new Promise((r) => setTimeout(r, 600));
    const all = [pid, ...descendantPids(pid)];
    const r = killProcessTreeSync({ pid, detached: true });
    expect(r.via).toContain("进程组");
    await waitFor(() => all.every((p) => !isAlive(p)));
    expect(all.filter((p) => isAlive(p))).toEqual([]);
  });

  it("killProcessTreeSync 同组时同样禁用组路径", async () => {
    const child = spawn("sleep", ["300"], { stdio: "ignore" });
    const pid = child.pid!;
    await new Promise((r) => setTimeout(r, 400));
    const r = killProcessTreeSync({ pid, detached: false });
    expect(r.via).toContain("禁杀组");
    await waitFor(() => !isAlive(pid));
    expect(isAlive(pid)).toBe(false);
  });
});
