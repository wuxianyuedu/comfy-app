// ── 「这台机器上的 Python 解释器叫什么名字」的唯一判据（Node 侧，纯函数）──────
//
// 三处曾经各写一份候选名，`check-app-port-vectors.cjs` 只探 `["python3","python"]`、
// 流水线的「工具链自证」又写成裸的一行 `python -V` —— 而 Windows 官方安装器落的是
// `python.exe` / `py.exe`，`python3` 往往**根本不存在**。于是同一台机器上：
// 门禁那一侧把 Python 归进 `missing` 档**静默退出四侧比对**，自证那一步却红得与
// 「压根没装」逐字同形（ISSUE #1959 第二轮首跑现场），而红的理由与它要回答的问题无关。
//
// 判据只能有一处（硬规则 24）：本模块给出**候选名与顺序**，「它到底起不起得来」
// 交给同域的 `executable-resolve.ts` —— 那两个问题是两件事，本模块不重复实现后者。

// **必须带 `.ts` 后缀**：本模块被 `e2e/support/preflight-python.mjs` /
// `fake-comfyui-executor-env.mjs` 直接静态 import（Node 24 的类型擦除），
// 而 Node 的 ESM 解析器**不认**无后缀的相对说明符 —— 少了它整条 `e2e` stage
// 会在加载期就 `ERR_MODULE_NOT_FOUND` 退 1（平台侧实测 897ms 崩在
// `src/lib/process/executable-resolve`）。`tsc` / vitest 走 bundler 解析，
// 无后缀照样绿 —— 所以这一格只有真跑一次 `.mjs` 才照得出来。
//
// 判据本身搬去了**叶子模块** `./platform.ts`（它零 import）：这样这条链上
// 就没有需要跨「TS 侧省略扩展名 / `.mjs` 侧必须带」这条惯例边界的边 ——
// 那正是上面那格反复踩的形态（ISSUE #1961）。
import { isWindows } from "./platform.ts";

/**
 * 按平台给解释器候选名（**只给名字**，PATH 上找不找得到由 `whichCommand` 判）。
 *
 * 顺序取自「哪个名字最可能真在那儿」，不是偏好：
 *   · Windows —— 官方安装器的落点是 `python.exe`；装了 Store 版时常常**只有** `py`
 *     启动器；`python3` 在 Windows 上多半只是个占位别名。因此把 `py` 排在 `python3`
 *     之前，且判「可用」时它必须带 `-3`（裸 `py` 是「列出已装版本」并退非零）。
 *   · POSIX —— `python3` 才是规范名（多数发行版没有裸 `python`），顺序相反。
 *
 * 与 `src/lib/comfyui/launch-path.ts` 的 `WIN32` / `POSIX` 候选**不是同一件事**：
 * 那里解析的是 ComfyUI 自带环境的解释器（绝对路径，`python_embeded/python.exe`），
 * 这里解析的是**宿主 PATH 上那个通用解释器**（门禁自检、`python -m comfy_cli`）。
 * 两者只是恰好共用「先 `python3` 还是先 `python`」这条常识。
 */
export function pythonCandidates(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return isWindows(platform)
    ? ["python", "py", "python3"]
    : ["python3", "python"];
}

/**
 * 启动候选所需要的参数。
 *
 * `py` 单独一条：PowerShell / cmd 里裸 `py` 是「列出已装版本」并退非零 —— 那正是
 * 「命令在、不是可用解释器」的形态（本仓 `probeCommand` 的 `present-but-nonzero`），
 * 拿它当「装好了 Python」是句假话。带 `-3` 才是在选一个解释器。
 */
export function pythonProbeArgs(
  candidate: string,
  args: string[] = [],
): string[] {
  return candidate === "py" ? ["-3", ...args] : args;
}
