/** 「怎么在这台机器上起一个 Python」的唯一判据。Windows 安装器只落 `python.exe`/`py.exe`，没有 `python3`，
 * 硬编码它会在自托管节点直接 ENOENT（两组用例整组红且报错不指向原因）。候选表与 `py -3` 形态只在
 * `src/lib/process/python-candidates.ts` 定义（ISSUE #1959 已因四处各写漂移过一次）；判据是**真起一次**
 * 进程（`-c "import sys; sys.exit(0)"` 退 0，而非 PATH 查名），返回调用形状（命令+前缀，`py` 需补 `-3`）。 */
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
 * @returns 可用的调用形状；一个都没有时返回 `null`（调用方按 `skipIf` 处理，不要用
 *          「PATH 上有这个文件名」冒充可用）
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
 * 这台机器上有没有能跑的 Python（**已解析**，不是「PATH 上有这个文件名」）。给用例当 `skipIf` 守卫：
 * 本仓对「机器缺 Python」的既有处置是 `env` 档跳过并登记（`check-file-structure.test.ts` 的 `!python`
 * 4 条，见 `conditional-skip-registry.test.ts`），而不是让流水线红 —— 登记表就是「看得见」。
 */
export function hasPython(): boolean {
  return resolvePython() !== null;
}

/** 跑一段 Python 代码，返回 stdout（`encoding: "utf8"`，已 `trim`）。把「解析 + 补 `-3` + 收 stdout」
 * 收成一处，调用点只写 `-c` 那段代码。
 * @param code `-c` 接的代码
 * @param args 追加的位置参数（`sys.argv[1:]`）；@returns 解释器 stdout（已去首尾空白）
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
