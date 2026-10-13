/**
 * 「假 comfy-cli 怎么被起」的**唯一落点**（跨平台）。
 *
 * ## 它修的那一格
 *
 * 本应用只经 comfy-cli 执行任务：`executor-cli.ts` 起
 * `spawn(comfyCliPython, ["-m", "comfy_cli", "run", …])`。e2e 要让「出图」这条
 * 链路真跑通，就得让这个解释器起得来、且能 import 到我们的替身包。
 *
 * 此前这件事靠一份 POSIX shim（`e2e/support/fake-comfyui/python.sh`，本模块落地时已删除）实现：
 * 它只是 `PYTHONPATH=<替身目录> exec python3 "$@"`。这份 shim 在 Linux / macOS 上
 * 成立（内核认 shebang），而 **Windows 上必然起不来** —— Node 的 `spawn` 走
 * CreateProcess，只有 `.exe` 与经 cmd.exe 的 `.cmd` / `.bat` 会被执行，
 * `.sh` / `.ps1` / 无扩展名脚本一律 `EINVAL`/`ENOENT`（本仓库自己的判据见
 * `src/lib/process/executable-resolve.ts` 的文件头，硬规则 12 也据此禁 `.bat`/`.cmd`）。
 * 症状是**两条 `@critical` 主链路用例在 Windows 开发机上必红**，而报错话术在说
 * 「执行器收口失败」——真因是这一份替身根本没起来。
 *
 * ## 修法的取向：不 shim 解释器，改喂 `PYTHONPATH`
 *
 * shim 存在的唯一理由是「给子进程带上 `PYTHONPATH`」，而 `PYTHONPATH` 本来就是
 * 一个**环境变量**：直接从 `webServer.env` 喂下去即可。于是：
 *
 *   · `COMFY_CLI_PYTHON` = 一个**真**解释器（按平台探测，见 {@link pythonCandidates}）；
 *   · `PYTHONPATH` = 替身包所在目录（`comfy_cli/` 的父目录）；
 *   · 两个平台走**同一条**路径，没有任何需要 `fs.existsSync` 分叉的形态。
 *
 * 为什么可以给整个 Next server 进程加 `PYTHONPATH`：它只影响 Python 的模块解析，
 * 与 Next 自己的 import 无关；而 e2e 里除了这份替身不跑别的 Python——假 ComfyUI
 * 在 `/system_stats` 上应答，`resolveComfyBase()` 探得通，真件不会被自动拉起。
 */
import fs from "node:fs";
import path from "node:path";

import { whichCommand } from "../../src/lib/process/executable-resolve.ts";

/** 替身包所在目录：它的子目录 `comfy_cli/` 就是 `python -m comfy_cli` 要找的包。 */
export const FAKE_CLI_MODULE_ROOT = path.resolve(
  import.meta.dirname,
  "fake-comfyui",
);

/** 失败路径的触发词（ISSUE #1621 的第二个用例）。
 *
 *  假 comfy-cli 只看工作流里**有没有这个词**：有就回放失败序列。换成一个
 *  「只有这条用例才发得出」的哨兵而不是固定文案，是为了让「判据真的在判」可以
 *  反证 —— 从工作流里删掉这个词，那条用例必须转绿。 */
export const FAKE_CLI_FAIL_SENTINEL_KEY = "E2E_FAKE_CLI_FAIL_SENTINEL";
export const FAKE_CLI_FAIL_SENTINEL_VALUE = "E2E_FAKE_CLI_FAIL_SENTINEL";

/**
 * 可注入的可用性探针（`seed` 那几个用例要用它把「选中了谁」与「真起一次」分开）。
 * 形状取自 `executable-resolve.ts` 的 `UsabilityProbe`——这里不 import 那个类型，
 * 因为 `.mjs` 侧只需要它的结构（判据仍由 `whichCommand` 一处持有）。
 *
 * @typedef {{ access(candidate: string): void, spawn(candidate: string, args: string[]): string | null }} PythonProbe
 */

/** 应用侧读的解释器环境变量名（`comfyCliPython` 设置项的默认值来源）。 */
export const COMFY_CLI_PYTHON_KEY = "COMFY_CLI_PYTHON";

/**
 * 按平台给解释器候选名（**只给名字，PATH 上找不找得到由 `whichCommand` 判**）。
 *
 * 顺序即判据：Windows 上 `python` 是绝大多数安装器的落点（`python3` 往往根本
 * 没有），`py` 是官方启动器（装了 Store 版 Python 时常只有它）；POSIX 上反过来
 * `python3` 才是规范名（很多发行版没有裸 `python`）。这与
 * `src/lib/comfyui/launch-path.ts` 的 `POSIX`/`WIN32` 解释器候选同口径。
 *
 * @param {NodeJS.Platform} [platform]
 * @returns {string[]}
 */
export function pythonCandidates(platform = process.platform) {
  return platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
}

/**
 * 挑一个**真能跑**的解释器（绝对路径）；PATH 上一个都没有时返回 `null`。
 *
 * 抽成可注入 `platform` / `env` / `probe` 的纯函数，好让两个平台的候选顺序都能
 * 被逐条断言（开发机上造不出另一个平台的 PATH）。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: NodeJS.Platform,
 *   probe?: PythonProbe,
 * }} [options]
 * @returns {string | null}
 */
export function resolveFakeCliPython({
  env = process.env,
  platform = process.platform,
  probe,
} = {}) {
  for (const name of pythonCandidates(platform)) {
    const found = whichCommand(name, { env, platform, ...(probe ? { probe } : {}) });
    if (found) return found;
  }
  return null;
}

/**
 * 本模块给出的那份 `webServer.env` 补丁。
 *
 * 三种「给不出来」的分岔都必须说清（都在返回值里，调用方不需要再判一次）：
 *   · 替身包目录不在（浅克隆 / 有人删了）→ `env` 为空，且 `reason` 非空；
 *   · PATH 上没有可用的 Python → 同上。**没有它也不该让全套 e2e 起不来**
 *     （视觉档、冒烟档都不碰执行链路），缺件时主链路用例会按「执行器起不来」
 *     失败，报错指向这一行的 `reason`。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: NodeJS.Platform,
 *   probe?: PythonProbe,
 *   moduleRoot?: string,
 *   exists?: (p: string) => boolean,
 * }} [options]
 * @returns {{ env: Record<string, string>, reason: string | null, python: string | null }}
 */
export function fakeExecutorEnv({
  env = process.env,
  platform = process.platform,
  probe,
  moduleRoot = FAKE_CLI_MODULE_ROOT,
  exists = fs.existsSync,
} = {}) {
  /* 分隔符与 join 口径**跟着注入的 platform 走**，不跟宿主：这份模块存在的理由就是
   * 「两个平台同一条形状」可以在任一开发机上被判（判据是 `tests/e2e-fake-comfyui-executor-env.test.ts`）。
   * 用宿主 `path` 时，在 Windows 上判 `platform: "linux"` 会拼出反斜杠路径、
   * 注入的 `exists` 永不命中 ⇒ 那条形状判据实际只在 POSIX 上自证过。
   * 真实调用方不受影响：`platform` 缺省就是 `process.platform`，win32 拿 `path.win32`、
   * POSIX 拿 `path.posix`，与改动前逐字相同。 */
  const p = platform === "win32" ? path.win32 : path.posix;
  if (!exists(p.join(moduleRoot, "comfy_cli", "__main__.py"))) {
    return {
      env: {},
      reason: `假 comfy-cli 包不在：${p.join(moduleRoot, "comfy_cli")}`,
      python: null,
    };
  }
  const python = resolveFakeCliPython({ env, platform, ...(probe ? { probe } : {}) });
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
