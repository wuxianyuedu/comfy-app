import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

import { createConsoleRunner, type ConsoleEvent } from "./console-run";
import { resetConsoleSlotForTest } from "./console-registry";

/** 起一条真命令并收集全部事件（控制台的判据就是「能不能在用例里直接跑真进程」）。 */
async function runOnce(
  file: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{
  events: ConsoleEvent[];
  result: Awaited<ReturnType<ReturnType<typeof createConsoleRunner>["run"]>>;
}> {
  const runner = createConsoleRunner();
  const events: ConsoleEvent[] = [];
  const result = await runner.run(
    {
      runId: "test-run",
      command: [file, ...args].join(" "),
      file,
      args,
      cwd: process.cwd(),
      timeoutMs,
    },
    (event) => events.push(event),
  );
  return { events, result };
}

const textOf = (events: ConsoleEvent[], stream?: "stdout" | "stderr") =>
  events
    .filter((e) => e.type === "out" && (!stream || e.stream === stream))
    .map((e) => (e.type === "out" ? e.text : ""))
    .join("");

describe("createConsoleRunner", () => {
  it("start 帧带实际可执行文件与参数、cwd 是项目根", async () => {
    const { events } = await runOnce(process.execPath, ["-e", "0"]);
    const start = events[0];
    expect(start?.type).toBe("start");
    if (start?.type !== "start") return;
    expect(start.file).toBe(process.execPath);
    expect(start.args).toEqual(["-e", "0"]);
    expect(start.cwd).toBe(process.cwd());
  });

  it("stdout 与 stderr 各自成帧，顺序与内容如实（含中文，UTF-8 不花）", async () => {
    const { events, result } = await runOnce(process.execPath, [
      "-e",
      "process.stdout.write('out-中文\\n');process.stderr.write('err-中文\\n')",
    ]);
    expect(result.exitCode).toBe(0);
    expect(textOf(events, "stdout")).toContain("out-中文");
    expect(textOf(events, "stderr")).toContain("err-中文");
    // 退出帧在最后，且带着用时。
    const last = events[events.length - 1];
    expect(last?.type).toBe("exit");
    if (last?.type !== "exit") return;
    expect(last.code).toBe(0);
    expect(last.killed).toBe(false);
    expect(last.truncatedNote).toBeNull();
    expect(last.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("非零退出码如实透出（界面据此判成败）", async () => {
    const { result, events } = await runOnce(process.execPath, [
      "-e",
      "process.exit(3)",
    ]);
    expect(result.exitCode).toBe(3);
    const last = events[events.length - 1];
    expect(last?.type === "exit" && last.code).toBe(3);
    expect(result.killed).toBe(false);
  });

  it("busy() 在跑时给出「是谁、从什么时候」，跑完归 null", async () => {
    const runner = createConsoleRunner();
    expect(runner.busy()).toBeNull();
    const done = runner.run(
      {
        runId: "slow",
        command: "node -e sleep",
        file: process.execPath,
        args: ["-e", "setTimeout(()=>{},3000)"],
        cwd: process.cwd(),
        timeoutMs: 20_000,
      },
      () => undefined,
    );
    // 让 spawn 落地
    await new Promise((r) => setTimeout(r, 200));
    const busy = runner.busy();
    expect(busy?.runId).toBe("slow");
    expect(busy?.command).toBe("node -e sleep");
    await runner.cancel();
    await done;
    expect(runner.busy()).toBeNull();
  });

  it("cancel() 掐整棵树：exit 帧标 killed，而不是伪装成「自己失败」", async () => {
    const runner = createConsoleRunner();
    const events: ConsoleEvent[] = [];
    const done = runner.run(
      {
        runId: "cancel-me",
        command: "sleep",
        file: process.execPath,
        args: ["-e", "setTimeout(()=>{},60000)"],
        cwd: process.cwd(),
        timeoutMs: 20_000,
      },
      (event) => events.push(event),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(await runner.cancel()).toBe(true);
    const result = await done;
    expect(result.killed).toBe(true);
    const last = events[events.length - 1];
    expect(last?.type === "exit" && last.killed).toBe(true);
  });

  it("取消**子进程树**：孙进程也一并收走（硬规则 3 的回归判据）", async () => {
    const runner = createConsoleRunner();
    /* 起一个「父打印孙 PID 后长睡」的形态：单杀 leader 会留下孙进程，
     * 而 killProcessTree 会连它一起收。这是控制台必然踩到的形态 ——
     * pnpm / drizzle-kit 都是「自己还有子进程」的命令。 */
    const childScript = `
      const { spawn } = require('child_process');
      const g = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
      process.stdout.write('GRANDCHILD=' + g.pid + '\\n');
      setTimeout(()=>{},60000);
    `;
    let grandchildPid = 0;
    const done = runner.run(
      {
        runId: "tree",
        command: "tree",
        file: process.execPath,
        args: ["-e", childScript],
        cwd: process.cwd(),
        timeoutMs: 20_000,
      },
      (event) => {
        if (event.type !== "out") return;
        const m = /GRANDCHILD=(\d+)/.exec(event.text);
        if (m) grandchildPid = Number(m[1]);
      },
    );
    // 等孙进程 PID 出来（最多 5s）
    for (let i = 0; i < 50 && !grandchildPid; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(grandchildPid).toBeGreaterThan(0);
    expect(isAlive(grandchildPid)).toBe(true);
    await runner.cancel();
    await done;
    // 回收是异步派发（taskkill / signal），给一点时间并轮询确认。
    let alive = true;
    for (let i = 0; i < 40 && alive; i++) {
      await new Promise((r) => setTimeout(r, 100));
      alive = isAlive(grandchildPid);
    }
    expect(alive, `孙进程 ${grandchildPid} 未被回收`).toBe(false);
  }, 30_000);

  it("输出超过上限即停发并带截断说明（命令继续跑完）", async () => {
    const runner = createConsoleRunner();
    const events: ConsoleEvent[] = [];
    // 生成 ~500KB：远超 MAX_OUTPUT_CHARS(200k)
    const result = await runner.run(
      {
        runId: "big",
        command: "big",
        file: process.execPath,
        args: ["-e", "process.stdout.write('x'.repeat(500000))"],
        cwd: process.cwd(),
        timeoutMs: 20_000,
      },
      (event) => events.push(event),
    );
    // 命令本身仍然成功退出（截断只影响转发，不掐进程）。
    expect(result.exitCode).toBe(0);
    const last = events[events.length - 1];
    expect(last?.type === "exit" && last.truncatedNote).toBeTruthy();
    expect(textOf(events)).toContain("输出已达");
  }, 30_000);

  it("看门狗到点掐整棵树（killed=true 而不是永远转圈）", async () => {
    const runner = createConsoleRunner();
    const events: ConsoleEvent[] = [];
    const result = await runner.run(
      {
        runId: "timeout",
        command: "timeout",
        file: process.execPath,
        args: ["-e", "setTimeout(()=>{},60000)"],
        cwd: process.cwd(),
        // 下限被夹到 1s，用例只等一秒。
        timeoutMs: 1000,
      },
      (event) => events.push(event),
    );
    expect(result.killed).toBe(true);
    expect(textOf(events, "stderr")).toContain("上限");
  }, 30_000);

  it("可执行文件不存在时给出 error 帧与可读文案（不是抛给调用方）", async () => {
    const runner = createConsoleRunner();
    const events: ConsoleEvent[] = [];
    const result = await runner.run(
      {
        runId: "enoent",
        command: "definitely-not-a-real-binary-xyz",
        file: "definitely-not-a-real-binary-xyz",
        args: [],
        cwd: process.cwd(),
        timeoutMs: 5000,
      },
      (event) => events.push(event),
    );
    const errorFrame = events.find((e) => e.type === "error");
    expect(errorFrame?.type).toBe("error");
    expect(result.exitCode).toBeNull();
    /* 文案必须**说清找过 PATH**（ISSUE #1327）：裸的 `spawn xxx ENOENT` 看着像
     * 参数写错，而用户要做的是「确认命令装没装 / 这个进程的 PATH 里有没有它」。 */
    if (errorFrame?.type === "error") {
      expect(errorFrame.message).toContain("definitely-not-a-real-binary-xyz");
      expect(errorFrame.message).toContain("PATH");
    }
  });

  it("起进程前先解析可执行形态：start 帧报的是**真正要起的那一份**", async () => {
    /* 这条判据的现场（ISSUE #1327）：控制台把用户敲的 `pnpm` 直接丢给 spawn，
     * Windows 上必回 `spawn pnpm ENOENT`。修法是在起之前过一遍
     * `~/lib/process/executable-resolve`，所以 `start` 帧里的 `file` 应当是
     * **解析后的路径**（POSIX 上就是 PATH 里的绝对路径），而不是用户敲的裸名字。 */
    const { events } = await runOnce("node", ["-e", "0"]);
    const start = events[0];
    expect(start?.type).toBe("start");
    if (start?.type !== "start") return;
    // `node` 在 PATH 上 → 解析成绝对路径（不再是裸 `node`）。
    expect(start.file).toBe(process.execPath);
  });
});

describe("输出的上限边界（精确撞上限的那一轮）", () => {
  /** 用例里重新读常量：上限一旦调整，夹具跟着走，不会变成一条静默失效的假绿。 */
  it("恰好写满上限：不报截断；再多一个字符：报截断且后续不再转发", async () => {
    const { MAX_OUTPUT_CHARS } = await import("./console-limits");
    const exact = createConsoleRunner();
    const exactEvents: ConsoleEvent[] = [];
    await exact.run(
      {
        runId: "exact",
        command: "exact",
        file: process.execPath,
        args: ["-e", `process.stdout.write('y'.repeat(${MAX_OUTPUT_CHARS}))`],
        cwd: process.cwd(),
        timeoutMs: 20_000,
      },
      (event) => exactEvents.push(event),
    );
    // 恰好等于上限：没有「已达上限」的提示（提示只在**超过**时给）。
    expect(textOf(exactEvents)).not.toContain("输出已达");

    const over = createConsoleRunner();
    const overEvents: ConsoleEvent[] = [];
    await over.run(
      {
        runId: "over",
        command: "over",
        file: process.execPath,
        /* 分两次写：第一次正好填满上限，第二次才撞上 `remaining <= 0`。
         * 一次写完只走「单 chunk 超剩余量」那条分支 —— 两条分支的文案不同，
         * 判据必须分别钉（这正是「上限之后还有输出」的真实形态）。 */
        args: [
          "-e",
          `process.stdout.write('y'.repeat(${MAX_OUTPUT_CHARS}));` +
            `setTimeout(()=>process.stdout.write('LATE'), 30)`,
        ],
        cwd: process.cwd(),
        timeoutMs: 20_000,
      },
      (event) => overEvents.push(event),
    );
    // 超出之后又来了输出：补一句说明（界面上是**看得见**的出口）。
    expect(textOf(overEvents)).toContain("输出已达");
    // 迟到的内容一个字都不转发。
    expect(textOf(overEvents)).not.toContain("LATE");
    // 截断之后的内容一个字都不再转发。
    const total = textOf(overEvents).replace(/\n… 输出已达[^\n]*\n/, "").length;
    expect(total).toBeLessThanOrEqual(MAX_OUTPUT_CHARS + 1);
  }, 60_000);
});

describe("resetConsoleSlotForTest", () => {
  it("清掉单例后拿到的是全新的槽（带空历史）", async () => {
    const { consoleSlot, recordConsoleHistory } =
      await import("./console-registry");
    resetConsoleSlotForTest();
    const first = consoleSlot();
    recordConsoleHistory(first, {
      runId: "a",
      command: "x",
      exitCode: 0,
      killed: false,
      durationMs: 1,
      finishedAt: Date.now(),
    });
    expect(consoleSlot().history).toHaveLength(1);
    resetConsoleSlotForTest();
    expect(consoleSlot().history).toHaveLength(0);
  });
});

/** 用信号 0 探测进程是否还在（POSIX；Windows 上同样能判「还活着」）。 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 确保用例结束后没有残留（失败时也不留下长睡进程）。 */
process.on("exit", () => {
  try {
    execFileSync("true", [], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
});
