/**
 * tests/helpers/python-exe.ts — 「怎么在这台机器上起一个 Python」的唯一判据。
 *
 * 为什么要有这一份：本仓库有一批判据拿 Python 做**独立验证端**（zipfile 验包 —— 它是
 * 最严格的解压端，Bad CRC-32 当场报；`win32-window-focus.py` 的判决表桩）。它们原先各自
 * 硬编码 `"python3"`，而 Windows 上官方安装器只落 `python.exe` / `py.exe`，**没有
 * `python3`** —— 实测自托管 Windows 构建节点上，`execFileSync("python3", …)` 直接
 * `spawnSync python3 ENOENT` 把 `log-run-layout` 与 `logs/diagnostics/route` 两组用例
 * 整组红掉，而报错一个字都不指向「这台机器上的解释器不叫 python3」。
 *
 * ## 候选表与「真起一次」都不在这里定义了
 *
 * 这一份原先自己写死了一份 `CANDIDATES = ["python3","python","py"]` —— 而
 * `src/lib/process/python-candidates.ts` 是同一个问题的**唯一**答案（门禁脚本、
 * 流水线的工具链自证、e2e 夹具都从那儿取）。候选表与 `py -3` 的形态在四处各写一遍
 * 就必然漂移，而漂移的后果已经发生过一次（ISSUE #1959 第二轮首跑：流水线第一步
 * 探的面与门禁不是同一份）。所以这里只保留「测试视角」的那一层：给出**可直接
 * spawn 的调用形状**，并缓存它。
 *
 * 判据只有一条：**真起一次进程**（`<解释器> -c "import sys; sys.exit(0)"` 退出 0），
 * 而不是看 PATH 上有没有这个文件名 —— 同 `scripts/check-app-port-vectors.cjs` 的四态
 * 口径：命令**在**、只是非零退出（Windows 的 Store 占位别名 `python.exe` 就是它）与
 * 「压根没有」的下一动作完全不同，两者都不能算「可用」。
 *
 * 返回的是**调用形状**（命令 + 前缀参数）而不是光秃秃一个名字：`py` 启动器不带 `-3`
 * 时可能选到 Python 2，补 `-3` 这件事必须在**解析这一处**定下来，不能指望每个调用点
 * 自己记得（`scripts/setup-comfy-cli-venv.ps1` 的 `$venvArgs` 同理）。
 */
import { execFileSync } from "node:child_process";

import { pythonCandidates, pythonProbeArgs } from "../../src/lib/process/python-candidates";

/** 一次可用的 Python 调用：`command` + 必须前置的参数。 */
export type PythonInvocation = {
  /** 可执行文件名（落在 PATH 上）。 */
  command: string;
  /** 必须前置的参数（`py` 启动器是 `-3`；其余为空）。 */
  prefixArgs: Array<string>;
};

let resolved: PythonInvocation | null | undefined;

/**
 * 解析一个**真能跑**的 Python 调用形状。
 *
 * @returns 可用的调用形状；这台机器上一个都没有时返回 `null`（调用方按 `skipIf` 处理，
 *          不要用「PATH 上有这个文件名」冒充可用）
 */
export function resolvePython(): PythonInvocation | null {
  if (resolved !== undefined) {
    return resolved;
  }
  for (const candidate of pythonCandidates()) {
    const prefixArgs = pythonProbeArgs(candidate);
    try {
      execFileSync(candidate, [...prefixArgs, "-c", "import sys; sys.exit(0)"], {
        stdio: "ignore",
      });
      resolved = { command: candidate, prefixArgs };
      return resolved;
    } catch {
      // 试下一个候选（不存在、或存在但起不来 —— 两种都换）
    }
  }
  resolved = null;
  return resolved;
}

/**
 * 这台机器上有没有能跑的 Python（**已解析**，不是「PATH 上有这个文件名」）。
 *
 * 给需要它的用例当 `skipIf` 守卫用：本仓对「机器缺 Python」这一档的既有处置就是
 * `env` 档跳过并登记（`tests/check-file-structure.test.ts` 的 `!python` 那 4 条，
 * 见 `tests/conditional-skip-registry.test.ts`）——**不是**让流水线红。
 * 环境缺口要的是「看得见」，而 skip 登记表就是那个「看得见」。
 */
export function hasPython(): boolean {
  return resolvePython() !== null;
}

/**
 * 跑一段 Python 代码，返回 stdout（`encoding: "utf8"`，已 `trim`）。
 *
 * 把「解析 + 补 `-3` + 收 stdout」收成一处，调用点只写 `-c` 那段代码 —— 各处的
 * `execFileSync(python, ["-c", …])` 正是原先写死 `"python3"` 的那几处。
 *
 * @param code `-c` 接的代码
 * @param args 追加给脚本的位置参数（`sys.argv[1:]`）
 * @returns 解释器的 stdout（已去首尾空白）
 */
export function runPython(code: string, args: Array<string> = []): string {
  const py = resolvePython();
  if (!py) {
    throw new Error(`PATH 上没有可用的 Python（试过 ${pythonCandidates().join(" / ")}）`);
  }
  return execFileSync(py.command, [...py.prefixArgs, "-c", code, ...args], {
    encoding: "utf8",
  }).trim();
}
