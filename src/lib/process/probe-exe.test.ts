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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { spawnSync } from "node:child_process";

import {
  describeProbeFailure,
  describeProbeMisses,
  firstRunnable,
  elevateLogLevel,
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

  it("被杀掉这一档按平台分开钉：POSIX 给信号，win32 只给退出码（ISSUE #2403）", () => {
    /* 这一档是「起来了但不是可用形态」的另一种落法，话术必须说得出来 —— 只打 `exit ?`
     * 的现场分不出「自己退的」与「被别人杀的」。但**两个平台的原值不同**（当场实测）：
     *   · POSIX：`status: null` + `signal: "SIGKILL"`；
     *   · win32 ：`status: 1` + `signal: null` —— 这一平台上终止不产生信号退出码，
     *     所以「被杀掉」与「自己退 1」**就是不可分**的。那是平台事实，不是判据放松。
     * 旧写法把 POSIX 那一半当通用前提 ⇒ 在 Windows 节点上恒红（每日全量是它的执行者）。 */
    const got = probeExecutable(process.execPath, ["-e", "process.kill(process.pid, 'SIGKILL')"]);
    expect(got.ok).toBe(false);
    expect(got.failure?.kind).toBe("nonzero-exit");
    const said = describeProbeFailure(got.failure!);
    if (process.platform === "win32") {
      expect(got.failure).toMatchObject({
        kind: "nonzero-exit",
        status: 1,
        signal: null,
      });
      expect(said).toContain("exit 1");
      /* 这一句才是本格的要点：话术**不许**在拿不到信号时编一个出来 ——
         「被信号结束」在 win32 上无从谈起，编出来就是一条假归因。 */
      expect(said).not.toContain("信号");
      return;
    }
    expect(got.failure).toMatchObject({
      kind: "nonzero-exit",
      status: null,
      signal: "SIGKILL",
    });
    expect(said).toContain("SIGKILL");
  });

  it("撞上探测预算 ⇒ timeout，不许混进「起不来」", () => {
    /* 这一格是本判据存在的理由：`error.code === "ETIMEDOUT"` 说的是「这一次没量到」，
     * 而下一次动作（再取一遍）与「去装一个东西」完全不同（规范 §13.6.4）。 */
    const got = probeExecutable(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], 50);
    expect(got.ok).toBe(false);
    expect(got.failure).toMatchObject({ kind: "timeout", timeoutMs: 50 });
  });
});

describe("firstRunnable：候选顺序与「试过哪些」", () => {
  /** 只有 `wanted` 这一档答 ok，其余按 `code` 的形态失败。 */
  const probeOnly =
    (wanted: string, failure: ProbeOutcome["failure"] = null) =>
    (candidate: string): ProbeOutcome =>
      candidate === wanted ? { ok: true, failure: null } : { ok: false, failure };

  it("命中第一个能跑的，且不把后面的候选算成「试过」", () => {
    const got = firstRunnable(["powershell", "pwsh"], () => [], probeOnly("pwsh"));
    expect(got.hit).toBe("pwsh");
    // 第一个候选**确实试过**且失败了 —— 这句读数下一次要靠它说清「谁顶掉了谁」。
    expect(got.missed[0]?.candidate).toBe("powershell");
  });

  it("每个候选都喂各自的参数（`py` 的 `-3` 是候选级的，不是调用点的记性）", () => {
    const seen: Array<[string, Array<string>]> = [];
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
    expect(describeProbeFailure({ kind: "spawn-error", code: "ENOENT" })).toContain("ENOENT");
    expect(describeProbeFailure({ kind: "nonzero-exit", status: 2, signal: null })).toContain(
      "exit 2",
    );
    expect(describeProbeFailure({ kind: "timeout", timeoutMs: 20_000 })).toContain("没量到");
  });

  it("多个候选时逐个点名，且原因跟在名字后面", () => {
    const text = describeProbeMisses(
      [
        {
          candidate: "powershell",
          failure: { kind: "nonzero-exit", status: 2, signal: null },
        },
      ],
      [{ candidate: "pwsh", failure: { kind: "timeout", timeoutMs: 20_000 } }],
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
    const fake = /* SAFETY: 类型断言已复核 */ (() => ({
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

  it("被信号杀掉那一形用注入来钉（win32 上真 spawn 拿不到它，话术仍得有）", () => {
    /* 上面的真进程那一格在 Windows 上走的是「只剩退出码」那一支，POSIX 那一支如果不注入
     * 就**永远没有执行者** —— 而它正是「自己退的 vs 被别人杀的」分得开的那一半（ISSUE #2403）。 */
    const text = describeProbeFailure({
      kind: "nonzero-exit",
      status: null,
      signal: "SIGKILL",
    });
    expect(text).toContain("被信号 SIGKILL 结束");
    expect(text).not.toContain("exit");
  });
});

describe("两条 `??` 兜底是判据的一部分，不是排版", () => {
  it("`spawn-error` 的码与 `nonzero-exit` 的两个字段都不许出现 `undefined`", () => {
    /* 这两处兜底看着像「TS 嫌烦」，其实是**读数**：`spawnSync` 在少数形态下既不给
     * `error.code`、也不给 `status` / `signal`。把它们原样交出去，话术里就会出现
     * 「起不来（undefined）」与「起来了但退非零（exit undefined）」—— 两句既不指向
     * 下一步、又把「没有读数」说成了「有个值」。 */
    for (const failure of [
      {
        kind: /* SAFETY: 类型断言已复核 */ "spawn-error" as const,
        code: "UNKNOWN",
      },
      {
        kind: /* SAFETY: 类型断言已复核 */ "nonzero-exit" as const,
        status: null,
        signal: null,
      },
    ]) {
      expect(describeProbeFailure(failure)).not.toContain("undefined");
    }
  });
});

describe("firstRunnableOrEmpty：`skipIf(!x)` 那一个约定 + 探不到时的那一行读数", () => {
  /* 那行读数走 `elevateLogLevel()` 注入的出口（默认是裸 Node 的 `console`，见实现文件头）。
   * 这里注入一个收集器而不是拦 `console`：出口是可换的，拦 `console` 会在换过之后
   * **静默收到空**，于是断言失败却说不出是「没打」还是「没收到」。 */
  const lines: Array<string> = [];
  let restore: () => void = () => undefined;
  beforeEach(() => {
    lines.length = 0;
    restore = elevateLogLevel({
      log: (m) => lines.push(m),
      warn: (m) => lines.push(m),
    });
  });
  afterEach(() => {
    restore();
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
    expect(lines).toEqual([]);
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
      }),
    ).toBe("");
    expect(lines.join("\n")).toContain("起不来");
  });

  it("不给 `report` 时一个字都不打（本模块在 `src/lib/**`，不许直接写 console）", () => {
    /* 判据：这两行输出只在调用方给了出口时才出现 —— `src/lib/**` 是服务端可达的
     * 库代码，直接 console 会绕开脱敏与 ERROR 镜像（`tests/single-logger-channel.test.ts`
     * 判的就是这一条）。所以「不注入就静默」是**约定的一部分**，不是省略。 */
    expect(
      firstRunnableOrEmpty({
        candidates: ["comfyapp-no-such-command-2316"],
        probeArgs: () => ["--version"],
        label: "假解释器",
      }),
    ).toBe("");
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
    });
    expect(got).toBe("");
    const text = lines.join("\n");
    expect(text).toContain("PowerShell");
    expect(text).toContain("powershell");
    expect(text).toContain("pwsh");
    expect(text).toContain("exit 2");
    expect(text).toContain("不是通过");
  });

  it("`report` 给了就照样给一遍（测试夹具要 stdout 上那一眼）", () => {
    /* 本模块**两条出口并存**：`emit()` 走宿主注入的唯一日志通道（应用侧接
     * `~/lib/core/logger`，落 `log/` 面板），而跑用例的人在终端上看得见的是 `report`
     * 那一行。少任何一条都不行 —— 只留前者时 CI 日志里读不到它；只留后者时判据判你
     * 直接写 console（或绕过脱敏）。 */
    const reported: Array<string> = [];
    firstRunnableOrEmpty({
      candidates: ["comfyapp-no-such-command-2316"],
      probeArgs: () => ["--version"],
      label: "假解释器",
      report: (line) => reported.push(line),
    });
    expect(reported.join("\n")).toContain("起不来");
    // 同一件事也走了注入的那条通道（上面那组 `lines` 是本用例的收集器）。
    expect(lines.join("\n")).toContain("起不来");
  });
});

/**
 * 「谁都没注入」那一档（ISSUE #2408 的读数点名的就是这里）。
 *
 * 上面那组的夹具在 `beforeEach` 里**总是**注入收集器，于是实现文件头那句
 * 「缺省空转不会让任何一条真实读数消失」从写下那天起**没有执行者** ——
 * `NO_SINK` 里那两个函数在全量 `--coverage` 里一次都没被调用（它和
 * `process-launch.ts` 那两个注入出口一起，把 `src/lib/process/**` 的函数覆盖
 * 从登记值 96% 拉到 95.34%）。
 *
 * ⚠️ 这一组只补得上 `warn` 那一半，而且是**有意的**：本模块今天没有任何
 * `emit("log", …)` 调用点，所以 `NO_SINK.log` 与 `process-launch.ts` 的 `log:`
 * 是「今天走不到的空位」而不是漏网 —— 按 §18.6 的口径，这里选择把走不到的那半句
 * 写出来，而不是把门槛往下挪。
 */
describe("谁都没注入时：读数落进缺省空转（ISSUE #2408）", () => {
  it("不抛、结论照旧（那个空串），而调用方那只眼睛照样收到读数", () => {
    const reported: Array<string> = [];
    expect(
      firstRunnableOrEmpty({
        candidates: ["comfyapp-no-such-command-2408"],
        probeArgs: () => ["--version"],
        label: "假解释器",
        report: (line) => reported.push(line),
      }),
    ).toBe("");
    expect(reported.join("\n")).toContain("起不来");
  });

  it("注入过再还原 ⇒ 回到的是**可调用的**缺省出口，不是 null", () => {
    /* 还原把 `sink` 换回前一份。若那一份是 `null`（一个看起来更省事的写法），
     * 下一次探测会在 `emit()` 里抛 —— 而 `emit` 外面那圈 try 只护注入进来的出口，
     * 于是「一次用例的还原动作」变成「下一格探测炸」。 */
    const restore = elevateLogLevel({ warn: () => undefined });
    restore();
    expect(() =>
      firstRunnableOrEmpty({
        candidates: ["comfyapp-no-such-command-2408"],
        probeArgs: () => ["--version"],
        label: "假解释器",
      }),
    ).not.toThrow();
  });
});
