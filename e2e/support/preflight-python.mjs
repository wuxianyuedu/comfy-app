/**
 * 起 Playwright **之前**一条判断：「这一档要用的 Python 在吗、是哪一个」。
 *
 * ## 它修的那一格（ISSUE #1959 第四轮，e2e 侧）
 *
 * 假 comfy-cli 是**一个 Python 包**：主链路（登录 → 建项目 → 出图）那条 `@critical`
 * 用例要由 `COMFY_CLI_PYTHON` 指向的解释器把它 import 起来。缺解释器时
 * `playwright.config.ts` 的 `fakeExecutorEnv()` 会返回一条 `reason`，而那条 reason
 * 此前**只出现在 Playwright 自己的 worker stdout 里**：
 *
 *   · `pnpm test:e2e`（`scripts/e2e-run.mjs`）从头到尾没有一句话提到它，
 *     人看到的是一批「执行器收口失败」的用例红；
 *   · 那两条 `@critical` 用例各自报一遍同一件事，看不出「这是一件事」。
 *
 * 判据本身**不在这里重写**（候选顺序、`py` 的 `-3`、真起一次确认可用这三件事都在
 * `src/lib/process/python-*` 那一份，§12.18）—— 本模块只做两件这里独有的事：
 *   ① 把「用哪一个解释器」**定死成绝对路径**；
 *   ② 把它说成一句人看得懂、且带下一动作的话。
 *
 * ## 为什么「定死成绝对路径」这一件非做不可
 *
 * `fakeExecutorEnv()` 交给应用的 `COMFY_CLI_PYTHON` 此前是个**裸名字**，而应用侧把它
 * 直接 `spawn`（`executor-cli.ts` → `spawn(comfyCliPython, ["-m", "comfy_cli", …])`）
 * —— Windows 上 Node 不认 PATHEXT，裸名字必然 ENOENT。那一档只在「生产构建 + start」
 * 上暴露，而平台侧 E2E 正是那一档。
 */
import { whichCommand } from "../../src/lib/process/executable-resolve.ts";
import { pythonCandidates } from "../../src/lib/process/python-candidates.ts";
import { resolvePython } from "../../src/lib/process/python-resolve.ts";

/** 承载这一份判决的环境变量键（`e2e-run.mjs` 写、`playwright.config.ts` 读）。 */
export const PYTHON_PREFLIGHT_ENV_KEY = "E2E_PYTHON_PREFLIGHT";

/**
 * 判「这一档要用的 Python 在不在」。
 *
 * 三处可注入（`env` / `platform` / `probe`）是为了让「另一个平台上的判决」在本机也能
 * 被钉住，注入口与 `resolvePython` / `whichCommand` 同形。
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   platform?: NodeJS.Platform,
 *   resolve?: ((options: object) => {command: string, path: string, args: string[]} | null),
 *   which?: ((命令名: string, 选项: { probeArgs?: string[], env?: Record<string, string | undefined>, platform?: NodeJS.Platform }) => string | null),
 * }} [options]
 * @returns {{verdict: "ready" | "missing", interpreter: string | null, detail: string}}
 */
export function checkPythonReady(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    resolve = resolvePython,
    which = whichCommand,
  } = options;
  const found = resolve({ env, platform });
  if (!found) {
    return {
      verdict: "missing",
      interpreter: null,
      detail:
        `PATH 上没有可用的 Python（试过 ${pythonCandidates(platform).join(" / ")}）` +
        "—— 主链路的出图用例会按「执行器起不来」失败，而报错不会指向这一行",
    };
  }
  /* 再问一次 PATH 要**绝对路径**：`resolvePython` 已经给了一个，但那一个是按「探针
   * 能起起来」选的；这里额外接受一个可注入的 `which`，好让「解析不到绝对路径」这一格
   * 在单测里能被钉住。解析不到时退回裸名字 —— 那总比没有强，也让话术里报的值与
   * 应用真正拿到的一致（不编一条不存在的路径出来）。
   *
   * `probeArgs` **必须与 `resolvePython` 探它时同一组**（ISSUE #1961）：`py` 启动器
   * 裸着跑退非零、只有 `py -3` 才是在选解释器。不给的话这里会按 `whichCommand` 的
   * 缺省 `["--version"]` 重探一次 —— 命中的那台机靠 `whichCommand` 的记忆化（键
   * 不含 `probeArgs`）碰巧读到上一条缓存才不出事，那是巧合不是判据。
   * `found.args` 就是那组宿主参数（`py` 是 `-3`），补上 `--version` 即同形。 */
  const absolute =
    which(found.command, {
      env,
      platform,
      probeArgs: [...(found.args ?? []), "--version"],
    }) ?? found.path;
  const prefix = (found.args ?? []).join(" ");
  return {
    verdict: "ready",
    interpreter: absolute ?? found.command,
    detail:
      `用 ${found.command}${prefix ? ` ${prefix}` : ""} → ` +
      `${absolute ?? "（PATH 上解析不到绝对路径，交回裸名字）"}`,
  };
}

/**
 * 「缺件」时给人看的那段话（`e2e-run.mjs` 直接打印它）。
 *
 * 与判决同源，改一处就够（§12.12）。出口写成一条**能直接跑**的命令 ——
 * `scripts/ci-toolchain-selfcheck.mjs` 会按平台挑安装器（Windows 是 `winget`）。
 *
 * @param {{detail: string}} preflight
 * @returns {string}
 */
export function describePythonMissing(preflight) {
  return [
    `[e2e] ✗ ${preflight.detail}`,
    "[e2e]   补它：node scripts/ci-toolchain-selfcheck.mjs   （缺 Python 的机器上跑一次，缺什么它自己装）",
    "[e2e]   排障：node scripts/python-probe.mjs   （打印**两条链各自**的结论 —— 本行判的是",
    "[e2e]         `resolvePython` 手工扫 PATH 那条，而「工具链自证 / Python 可用性」走的是",
    "[e2e]         起裸名字那条；两边不一致时它就是定位那件事的出口，流水线里挂在",
    "[e2e]         「Python 探针读数」那一步）",
    "[e2e]   跑下去的下场：两条 @critical 主链路用例各报一遍「执行器收口失败」，",
    "[e2e]   而真因是解释器不在 —— 一件事被报成了两条功能红。",
  ].join("\n");
}

/**
 * 把判决编码成一行 JSON，经 `E2E_PYTHON_PREFLIGHT` 交给 Playwright 子进程。
 *
 * 与 `preflight-ports.mjs` 的 `encodePreflight` 同形（为什么走环境变量而不落盘，
 * 那一份的文件头写着）。
 *
 * @param {{verdict: string, interpreter: string | null}} result
 * @returns {string}
 */
export function encodePythonPreflight(result) {
  return JSON.stringify({
    verdict: result.verdict,
    interpreter: result.interpreter ?? null,
  });
}

/**
 * 读回判决。**读不出就当没有**（返回 `null`）而不是抛 —— 它让话术更准，不是判据的
 * 地基（手工 `pnpm exec playwright test` 时它根本不存在，那条路本来就该能跑）。
 *
 * @param {string | undefined} raw
 * @returns {{verdict: string, interpreter: string | null} | null}
 */
export function decodePythonPreflight(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.verdict !== "ready" && parsed.verdict !== "missing") return null;
    return {
      verdict: parsed.verdict,
      interpreter: parsed.interpreter ?? null,
    };
  } catch {
    return null;
  }
}
