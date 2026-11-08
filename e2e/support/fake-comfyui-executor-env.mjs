/**
 * 「假 comfy-cli 怎么被起」的唯一落点（跨平台）。本应用只经 comfy-cli 执行任务：`executor-cli.ts` 起 `spawn(comfyCliPython,
 * ["-m", "comfy_cli", "run", …])`。旧 POSIX shim（`fake-comfyui/python.sh`，已删）在 Windows 必然起不来（Node `spawn` 只认 `.exe` 与经 cmd.exe 的 `.cmd`/`.bat`，
 * 见 `executable-resolve.ts`、硬规则 12），两条 `@critical` 主链路在开发机必红。修法：不 shim，直接喂 `PYTHONPATH`（只影响 Python 模块解析）。
 */
import fs from "node:fs";
import path from "node:path";

import { pythonCandidates as sharedPythonCandidates } from "../../src/lib/process/python-candidates.ts";
import { resolvePython } from "../../src/lib/process/python-resolve.ts";

/** 替身包所在目录：它的子目录 `comfy_cli/` 就是 `python -m comfy_cli` 要找的包。 */
export const FAKE_CLI_MODULE_ROOT = path.resolve(import.meta.dirname, "fake-comfyui");

/** 失败路径的触发词（ISSUE #1621 的第二个用例）。
 *
 *  假 comfy-cli 只看工作流里**有没有这个词**：有就回放失败序列。换成一个
 *  「只有这条用例才发得出」的哨兵而不是固定文案，是为了让「判据真的在判」可以
 *  反证 —— 从工作流里删掉这个词，那条用例必须转绿。 */
export const FAKE_CLI_FAIL_SENTINEL_KEY = "E2E_FAKE_CLI_FAIL_SENTINEL";
export const FAKE_CLI_FAIL_SENTINEL_VALUE = "E2E_FAKE_CLI_FAIL_SENTINEL";

/**
 * 可注入的可用性探针（`seed` 用例用它把「选中了谁」与「真起一次」分开）。形状取自 `executable-resolve.ts` 的
 * `UsabilityProbe`，这里不 import 那个类型：`.mjs` 侧只需要结构（判据仍由 `whichCommand` / `resolvePython` 持有）。
 * @typedef {{ access(candidate: string): void, spawn(candidate: string, args: string[]): string | null }} PythonProbe
 */

/** 应用侧读的解释器环境变量名（`comfyCliPython` 设置项的默认值来源）。 */
export const COMFY_CLI_PYTHON_KEY = "COMFY_CLI_PYTHON";

/**
 * 按平台给解释器候选名 —— **转发** `src/lib/process/python-candidates.ts`。此前这里自己写一份、门禁脚本与
 * 「工具链自证」各又写一份，三份在「`python` 还是 `python3` 先试」「`py` 要不要带 `-3`」上必然漂移
 * （ISSUE #1959 第二轮首跑现场）。复用在先（硬规则 24）：候选表与启动参数只有那一处。
 * @param {NodeJS.Platform} [platform] @returns {string[]} */
export function pythonCandidates(platform = process.platform) {
  return sharedPythonCandidates(platform);
}

/**
 * 挑一个**真能跑**的解释器（绝对路径）；PATH 上一个都没有时返回 `null`。转发 `src/lib/process/python-resolve.ts` ——
 * 候选顺序、`py` 的 `-3`、「真起一次确认」都在那一份里；本模块只保留 e2e 需要的形状（`probe` 可注入，逐条断言候选顺序）。
 * @param {{env?: Record<string, string | undefined>, platform?: NodeJS.Platform, probe?: PythonProbe}} [options] @returns {string | null}
 */
export function resolveFakeCliPython({
  env = process.env,
  platform = process.platform,
  probe,
} = {}) {
  /* 每次调用都按这次注入的探针重新解析（`whichCommand` 不再做进程内记忆化，
   * ISSUE #3327），拿不同的假探针问同一条 PATH 不会读到上一条的结论。 */
  const hit = resolvePython({
    env,
    platform,
    ...(probe ? { probe } : {}),
  });
  return hit?.path ?? null;
}

/**
 * 本模块给出的那份 `webServer.env` 补丁。三种「给不出来」都在返回值里说清：替身包目录不在（浅克隆 / 被删）→ `env` 空且 `reason` 非空；
 * PATH 上没有可用 Python → 同上。缺件不该让全套 e2e 起不来（视觉档、冒烟档都不碰执行链路），主链路用例按 `reason` 指向这一行。
 * @param {{env?: Record<string, string | undefined>, platform?: NodeJS.Platform, probe?: PythonProbe, moduleRoot?: string, exists?: (p: string) => boolean}} [options] @returns {{env: Record<string, string>, reason: string | null, python: string | null}}
 */
export function fakeExecutorEnv({
  env = process.env,
  platform = process.platform,
  probe,
  moduleRoot = FAKE_CLI_MODULE_ROOT,
  exists = fs.existsSync,
} = {}) {
  /* 分隔符与 join 口径**跟着注入的 platform 走**，不跟宿主：这份模块存在的理由就是「两个平台同一形状」可在任一开发机上被判
   * （判据 `tests/e2e-fake-comfyui-executor-env.test.ts`）。用宿主 `path` 时在 Windows 上判 `platform: "linux"` 会拼出反斜杠、
   * 注入的 `exists` 永不命中 ⇒ 形状判据只在 POSIX 自证过。真实调用方不受影响：`platform` 缺省 `process.platform`。 */
  const p = platform === "win32" ? path.win32 : path.posix;
  if (!exists(p.join(moduleRoot, "comfy_cli", "__main__.py"))) {
    return {
      env: {},
      reason: `假 comfy-cli 包不在：${p.join(moduleRoot, "comfy_cli")}`,
      python: null,
    };
  }
  const python = resolveFakeCliPython({
    env,
    platform,
    ...(probe ? { probe } : {}),
  });
  if (!python) {
    return {
      env: {},
      reason:
        `PATH 上找不到可用的 Python（试过 ${pythonCandidates(platform).join(" / ")}）` +
        "—— 主链路的出图用例会按「执行器起不来」失败",
      python: null,
    };
  }
  /* `PYTHONPATH` **前缀**而不是覆盖：调用方（或用户的 shell）可能已经设了它，
   * 覆盖会连带掐掉别人的模块解析。分隔符按**注入的 platform**给（win32 是 `;`、
   * POSIX 是 `:`），不是按跑起来的宿主 —— 理由见上面那颗 `p`。 */
  const existing = env.PYTHONPATH ? `${p.delimiter}${env.PYTHONPATH}` : "";
  return {
    env: {
      [COMFY_CLI_PYTHON_KEY]: python,
      PYTHONPATH: `${moduleRoot}${existing}`,
      [FAKE_CLI_FAIL_SENTINEL_KEY]: FAKE_CLI_FAIL_SENTINEL_VALUE,
    },
    reason: null,
    python,
  };
}
