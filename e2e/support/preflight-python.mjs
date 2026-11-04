/**
 * 起 Playwright 之前先判「这一档要用的 Python 在吗、是哪一个」（ISSUE #1959 第四轮，e2e 侧）：判据本体在 `src/lib/process/python-*`（§12.18），本模块只做两件独有的事 —— 把「用哪一个解释器」定死成**绝对路径**，并把它说成一句带下一动作的话。
 * 绝对路径非做不可：应用侧直接 `spawn(comfyCliPython, …)`，Windows 上 Node 不认 PATHEXT，裸名字必然 ENOENT；那一档只在「生产构建 + start」暴露，正是平台侧 E2E。
 * 此前 reason 只落在 Playwright 自己的 worker stdout 里（`pnpm test:e2e` 一句话不提它），于是两条 `@critical` 用例各报一遍同一件事，看不出「这是一件事」。
 */
import { spawnSync } from "node:child_process";

import { whichCommand } from "../../src/lib/process/executable-resolve.ts";
import { pythonCandidates, pythonProbeArgs } from "../../src/lib/process/python-candidates.ts";
import { resolvePython } from "../../src/lib/process/python-resolve.ts";

/** 承载这一份判决的环境变量键（`e2e-run.mjs` 写、`playwright.config.ts` 读）。 */
export const PYTHON_PREFLIGHT_ENV_KEY = "E2E_PYTHON_PREFLIGHT";

/**
 * 判「这一档要用的 Python 在不在」；三处可注入（`env` / `platform` / `probe`）与 `resolvePython` / `whichCommand` 同形，让「另一个平台上的判决」在本机也能被钉住。
 * @param {{env?: Record<string, string | undefined>, platform?: NodeJS.Platform, resolve?: ((options: object) => {command: string, path: string, args: string[]} | null), which?: ((命令名: string, 选项: { probeArgs?: string[], env?: Record<string, string | undefined>, platform?: NodeJS.Platform }) => string | null), bareSpawn?: ((command: string, args: string[]) => string | null)}} [options]
 * @returns {{verdict: "ready" | "missing", interpreter: string | null, detail: string, evidence?: string[]}}
 */
export function checkPythonReady(options = {}) {
  const {
    env = process.env,
    platform = process.platform,
    resolve = resolvePython,
    which = whichCommand,
    bareSpawn = bareSpawnDefault,
  } = options;
  const found = resolve({ env, platform });
  if (!found) {
    return {
      verdict: "missing",
      interpreter: null,
      detail:
        `PATH 上没有可用的 Python（试过 ${pythonCandidates(platform).join(" / ")}）` +
        "—— 主链路的出图用例会按「执行器起不来」失败，而报错不会指向这一行",
      /* 两条链各自的结论（ISSUE #1961）：`resolvePython`（手工扫 PATH × PATHEXT）说「没有」时，
       * 问题常不在「这台机真没有」，而在两个探针看的不是同一个世界（自证侧起裸名字、这侧逐目录扫）。
       * 这一步**只读不判**：不改 verdict，只让失败时的话从一句断言变成一份论据（`python-probe.mjs`
       * 是同一件事的全量版，在流水线最便宜的位置跑）。 */
      evidence: pythonEvidence({ env, platform, bareSpawn }),
    };
  }
  /* 再问一次 PATH 要**绝对路径**：`resolvePython` 给的那条按「探针能起起来」选，这里额外接受可注入
   * 的 `which`，好让「解析不到绝对路径」这一格在单测里能被钉住；解析不到则退回裸名字（不编路径）。
   * `probeArgs` **必须与 `resolvePython` 探它时同一组**（ISSUE #1961）：`py` 裸着跑退非零、只有
   * `py -3` 才是在选解释器；否则会按 `whichCommand` 缺省 `["--version"]` 重探，靠不含 probeArgs 的
   * 记忆化碰巧命中只是巧合。`found.args` 就是那组宿主参数，补上 `--version` 即同形。 */
  const absolute =
    which(found.command, {
      env,
      platform,
      probeArgs: [...found.args, "--version"],
    }) ?? found.path;
  const prefix = found.args.join(" ");
  return {
    verdict: "ready",
    interpreter: absolute,
    detail: `用 ${found.command}${prefix ? ` ${prefix}` : ""} → ${absolute}`,
  };
}

/**
 * 「缺件」时给人看的那段话（`e2e-run.mjs` 直接打印它）。与判决同源（§12.12）；出口写成一条能直接跑的命令 —— `scripts/ci-toolchain-selfcheck.mjs` 按平台挑安装器（Windows 是 `winget`）。
 * @param {{detail: string, evidence?: string[]}} preflight
 * @returns {string}
 */
export function describePythonMissing(preflight) {
  return [
    `[e2e] ✗ ${preflight.detail}`,
    /* 判决同源的**论据**（`checkPythonReady` 算好的）排在最前面：缺件时这一行通常是
     * 排障的全部线索，而「真没有」与「扫的那一侧漏了」在断言里同形。 */
    ...(preflight.evidence ?? []),
    "[e2e]   补它：node scripts/ci-toolchain-selfcheck.mjs   （缺 Python 的机器上跑一次，缺什么它自己装）",
    "[e2e]   全量读数：node scripts/python-probe.mjs   （两条链逐候选并列；本行判的是",
    "[e2e]         `resolvePython` 手工扫 PATH 那条，而「工具链自证 / Python 可用性」走的是",
    "[e2e]         起裸名字那条）",
    "[e2e]   跑下去的下场：两条 @critical 主链路用例各报一遍「执行器收口失败」，",
    "[e2e]   而真因是解释器不在 —— 一件事被报成了两条功能红。",
  ].join("\n");
}

/**
 * 把判决编码成一行 JSON，经 `E2E_PYTHON_PREFLIGHT` 交给 Playwright 子进程。与 `preflight-ports.mjs` 的 `encodePreflight` 同形（为什么走环境变量而不落盘，见那一份文件头）。
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
 * 读回判决。**读不出就当没有**（返回 `null`）而不是抛 —— 它让话术更准，不是判据的地基（手工 `pnpm exec playwright test` 时它根本不存在，那条路本来就该能跑）。
 * @param {string | undefined} raw
 * @returns {{verdict: string, interpreter: string | null} | null}
 */
export function decodePythonPreflight(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (parsed.verdict !== "ready" && parsed.verdict !== "missing") {
      return null;
    }
    return {
      verdict: parsed.verdict,
      interpreter: parsed.interpreter ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 「拿裸名字真起一次」——与 `ci-toolchain-python.mjs` 的 `findPython` 同一条语义（Windows 上交给 CreateProcess 解析名字），但只回答起没起得来、不选候选；它是「第二条链」（`resolvePython` 手工扫）的对照组：一边说「没有」而这边说「有」，就是两个探针看的不是同一个世界（ISSUE #1961）。
 * @param {string} command @param {string[]} args
 * @returns {string | null} 起得来返回 `null`，否则返回错误码
 */
function bareSpawnDefault(command, args) {
  const r = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
  /** `spawnSync` 的 error 是 Error 的运行时子类（`code` 由 libuv 填）。 */
  const code = /** @type {NodeJS.ErrnoException | null | undefined} */ (r.error)?.code;
  return code ?? null;
}

/**
 * 逐候选把**两条链**的结论各打一行（只读，供失败话术用）。
 * @param {{env?: Record<string, string | undefined>, platform?: NodeJS.Platform, bareSpawn?: (command: string, args: string[]) => string | null}} input
 * @returns {string[]}
 */
export function pythonEvidence({
  env = process.env,
  platform = process.platform,
  bareSpawn = bareSpawnDefault,
} = {}) {
  const lines = ["[e2e]   两条链的结论（排障用）："];
  /* ① 裸名字那一链（`findPython` 的语义）。Windows 上 `process.env.PATH` 是大小写不敏感的代理，而
   * `{ ...process.env }` 是普通对象、键名按 OS 写法（常是 `Path`）——「复制一份再传」会让 `env.PATH`
   * 变成 `undefined`，逐目录扫于是扫空 PATH。这一行就是那一格的读数：PATH 条目几条 / 见到的键写法。 */
  const pathEntries = String(env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
  lines.push(
    `[e2e]     env 里的 PATH：${pathEntries.length} 条${
      pathEntries.length === 0
        ? `（键写成 ${
            Object.keys(env)
              .filter((k) => k.toLowerCase() === "path")
              .join(" / ") || "一个都没有"
          }）`
        : ""
    }`,
  );
  for (const name of pythonCandidates(platform)) {
    const args = pythonProbeArgs(name, ["--version"]);
    const bare = bareSpawn(name, args) === null ? "裸名字起得来" : "裸名字起不来";
    lines.push(`[e2e]     ${name} ${args.join(" ")}：${bare}`);
  }
  return lines;
}
