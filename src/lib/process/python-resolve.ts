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
import { spawnSync } from "node:child_process";

import {
  whichCommand,
  type UsabilityProbe,
  type WhichCommandOptions,
} from "./executable-resolve.ts";
import { pythonCandidates, pythonProbeArgs } from "./python-candidates.ts";

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
  /**
   * 「拿这个名字**真起一次**，这台机器认它吗」—— `null` = 起得来
   * （与 `UsabilityProbe.spawn` 同形：返回 libuv 的错误码）。
   *
   * 默认 `spawnSync` 真起进程。注入口与 `probe` 同族：这一层问的是
   * 「CreateProcess 认不认这个名字」，而那个机制在单测里造不出来（见下）。
   */
  bareSpawn?: (command: string, args: string[]) => string | null;
}

/**
 * 默认的「拿裸名字真起一次」探针。
 *
 * **必须真起进程**：这一层要回答的正是「OS 认不认这个名字」，而本仓自己那份
 * 「PATH × PATHEXT 逐目录扫文件」（`whichCommand`）读不到 Windows 的应用执行别名
 * 与注册表 `App Paths` —— 用任何「查文件」的写法替换它，这一层就退化成第一层的副本
 * （而那正是本层要修的那个缺陷）。
 */
function bareSpawnDefault(command: string, args: string[]): string | null {
  const probe = spawnSync(command, args, {
    stdio: "ignore",
    windowsHide: true,
    timeout: 10_000,
  });
  return (
    (probe.error as NodeJS.ErrnoException | null | undefined)?.code ?? null
  );
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
  bareSpawn = bareSpawnDefault,
}: ResolvePythonOptions = {}): PythonResolution | null {
  const tried = candidates ?? pythonCandidates(platform);
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
        command: name,
        path: found,
        args: pythonProbeArgs(name),
        tried,
      };
    }
  }
  /* ── 第二层：PATH 上一个都扫不到时，问**操作系统自己**一次 ────────────────
   *
   * ## 为什么非要有这一层（ISSUE #1961 平台侧第八跑的现场）
   *
   * 平台侧实测过一个**同一台机器、相邻两个 stage 结论相反**的形态：
   * `Python 可用性`（`scripts/ci-toolchain-selfcheck.mjs --python-only` → `findPython`）
   * 绿（它退 0），而紧接着的 `E2E 关键流程` 说「PATH 上没有可用的 Python」并退 1。
   *
   * 根因是**同一个问题被两条探针回答**，而两条探针看的世界不是同一个：
   *   · 自证那一侧是 `spawnSync("python")` —— **裸名字**，交给 Windows 的
   *     CreateProcess 去解析，它会查「应用执行别名（App Execution Aliases）」
   *     与注册表 `App Paths`（`python.exe` 常常**只**经这两条被认得）；
   *   · 本函数此前**只有** `whichCommand` —— 那是本仓自己写的一份
   *     「PATH × PATHEXT 逐目录扫文件 + `fs.accessSync(X_OK)` + 真起绝对路径」，
   *     它**不看**上面那两个 Windows 机制。
   *
   * 于是「别名装出来的 python」在自证那侧答「有」、在本函数这侧答「没有」。两份都
   * 说得通，而人看到的是「上一步说我装好了、下一步说我没有」—— 且这一步红在整条
   * 流水线的**最后一个** stage 上（前面 30 个全绿）。
   *
   * ## 这一层是「问 OS」，不是「再扫一遍盘」
   *
   * 别名与 `App Paths` 都**不是**盘上的固定落点，扫盘扫不出来（这也是
   * `ci-toolchain-python.mjs` 的取证清单要列三类落点的原因）。能回答它们的只有
   * CreateProcess 自己 —— 也就是「拿这个名字真起一次」。
   *
   * ## 与第一层的语义差别（调用方必须知道）
   *
   * 这一层返回的 `path` 是**裸名字**：我们不知道它在盘上哪。`executor-cli.ts` 那类
   * 「Windows 上 `spawn` 不认 PATHEXT、必须给绝对路径」的消费方仍应走第一层；
   * 这一层的价值是**让结论与自证那一侧一致** ——「这个命令在这台机器上起得来」
   * 是同一个事实，不该有两份答案（§12.18）。
   */
  /* 注入了 `probe` 就是「在模拟这台机器」——那么**整条解析都不许碰宿主**。
   * 少了这一条，单测（`env: { PATH: 空目录 }` + 替身探针）会被宿主的真解释器
   * **穿透**：实测本层落地时 `e2e-fake-comfyui-executor-env` 两条「PATH 上一个
   * 都没有 ⇒ null」在 Linux 上当场翻红（宿主真有 `python3`），而那两条判的正是
   * 「找不到就说找不到」—— 判据被自己的宿主环境污染，在别的机器上会给出不一样的
   * 结论，比不判更坏。真机上 `probe` 不注入，生产形态逐字不变。 */
  if (probe !== undefined) return null;
  for (const name of tried) {
    const args = pythonProbeArgs(name, ["--version"]);
    if (bareSpawn(name, args) !== null) continue;
    return {
      command: name,
      path: name,
      args: name === "py" ? ["-3"] : [],
      tried,
    };
  }
  return null;
}

/** 「哪个候选答得上」的可注入探针（单测用来复算候选顺序，不必真装两个平台）。 */
export type { UsabilityProbe };
