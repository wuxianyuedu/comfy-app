// ── 「这台机器上哪个 Python 真能跑」的唯一判据（Node 侧）────────────────────
//
// 与 `executable-resolve.ts` 同域、同形态，只多回答一件事：**在按平台排好的候选里
// 挑出第一个能用的**。抽出来的理由与那个模块一样 —— 同一个坑已经在四处各写一遍
// （门禁脚本、E2E 夹具、流水线的工具链自证），而每写一遍都要重新回答「Windows 上
// 先试 `python` 还是 `python3`」「`py` 要不要带 `-3`」，答案在四个地方漂移
// （ISSUE #1959 第二轮首跑现场：自证那一步探的面与门禁不是同一份）。
//
// §18.4 三选一：与它的同族件同走第三类（**纯 Node 宿主**）—— 判据必须能被
// `scripts/*.cjs` / `e2e/support/*.mjs` 直接加载（`server-only` 的入口就是一句
// throw），也必须能被单测喂注入探针逐条断言两个平台的候选顺序。登记见
// `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`。

// **必须带 `.ts` 后缀**（同 `python-candidates.ts` 那条说明）：本模块被
// `e2e/support/preflight-python.mjs` / `fake-comfyui-executor-env.mjs` 直接静态
// import，Node 的 ESM 解析器不认无后缀的相对说明符 —— 少了它就是整条 `e2e` stage
// 在加载期 `ERR_MODULE_NOT_FOUND` 退 1（平台侧实测 897ms 崩在 `executable-resolve`）。
// 这一条对**同一条链上新加的叶子**同样成立（`probe-exe.ts` 只依赖
// `node:child_process`，于是链上不再跨惯例第二次）。
import {
  whichCommand,
  type UsabilityProbe,
  type WhichCommandOptions,
} from "./executable-resolve.ts";
import { pythonCandidates, pythonProbeArgs } from "./python-candidates.ts";
import type { ProbeFailure } from "./probe-exe.ts";

/** 「先试哪个名字、`py` 要不要带 `-3`」的**一份**实现，供各宿主直接起进程。 */
export type PythonResolution = {
  /** 启动它要带的**宿主参数**（`py` 的 `-3`；非 `py` 为空）。 */
  args: Array<string>;
  /** 命中的候选名（`python3` / `python` / `py`），用于日志与话术。 */
  command: string;
  /** PATH 上的绝对路径（Windows 上已按磁盘实际大小写改写）。 */
  path: string;
  /** 探针里候选的可读顺序，失败话术要照着它说「试过哪些」。 */
  tried: Array<string>;
};

/** 一个候选**为什么没被选中**（`findPython` 那一格要把它念出来）。 */
export type PythonMiss = {
  /** 候选名（`python3` / `python` / `py`）。 */
  command: string;
  /**
   * 失败形态：`PATH` 上没有这个名字时为 `spawn-error` / `ENOENT`，
   * 命中但起不来时是探针真的那个码（`EACCES` / `ENOEXEC` …）。
   */
  failure: ProbeFailure;
};

/** `resolvePython()` 的入参 —— 与 `WhichCommandOptions` 同形，探针可注入。 */
export type ResolvePythonOptions = {
  /** 候选名（默认按平台取 `pythonCandidates()`）；单测用来钉住顺序。 */
  candidates?: Array<string>;
} & WhichCommandOptions;

/**
 * 挑一个**真能跑**的解释器；PATH 上一个都没有时返回 `null`。
 *
 * 判据分两层，与 `whichCommand` 同一份：先按候选名解析路径，再对该路径真起一次
 * `--version`。没有第二层就会选中 Windows 的 Microsoft Store 占位别名
 * （`python.exe` 在盘上、`--version` 退非零）—— 那正是「命令在、不是可用解释器」。
 *
 * `null` **不是**「这台机器没有 Python」的结论，而是「这条探针没找到」：
 * 调用方必须两条路分开（`malformed` 与 `missing` 的下一动作不同），
 * 别把两者糊成一句「去装个 Python」。
 */
export function resolvePython({
  candidates,
  env = process.env,
  platform = process.platform,
  probe,
}: ResolvePythonOptions = {}): PythonResolution | null {
  return findPython({ env, platform, ...(probe ? { probe } : {}), candidates }).hit;
}

/**
 * 同上，但**把「每个候选为什么没选中」一起交出去**。
 *
 * 为什么非要有这一半：`resolvePython()` 答 `null` 时，调用方手上只有「试过哪些名字」
 * 这一份清单，说不出**每一个**是因为什么 —— 而「机器上没有 Python」与「有一个同名
 * 的东西顶掉了它」的下一动作完全不同（前者去装，后者改探测）。`scripts/python-probe.mjs`
 * 打印的就是这一格，它的意义正是「两边读数并列，人一眼分得出是哪一边错」。
 *
 * `resolvePython()` 只 `return findPython(...).hit`：判据只有这一份（§12.12），
 * 两个出口的差别只是「要不要把过程读出来」。
 *
 * @returns `hit` 命中时为 `PythonResolution`，否则 `null`；`missed` 是逐候选的失败形态
 */
export function findPython({
  candidates,
  env = process.env,
  platform = process.platform,
  probe,
}: ResolvePythonOptions = {}): {
  hit: PythonResolution | null;
  missed: Array<PythonMiss>;
} {
  const tried = candidates ?? pythonCandidates(platform);
  const missed: Array<PythonMiss> = [];
  for (const name of tried) {
    const found = whichCommand(name, {
      env,
      platform,
      ...(probe ? { probe } : {}),
      /* **必须经 `pythonProbeArgs`，不能写裸的 `["--version"]`**：`py` 启动器上
       * 裸 `py --version` 是「列出已装版本」并退非零 —— 那正是 `whichCommand`
       * 会把它判成「不可用、继续往后找」的形态。硬编码的后果实测过（ISSUE #1961）：
       * 同一台节点上自证那一步（用的是正确的 `py -3 --version`）判「有 Python」、
       * 而这里判「没有」，两条探针在同一次构建里互相矛盾 —— 与 #1959 第二轮
       * 「两处各探一次、各判一次没有」是同一个病。
       *
       * 本函数 `return` 的那个 `args`（同样走 `pythonProbeArgs`）只能管**选中之后
       * 怎么起它**，管不了「选不选得中」：探针参数错了，`py` 在上一行就被跳过了。 */
      probeArgs: pythonProbeArgs(name, ["--version"]),
    });
    if (found) {
      return {
        hit: { args: pythonProbeArgs(name), command: name, path: found, tried },
        missed,
      };
    }
    /* 没选中：这个候选要么不在 PATH 上、要么在但起不来。两种都记成 `spawn-error`
     * —— 这正是**这一次**探测拿到的形态，而这里不再往下猜是哪一种（`whichCommand()`
     * 只回「能不能用」，判具体的 errno 要它再起一次，那是重复付费）。 */
    missed.push({
      command: name,
      failure: { code: "ENOENT", kind: "spawn-error" },
    });
  }
  return { hit: null, missed };
}

/** 「哪个候选答得上」的可注入探针（单测用来复算候选顺序，不必真装两个平台）。 */
export type { UsabilityProbe };
