// ── 「这个可执行文件在这台机器上真起得来吗」的唯一判据（Node 侧，带探测预算）──
//
// 症状驱动：「命令在 PATH 上 / 文件在盘上」与「它能被 spawn 起来、并解释得了我们要
// 给的参数」是两件事，而把前者当后者的写法在本仓已栽过三次，每次的报错都指不到真因：
//
//   · `tests/check-file-structure.test.ts` 的 PowerShell 探测：附近随便一个同名的
//     可执行文件（发行版附带的 shell 别名）退 0 就被认成 PowerShell，随后
//     `spawnSync(candidate, ["-NoProfile", …])` 起得来却解释不了参数 ⇒ 守卫脚本的
//      `HITS=` 一个都不出现 ⇒ `toContain` 等满 20s 才抛 `Test timed out` —— 一条
//     「这一格在这台机器上判不了」变成了「这一格红了」，而报错行指向「超时」。
//   · `scripts/check-app-port-vectors.cjs` 的 `python3 --version` 探针：形态不对的命令
//     被归进「这台机器没有 Python」，而那句话是假的 —— 下一动作（去装）也是错的。
//
// 所以这里给**一次探测**三个出口，调用方按语义挑一个用（不许糊成一个布尔）：
//
//   · `spawn-error` —— 进程根本没起来（`ENOENT` / `EACCES` / `EINVAL`…，取 `error.code`）；
//   · `nonzero-exit` —— 起来了、退**非零**（`status` / `signal` / 压根没等到状态）；
//   · `timeout` —— 超过了这一次探测的预算，**没有读数**。
//
// 三者对「这个候选能不能用」是同一个答案（不能用 / 判不了），但对**下一次动作**是三个
// 答案：去装、去换探测方式、去看机器忙不忙（规范 §13.6.4 那条「拿不到测量 ≠ 测量结果
// 是红的」）。把超时糊进前两档，是这条口径在测试侧最后一次失效的形态。
//
// §18.4 三选一：本模块走第三类（**纯 Node 宿主**）—— 它只依赖 `node:child_process`，
// 与同目录的 `kill-process-tree.ts` / `process-launch.ts` 同族：判「本机进程起不起得来」
// 的地基，本就该被 Next server 与测试 / 脚本宿主共用。加 `server-only` 会把
// 「测试侧要用它」这件事说反（那个入口就是一句 throw）。
import { spawnSync } from "node:child_process";

/* 探不到时那一行读数**不在这里写出去**。两条约束同时压在这一格：
 *
 *   · `tests/single-logger-channel.test.ts`：`src/lib/**` 是服务端可达的库代码，
 *     直接 `console` 会绕开 redact 脱敏与 ERROR 镜像（规范 07 §7.18.2.1）；
 *   · `tests/host-ts-loads-in-node.test.ts`：本模块要被真 Node **直接 `import`**
 *     （`scripts/python-probe.mjs`、平台侧 `node scripts/e2e-run.mjs`），而那一跳没有
 *     `~` 别名解析器 —— 静态 `import { logger } from "~/lib/core/logger"` 在**加载期**
 *     就是 `ERR_MODULE_NOT_FOUND: Cannot find package '~'`（平台侧 `cnb-8a8-1k5op440e`
 *     红的就是这一格）。
 *
 * 静态写通道、`console` 兜底、两边并存，三条都不成立。只剩一种形状：**本模块只把那一行
 * 说出来，往哪写由宿主注入**（`FirstRunnableOptions.report`，缺省不写）。
 * 于是探测结论与「这行字落不落得下去」解耦，加载期再没有一条能把它拖崩的边。
 */

/** 一次探测的三种结局（语义见文件头）。 */
export type ProbeFailure =
  /** 进程压根没起来（`error.code` 是 libuv 给的那个码；它认不出时是 `UNKNOWN`）。 */
  | { kind: "spawn-error"; code: string }
  /** 起来了但退非零（或被信号杀掉）。 */
  | { kind: "nonzero-exit"; status: number | null; signal: string | null }
  /** 超过了探测预算，**没有读数**。 */
  | { kind: "timeout"; timeoutMs: number };

/** 一次探测的结论：`failure` 为 `null` 才是「起得来且退 0」。 */
export interface ProbeOutcome {
  ok: boolean;
  failure: ProbeFailure | null;
}

/**
 * 一次探测的预算（毫秒）。
 *
 * 它不是性能参数，而是**判据会不会误报**的边界：一次「起不来」的正常探测是几十毫秒，
 * 而撞上这个数的形态（节点被压死、进程卡在初始化）本来就拿不到读数。与
 * `executable-resolve.ts` 的 `USABILITY_PROBE_TIMEOUT_MS` 同级量（那里量的是
 * 「pnpm / python 起不起得来」，这里是「解释器 / 宿主能不能解释我们的参数」）。
 */
export const EXE_PROBE_TIMEOUT_MS = 30_000;

/**
 * 真起一次进程，把「没起来 / 起了但退非零 / 没等到读数」分开答出来。
 *
 * 判据刻意**不看输出**：这条探针问的是「能不能起、能不能解释参数」，而不是
 * 「说的是什么」。看输出就要看编码（PS 5.1 的中文输出是 ANSI 代码页），
 * 那会把一个与业务无关的编码问题混进「这个命令在不在」的结论里。
 *
 * @param candidate 可执行文件名或路径（由调用方按平台的候选表给）
 * @param args 这一次探测要喂的参数
 * @param timeoutMs 探测预算，缺省 `EXE_PROBE_TIMEOUT_MS`
 * @returns 「起得来且退 0」时为 `{ ok: true, failure: null }`
 */
export function probeExecutable(
  candidate: string,
  args: string[],
  timeoutMs: number = EXE_PROBE_TIMEOUT_MS,
  /** 注入点：缺省真起进程。单测用它钉「不带码」那一格（真机上造不出来）。 */
  spawn: typeof spawnSync = spawnSync,
): ProbeOutcome {
  const probe = spawn(candidate, args, {
    stdio: "ignore",
    windowsHide: true,
    timeout: timeoutMs,
  });
  /* 撞上探针自己的 `timeout`：`error.code` 是 `ETIMEDOUT`。**必须单列**，它是
   * 「这一次没量到」，而不是「这个命令起不来」（§13.6.4 那条口径）。 */
  if (probe.error) {
    /* libuv 认不出的失败不给 `code`，`UNKNOWN` 是判据自己兜的那一档 —— 把它读成
     * 「没有错误」会让一条失败被报成可用（本模块要治的正是那一类）。空串同样是
     * 「没有码」（它会打出一句「起不来（）」），所以这里刻意不用 `??`。 */
    const errno = (probe.error as NodeJS.ErrnoException).code;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const code: string = errno || "UNKNOWN";
    if (code === "ETIMEDOUT") {
      return { ok: false, failure: { kind: "timeout", timeoutMs } };
    }
    return { ok: false, failure: { kind: "spawn-error", code } };
  }
  /* 起来了 ⇒ 认退出码：`status === 0` 才算可用。`status === null`（被信号干掉、或压根
   * 没等到状态）与退非零一样 —— **都不是「它可用」的证据**。 */
  if (probe.status === 0) return { ok: true, failure: null };
  /* 两个字段的 `?? null` 是**同一件事的两半**（`spawnSync` 的类型写着可空）：一条
   * 「起了但没等到状态」的读数要被如实交出去，而不是被读成「退 0」。 */
  const status = probe.status ?? null;
  const signal = probe.signal ?? null;
  return { ok: false, failure: { kind: "nonzero-exit", status, signal } };
}

/** `firstRunnable()` 的入参（候选表 + 每个候选要喂的参数 + 探测预算）。 */
export interface FirstRunnableOptions {
  /** 依次试的候选名，顺序即优先级。 */
  candidates: readonly string[];
  /**
   * 每个候选要喂的参数：**必须与真跑那一跳同形**。
   *
   * 为什么是逐候选的函数而不是一个数组：`py` 启动器必须先给 `-3` 才是「选一个解释器」，
   * 而它旁边的 `python` 不能带 —— 「同一个命令的可用判据不是统一的」这件事在这一层
   * 收口（同 `pythonProbeArgs()` 的理由）。
   */
  probeArgs: (candidate: string) => string[];
  /** 人读的名字（`PowerShell` / `Python`）：只在「探不到」那一句话里出现。 */
  label: string;
  /** 这一次探测的预算（缺省 `EXE_PROBE_TIMEOUT_MS`）。 */
  timeoutMs?: number;
  /** 注入点：缺省真起进程（单测用它钉两个平台的候选顺序，不必装两套解释器）。 */
  probe?: (candidate: string, args: string[]) => ProbeOutcome;
  /**
   * 探不到时那一行的出口（缺省不打）。
   *
   * 为什么是注入而不是就地写：本模块在 `src/lib/**` 里，直接 `console` 会绕开脱敏与
   * ERROR 镜像（`tests/single-logger-channel.test.ts`），而静态写 `logger` 会让它在真
   * Node 里加载不起来（`tests/host-ts-loads-in-node.test.ts`）—— 两条判据的交叉处只剩
   * 「由宿主决定往哪写」。用例与 `.mjs` 脚本要的都是 stdout 上那一行。
   */
  report?: (line: string) => void;
}

/**
 * `firstRunnable().hit ?? ""`，并把探不到时那一行「哪个候选、什么原因」交给 `report`。
 *
 * 为什么要把「空串 = 不在场」这个约定也收进来：本仓的用例是拿一个常量当 `skipIf` 守卫
 * 用的（`it.skipIf(!psExe)`），所以「不在场」必须能直接表达成 `""`。而**判不了与判错了
 * 只差那一行读数** —— 没有它，下一次只看到一片 `skipped`，说不出是「这台机器没装」
 * 还是「有个同名的东西把它顶掉了」（ISSUE #2316 的现场）。两处调用点因此都只写一行。
 * 那一行**不在这里写出去**（往哪写由 `report` 决定，缺省不写），理由见文件头。
 *
 * @param options 见 `FirstRunnableOptions`
 * @returns 命中的候选名；一个都没命中时为 `""`（沿用 `skipIf(!x)` 的约定）
 */
export function firstRunnableOrEmpty(options: FirstRunnableOptions): string {
  const probe =
    options.probe ??
    ((candidate: string, args: string[]) =>
      probeExecutable(candidate, args, options.timeoutMs));
  const got = firstRunnable(options.candidates, options.probeArgs, probe);
  if (got.hit) return got.hit;
  /* 出口由调用方给（缺省不打 —— 「探不到」仍如实返回成空串，调用方按 `skipIf(!x)` 处理）：
   * 用例侧要 stdout 上那一眼，`.mjs` 脚本侧也是；两边各自决定，本模块不碰通道，
   * 理由见文件头那段。命中时一次也不报 —— 一行「跳过」都没有却印一句「跳过」，比不印更误导。 */
  options.report?.(
    `[probe] 本机没有可用的 ${options.label}，相关用例跳过（不是通过）：` +
      describeProbeMisses(got.missed, got.timeouts),
  );
  return "";
}

/** 一个「试过但没成」的候选（日志与话术里要用它，别把探针喂的参数抄第二遍）。 */
export interface ProbedCandidate {
  /** 探测里用的那个名字（`powershell` / `python3` / …）。 */
  candidate: string;
  failure: ProbeFailure;
}

/**
 * 把一条 `missed` 摊平成话术用的形状。
 *
 * ⚠️ 存在的理由不是「换个名字好看」：本仓有两处「试过哪些候选」的清单来自**别人**手写
 * 的数据结构（`python-resolve.ts` 的 `PythonMiss` 用的是 `command` 而不是 `candidate`），
 * 而把它们直接喂给 `describeProbeMisses()` 时**不会报错、只会打出 `undefined`**
 * —— 一个空名字配一句真原因，读的人拿它什么也做不了（ISSUE #2316 的那句「每个候选探完
 * 仍无结论 ⇒ 打印哪一个候选、什么原因」正好在这一格失效）。所以摊平这一步有名字、
 * 有单测，而不是靠调用点记得字段名。
 *
 * @param missed 失败的那些（`{ command, failure }` 形状即可）
 * @returns `ProbedCandidate[]`（`command` → `candidate`）
 */
export function toProbedCandidates(
  missed: readonly { command: string; failure: ProbeFailure }[],
): ProbedCandidate[] {
  return missed.map((m) => ({ candidate: m.command, failure: m.failure }));
}

/**
 * 依次探候选，返回第一个**真能跑**的。
 *
 * 「超时」不在这里换下一个候选：它是**没量到**，而换一个候选再探一次不会让机器闲下来
 * —— 那只是把一次没有读数变成几次没有读数（并且把预算乘上候选数）。调用方拿到
 * `timeouts` 之后要做的判断是另一件事（§13.6.4：先隔离复跑，再定性）。
 *
 * @param candidates 候选名，顺序即优先级（在 `python` 那一族里由 `pythonCandidates()` 给）
 * @param probeArgs 每个候选要喂的参数（`py` 启动器必须带 `-3`，这一层只管拼装）
 * @param probe 注入点：缺省真起进程（单测用它钉两个平台的候选顺序，不必装两套解释器）
 * @returns 命中的候选与「试过但起不来」的那些（后者供一次性话术用）
 */
export function firstRunnable(
  candidates: readonly string[],
  probeArgs: (candidate: string) => string[],
  probe: (candidate: string, args: string[]) => ProbeOutcome = probeExecutable,
): {
  hit: string | null;
  missed: ProbedCandidate[];
  timeouts: ProbedCandidate[];
} {
  const missed: ProbedCandidate[] = [];
  const timeouts: ProbedCandidate[] = [];
  for (const candidate of candidates) {
    const outcome = probe(candidate, probeArgs(candidate));
    if (outcome.ok) return { hit: candidate, missed, timeouts };
    const failure = outcome.failure ?? { kind: "spawn-error", code: "UNKNOWN" };
    (failure.kind === "timeout" ? timeouts : missed).push({
      candidate,
      failure,
    });
  }
  return { hit: null, missed, timeouts };
}

/**
 * 一次探测失败的可读说明（**给用户看的那一句**，尤其要能指到「哪一个候选、什么原因」）。
 *
 * 为什么要它单独一个函数：这句输出是「这一格安静地跳过了 / 安静地判错了」唯一的区别
 * 所在。只打一片 `skipped` 的现场，谁也说不清跳过是因为「这台机器没有 PowerShell」
 * 还是「有一个同名的东西把它顶掉了」—— 而这两种的下一动作完全不同。
 *
 * @param missed / `timeouts` 取自 `firstRunnable()`（或调用方自己攒的那两条）
 * @returns 一行一句话；两者都空时给出「没试过任何候选」（那是调用方的形状问题）
 */
export function describeProbeMisses(
  missed: readonly ProbedCandidate[],
  timeouts: readonly ProbedCandidate[] = [],
): string {
  const parts: string[] = [];
  for (const { candidate, failure } of missed) {
    parts.push(`${candidate}：${describeProbeFailure(failure)}`);
  }
  for (const { candidate, failure } of timeouts) {
    parts.push(`${candidate}：${describeProbeFailure(failure)}`);
  }
  return parts.length > 0 ? parts.join("；") : "没有试过任何候选";
}

/** 单个 `ProbeFailure` 的一句话（三条出口各一句，别糊成「不可用」）。 */
export function describeProbeFailure(failure: ProbeFailure): string {
  if (failure.kind === "spawn-error") return `起不来（${failure.code}）`;
  if (failure.kind === "timeout") {
    return `没在预算内给出读数（${failure.timeoutMs}ms，属「没量到」而不是「起不来」）`;
  }
  /* `signal !== null` 那一支说明它是**被杀的**（`status` 此时恒为 `null`）；否则给退出码。
   * 两种都没有的形态（libuv 既不给码也不给信号）写「没有读数」—— 不许编一个 `0`
   * 出来充数（那会被读成「成功了」）。 */
  if (failure.signal !== null) return `起来了但被信号 ${failure.signal} 结束`;
  return failure.status === null
    ? "起来了但没拿到退出码（这一档没有读数）"
    : `起来了但退非零（exit ${failure.status}）`;
}
