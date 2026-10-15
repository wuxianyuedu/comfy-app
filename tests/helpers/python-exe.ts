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
 * 判据只有一条：**真起一次进程**（`<解释器> -c "import sys; sys.exit(0)"` 退出 0），
 * 而不是看 PATH 上有没有这个文件名 —— 同 `scripts/check-app-port-vectors.cjs` 的四态
 * 口径：命令**在**、只是非零退出（Windows 的 Store 占位别名 `python.exe` 就是它）与
 * 「压根没有」的下一动作完全不同，两者都不能算「可用」。
 *
 * 返回的是**可直接 spawn 的调用形状**（命令 + 前缀参数）而不是光秃秃一个名字：Windows 的
 * `py` 启动器不带 `-3` 时可能选到 Python 2，补 `-3` 这件事必须在**解析这一处**定下来，
 * 不能指望每个调用点自己记得（`scripts/setup-comfy-cli-venv.ps1` 的 `$venvArgs` 同理）。
 *
 * 解析结果按进程缓存：一次 `execFileSync` 约几十毫秒，而调用它的用例往往每条都要用。
 */
import { execFileSync } from "node:child_process";

/** 一次可用的 Python 调用：`command` + 必须前置的参数。 */
export interface PythonInvocation {
  /** 可执行文件名（落在 PATH 上）。 */
  command: string;
  /** 必须前置的参数（`py` 启动器是 `-3`；其余为空）。 */
  prefixArgs: string[];
}

/**
 * 候选顺序：POSIX 惯例优先，再回落 Windows 官方安装器的两个落点。
 *
 * `py` 是 Windows 官方启动器（装了 Store 版 Python 时常只有它），排最后是因为它
 * **不带 `-3` 时可能选到 Python 2** —— 由 `PREFIX_ARGS` 补上这一条。
 */
const CANDIDATES = ["python3", "python", "py"] as const;

/** 各候选必须前置的参数。 */
const PREFIX_ARGS: Record<(typeof CANDIDATES)[number], string[]> = {
  python3: [],
  python: [],
  py: ["-3"],
};

let resolved: PythonInvocation | null | undefined;

/**
 * 解析一个**真能跑**的 Python 调用形状。
 *
 * @returns 可用的调用形状；这台机器上一个都没有时返回 `null`（调用方按 `skipIf` 处理，
 *          不要用「PATH 上有这个文件名」冒充可用）
 */
export function resolvePython(): PythonInvocation | null {
  if (resolved !== undefined) return resolved;
  for (const candidate of CANDIDATES) {
    const prefixArgs = PREFIX_ARGS[candidate];
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
export function runPython(code: string, args: string[] = []): string {
  const py = resolvePython();
  if (!py) throw new Error("PATH 上没有可用的 Python（试过 python3 / python / py）");
  return execFileSync(py.command, [...py.prefixArgs, "-c", code, ...args], {
    encoding: "utf8",
  }).trim();
}
