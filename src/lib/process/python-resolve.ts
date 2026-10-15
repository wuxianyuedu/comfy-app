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
import {
  whichCommand,
  type UsabilityProbe,
  type WhichCommandOptions,
} from "./executable-resolve.ts";
import { pythonCandidates } from "./python-candidates.ts";

/** 「先试哪个名字、`py` 要不要带 `-3`」的**一份**实现，供各宿主直接起进程。 */
export interface PythonResolution {
  /** 命中的候选名（`python3` / `python` / `py`），用于日志与话术。 */
  command: string;
  /** PATH 上的绝对路径（Windows 上已按磁盘实际大小写改写）。 */
  path: string;
  /** 启动它要带的**宿主参数**（`py` 的 `-3`；非 `py` 为空）。 */
  args: string[];
  /** 探针里候选的可读顺序，失败话术要照着它说「试过哪些」。 */
  tried: string[];
}

/** `resolvePython()` 的入参 —— 与 `WhichCommandOptions` 同形，探针可注入。 */
export interface ResolvePythonOptions extends WhichCommandOptions {
  /** 候选名（默认按平台取 `pythonCandidates()`）；单测用来钉住顺序。 */
  candidates?: string[];
}

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
  env = process.env,
  platform = process.platform,
  probe,
  candidates,
}: ResolvePythonOptions = {}): PythonResolution | null {
  const tried = candidates ?? pythonCandidates(platform);
  for (const name of tried) {
    const found = whichCommand(name, {
      env,
      platform,
      ...(probe ? { probe } : {}),
      probeArgs: ["--version"],
    });
    if (found) {
      return {
        command: name,
        path: found,
        args: name === "py" ? ["-3"] : [],
        tried,
      };
    }
  }
  return null;
}

/** 「哪个候选答得上」的可注入探针（单测用来复算候选顺序，不必真装两个平台）。 */
export type { UsabilityProbe };
