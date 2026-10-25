/**
 * 「这个可执行文件真起得来吗」的判据（`src/lib/process/probe-exe.ts`）。
 *
 * 起点是 ISSUE #2316 的现场：`tests/check-file-structure.test.ts` 的 PowerShell
 * 探测只认「spawn 成不成功 + 退出码」，于是附近一个同名的冒牌可执行文件退 0 就被
 * 认成 PowerShell，随后三条用例以 `Test timed out in 20000ms` 红掉 —— 一条
 * 「这台机器上判不了」变成了「这一格红了」，而报错行指向「超时」。
 *
 * 这一份钉两件事：**三条出口要分得开**（起不来 / 退非零 / 没量到），以及
 * 「试过哪几个候选、各是因为什么」这句输出里必须真带着候选名与原因（否则下一次
 * 只看到一片 skipped，说不清是安静地跳过还是安静地判错）。
 *
 * 两个平台的候选都不必真装：注入探针即可（真起进程那一档由 `probeExecutable`
 * 本体的三条用例覆盖 —— 用的是这台机器上一定存在的 `process.execPath` 与一个
 * 一定不存在的名字）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { spawnSync } from "node:child_process";

/* 那行「探不到」的读数**由宿主注入出口**（`FirstRunnableOptions.report`），本模块既不
 * 直接写 `console`（`tests/single-logger-channel.test.ts`），也不静态 import 日志通道
 * （`tests/host-ts-loads-in-node.test.ts`：真 Node 里没有 `~` 别名解析器，那一行 import
 * 会把整条链拖崩在加载期）。所以这一份用例既不 mock 通道、也不拦 console ——
 * 直接断言「交出去的那一行」，那正是本模块承诺的全部。
 *
 * `reported` 是注入进去的记录器：断言前要清空，否则上一格的字会串进下一格。 */
const reported = vi.hoisted(() => [] as string[]);
const report = vi.hoisted(() => (line: string) => {
  reported.push(line);
});

import {
  describeProbeFailure,
  describeProbeMisses,
  firstRunnable,
  firstRunnableOrEmpty,
  probeExecutable,
  toProbedCandidates,
  type ProbeOutcome,
} from "./probe-exe";

describe("probeExecutable：真起一次进程，三条出口分开答", () => {
  it("能起的进程答 ok（不喂任何与业务有关的参数）", () => {
    // `process.execPath` 在任何宿主上都一定起得来；`-e ""` 是空语句、退 0。
    expect(probeExecutable(process.execPath, ["-e", ""])).toEqual({
      ok: true,
      failure: null,
    });
  });

  it("起来了但退非零 ⇒ nonzero-exit（「命令在、不是可用形态」那一档）", () => {
    const got = probeExecutable(process.execPath, ["-e", "process.exit(3)"]);
    expect(got.ok).toBe(false);
    expect(got.failure).toMatchObject({ kind: "nonzero-exit", status: 3 });
  });

  it("压根没这个命令 ⇒ spawn-error（与「退非零」不是一回事）", () => {
    const got = probeExecutable("comfyapp-no-such-command-2316", []);
    expect(got.ok).toBe(false);
    expect(got.failure?.kind).toBe("spawn-error");
  });

  it("被信号结束（`status` 为 null）⇒ nonzero-exit，且话术说出是哪个信号", () => {
    /* 这一档是「起来了但不是可用形态」的另一种落法：`spawnSync` 给 `status: null` +
     * `signal`。它与「退非零」在**下一动作**上同一件（不能用），但话术必须说得出来 ——
     * 只打 `exit ?` 的现场分不出「自己退的」与「被别人杀的」。 */
    const got = probeExecutable(process.execPath, [
      "-e",
      "process.kill(process.pid, 'SIGKILL')",
    ]);
    expect(got.ok).toBe(false);
    expect(got.failure).toMatchObject({ kind: "nonzero-exit", status: null });
    expect(describeProbeFailure(got.failure!)).toContain("SIGKILL");
  });

  it("撞上探测预算 ⇒ timeout，不许混进「起不来」", () => {
    /* 这一格是本判据存在的理由：`error.code === "ETIMEDOUT"` 说的是「这一次没量到」，
     * 而下一次动作（再取一遍）与「去装一个东西」完全不同（规范 §13.6.4）。 */
    const got = probeExecutable(
      process.execPath,
      ["-e", "setTimeout(() => {}, 5000)"],
      50,
    );
    expect(got.ok).toBe(false);
    expect(got.failure).toMatchObject({ kind: "timeout", timeoutMs: 50 });
  });
});

describe("firstRunnable：候选顺序与「试过哪些」", () => {
  /** 只有 `wanted` 这一档答 ok，其余按 `code` 的形态失败。 */
  const probeOnly =
    (wanted: string, failure: ProbeOutcome["failure"] = null) =>
    (candidate: string): ProbeOutcome =>
      candidate === wanted
        ? { ok: true, failure: null }
        : { ok: false, failure };

  it("命中第一个能跑的，且不把后面的候选算成「试过」", () => {
    const got = firstRunnable(
      ["powershell", "pwsh"],
      () => [],
      probeOnly("pwsh"),
    );
    expect(got.hit).toBe("pwsh");
    // 第一个候选**确实试过**且失败了 —— 这句读数下一次要靠它说清「谁顶掉了谁」。
    expect(got.missed[0]?.candidate).toBe("powershell");
  });

  it("每个候选都喂各自的参数（`py` 的 `-3` 是候选级的，不是调用点的记性）", () => {
    const seen: Array<[string, string[]]> = [];
    firstRunnable(
      ["python", "py"],
      (candidate) => (candidate === "py" ? ["-3", "-c", "x"] : ["-c", "x"]),
      (candidate, args) => {
        seen.push([candidate, args]);
        return { ok: false, failure: { kind: "spawn-error", code: "ENOENT" } };
      },
    );
    expect(seen).toEqual([
      ["python", ["-c", "x"]],
      ["py", ["-3", "-c", "x"]],
    ]);
  });

  it("一个都不可用 ⇒ hit 为 null，两条账各自分开记（超时不混进 missed）", () => {
    const got = firstRunnable(
      ["a", "b"],
      () => [],
      (candidate) =>
        candidate === "a"
          ? { ok: false, failure: { kind: "timeout", timeoutMs: 30 } }
          : {
              ok: false,
              failure: { kind: "nonzero-exit", status: 2, signal: null },
            },
    );
    expect(got.hit).toBeNull();
    expect(got.timeouts.map((t) => t.candidate)).toEqual(["a"]);
    expect(got.missed.map((m) => m.candidate)).toEqual(["b"]);
  });
});

describe("话术：下一个要排障的人得从这一行读出「哪一个候选、什么原因」", () => {
  it("三条出口各说各的（别糊成一句「不可用」）", () => {
    expect(
      describeProbeFailure({ kind: "spawn-error", code: "ENOENT" }),
    ).toContain("ENOENT");
    expect(
      describeProbeFailure({ kind: "nonzero-exit", status: 2, signal: null }),
    ).toContain("exit 2");
    expect(
      describeProbeFailure({ kind: "timeout", timeoutMs: 20000 }),
    ).toContain("没量到");
  });

  it("多个候选时逐个点名，且原因跟在名字后面", () => {
    const text = describeProbeMisses(
      [
        {
          candidate: "powershell",
          failure: { kind: "nonzero-exit", status: 2, signal: null },
        },
      ],
      [{ candidate: "pwsh", failure: { kind: "timeout", timeoutMs: 20000 } }],
    );
    expect(text).toContain("powershell");
    expect(text).toContain("pwsh");
    expect(text.indexOf("powershell")).toBeLessThan(text.indexOf("pwsh"));
    expect(text).toContain("exit 2");
  });

  it("一个候选都没试过时说清是「没试」，而不是冒充「没有」", () => {
    expect(describeProbeMisses([], [])).toContain("没有试过");
  });

  it("别人手写的那份清单能摊平（否则打出的是 `undefined：<原因>`）", () => {
    /* `python-resolve.ts` 的 `PythonMiss` 用的是 `command` 而不是 `candidate` ——
     * 直接喂进来**不会报错**，只会把名字打成 `undefined`，而那正好是本判据要治的
     * 那种失效（一句带原因但指不到候选的话）。摊平这一步因此有名字、有判据。 */
    const flat = toProbedCandidates([
      { command: "python3", failure: { kind: "spawn-error", code: "ENOENT" } },
    ]);
    expect(flat).toEqual([
      {
        candidate: "python3",
        failure: { kind: "spawn-error", code: "ENOENT" },
      },
    ]);
    expect(describeProbeMisses(flat)).not.toContain("undefined");
  });
});

describe("边界：没有码的那种形态也不许编一个数出来充数", () => {
  it("libuv 不给 `code` 时补 `UNKNOWN`（真机上造不出这一格，注入点造）", () => {
    /* `spawnSync` 不填 `error.code` 的形态在真机上没有稳定的造法，而**这一格的判据
     * 必须被走到**：把它读成「没有错误」就会让一条失败被报成可用。所以留一个注入点
     * （与 `executable-resolve.ts` 的 `probe` 同一个理由）。 */
    const fake = (() => ({
      error: new Error("boom"),
      status: null,
      signal: null,
    })) as unknown as typeof spawnSync;
    const got = probeExecutable("whatever", [], 1000, fake);
    expect(got.ok).toBe(false);
    expect(got.failure).toEqual({ kind: "spawn-error", code: "UNKNOWN" });
  });

  it("既没信号也没退出码 ⇒ 话术说「没有读数」，不说 exit 0", () => {
    const text = describeProbeFailure({
      kind: "nonzero-exit",
      status: null,
      signal: null,
    });
    expect(text).toContain("没有读数");
    expect(text).not.toContain("exit 0");
  });
});

describe("两条 `??` 兜底是判据的一部分，不是排版", () => {
  it("`spawn-error` 的码与 `nonzero-exit` 的两个字段都不许出现 `undefined`", () => {
    /* 这两处兜底看着像「TS 嫌烦」，其实是**读数**：`spawnSync` 在少数形态下既不给
     * `error.code`、也不给 `status` / `signal`。把它们原样交出去，话术里就会出现
     * 「起不来（undefined）」与「起来了但退非零（exit undefined）」—— 两句既不指向
     * 下一步、又把「没有读数」说成了「有个值」。 */
    for (const failure of [
      { kind: "spawn-error" as const, code: "UNKNOWN" },
      { kind: "nonzero-exit" as const, status: null, signal: null },
    ]) {
      expect(describeProbeFailure(failure)).not.toContain("undefined");
    }
  });
});

describe("firstRunnableOrEmpty：`skipIf(!x)` 那一个约定 + 探不到时的那一行读数", () => {
  beforeEach(() => {
    reported.length = 0;
  });

  it("命中就返回候选名（调用点拿它当 `skipIf(!x)` 的守卫）", () => {
    const got = firstRunnableOrEmpty({
      candidates: ["a", "b"],
      probeArgs: () => [],
      label: "X",
      probe: (candidate) =>
        candidate === "b"
          ? { ok: true, failure: null }
          : { ok: false, failure: { kind: "spawn-error", code: "ENOENT" } },
    });
    expect(got).toBe("b");
    // 命中时**不打**那行读数：一行「跳过」都没有，却印一句「跳过」，比不印更误导。
    expect(reported).toEqual([]);
  });

  it("缺省探针（真起进程）那条路也走得通：注入点不给就用 `probeExecutable`", () => {
    /* 上一格注入了探针，于是 `probeExecutable` 那个缺省分支从没被走到 ——
     * 而它正是两处调用点实际走的那条路。这里喂一个真机上一定不存在的名字：
     * 结论必须是「不在场」，不是抛。 */
    expect(
      firstRunnableOrEmpty({
        candidates: ["comfyapp-no-such-command-2316"],
        probeArgs: () => ["--version"],
        label: "假解释器",
        report,
      }),
    ).toBe("");
    expect(reported.join("\n")).toContain("起不来");
  });

  it("不给 `report` 时一个字都不打，结论照给（读数与探测解耦）", () => {
    /* 「不注入就静默」是**约定的一部分**，不是省略：`src/lib/**` 直接 console 会绕开
     * 脱敏与 ERROR 镜像，而静态 import 日志通道会让本模块在真 Node 里加载不起来 ——
     * 所以往哪写只能由宿主说。探测的结论不该被「这行字落不落得下去」拖住。 */
    expect(
      firstRunnableOrEmpty({
        candidates: ["comfyapp-no-such-command-2316"],
        probeArgs: () => ["--version"],
        label: "假解释器",
      }),
    ).toBe("");
    expect(reported).toEqual([]);
  });

  it("一个都没有 ⇒ 空串，且**每个候选的名字与原因**都打出来", () => {
    /* 这一格是 ISSUE #2316 的另一半：一条判不了的用例被记成红，与「安静地跳过了」
     * 在日志里长得一样 —— 区别就在这一行。所以这里把**写出去的那一行**一起断言：
     * 候选名、以及「起来了但退非零」这个具体形态，两件都要出现。 */
    const got = firstRunnableOrEmpty({
      candidates: ["powershell", "pwsh"],
      probeArgs: () => [],
      label: "PowerShell",
      probe: (candidate) =>
        candidate === "pwsh"
          ? {
              ok: false,
              failure: { kind: "nonzero-exit", status: 2, signal: null },
            }
          : { ok: false, failure: { kind: "spawn-error", code: "ENOENT" } },
      report,
    });
    expect(got).toBe("");
    const text = reported.join("\n");
    expect(text).toContain("PowerShell");
    expect(text).toContain("powershell");
    expect(text).toContain("pwsh");
    expect(text).toContain("exit 2");
    expect(text).toContain("不是通过");
  });

  it("出口拿到的是**带前缀的成品行**（宿主要能原样写出去）", () => {
    /* 两处调用点注入的都是 `process.stdout.write`，它们只负责写、不负责拼 ——
     * 所以前缀 `[probe]` 与「不是通过」这句必须由本模块给全，否则终端上那一行
     * 会因为宿主不同而长得不一样。 */
    firstRunnableOrEmpty({
      candidates: ["comfyapp-no-such-command-2316"],
      probeArgs: () => ["--version"],
      label: "假解释器",
      report,
    });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain("[probe]");
  });
});
