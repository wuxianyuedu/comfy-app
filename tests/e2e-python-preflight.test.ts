/**
 * e2e 的 Python 前置（ISSUE #1959 第四轮）。假 comfy-cli 是**一个 Python 包**，主链路那条 `@critical` 用例要由 `COMFY_CLI_PYTHON` 指向的解释器把它 import 起来；缺解释器时此前只有 worker stdout 里一行 `⚠ 假 comfy-cli 未注入`，而人看到的是**两条**「执行器收口失败」的功能红——一件事被报成两条，且报错不指向真因。
 * 判据分三头：① 可用时给出**绝对路径**（`fakeExecutorEnv()` 交的是裸名字 `python` / `py`，应用侧直接 `spawn`，Windows 上 Node 不认 PATHEXT ⇒ 裸名字必然 ENOENT，而这一档只在「生产构建 + start」上暴露）；② 缺件时判红并给出能直接跑的出口（「不阻断地提个醒」等价于让两条主链路去跑一个注定红的结果，并把真因埋掉）。
 * ③ 接线在位：`scripts/e2e-run.mjs` 在起 Playwright 之前判，结论经 `E2E_PYTHON_PREFLIGHT` 带进 `playwright.config.ts`，且**读不出时退回原来的行为**（手工 `pnpm exec playwright test` 那条路不该被弄崩）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkPythonReady,
  decodePythonPreflight,
  describePythonMissing,
  encodePythonPreflight,
} from "../e2e/support/preflight-python.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 一次可用的假「候选命中」（形状取自 `resolvePython` 的返回值）。 */
const HIT = { command: "python", path: "/usr/bin/python3", args: [] };

describe("e2e Python 前置：可用时给出绝对路径", () => {
  it("解释器定死成绝对路径（应用侧 spawn 的是它，不是一个裸名字）", () => {
    const ready = checkPythonReady({
      platform: "win32",
      resolve: () => ({
        command: "python",
        path: String.raw`C:\Py\python.exe`,
        args: [],
      }),
      which: (name) => `C:\\Python312\\${name}.exe`,
    });
    expect(ready.verdict).toBe("ready");
    expect(ready.interpreter).toBe(String.raw`C:\Python312\python.exe`);
    // 话术里要报出「用了哪一个」——缺件时那行是唯一的排障线索，绿的时候同理。
    expect(ready.detail).toContain("python");
  });

  it("`py` 的 `-3` 前缀在话术里看得见（它决定选的是 Python 3）", () => {
    const ready = checkPythonReady({
      platform: "win32",
      resolve: () => ({
        command: "py",
        path: String.raw`C:\Windows\py.exe`,
        args: ["-3"],
      }),
      which: () => String.raw`C:\Windows\py.exe`,
    });
    expect(ready.detail).toContain("-3");
    expect(ready.interpreter).toBe(String.raw`C:\Windows\py.exe`);
  });

  it("`which` 解析不到时退回 `resolvePython` 给的那一条（不编一条不存在的路径）", () => {
    const ready = checkPythonReady({
      platform: "linux",
      resolve: () => HIT,
      which: () => null,
    });
    expect(ready.interpreter).toBe(HIT.path);
  });

  it("第二次问 PATH 时带上同一个 `-3`（`py` 裸着跑退非零）", () => {
    /* 立案现场（ISSUE #1961）：`py` 的可用判据是 `py -3 --version`，裸 `py` 是
     * 「列出已装版本」并退非零。第一处（`resolvePython`）修好而这里漏掉的话，
     * 这第二次 `whichCommand` 会按缺省 `["--version"]` 重探 —— 那次能过全靠
     * `whichCommand` 的记忆化键不含 `probeArgs`。判据不该建立在缓存顺序上。 */
    const calls: Array<{ args: Array<string>; name: string }> = [];
    const ready = checkPythonReady({
      platform: "win32",
      resolve: () => ({
        command: "py",
        path: String.raw`C:\Windows\py.exe`,
        args: ["-3"],
      }),
      which: (name, options) => {
        calls.push({ name, args: options?.probeArgs ?? [] });
        return String.raw`C:\Windows\py.exe`;
      },
    });
    expect(ready.verdict).toBe("ready");
    expect(calls).toEqual([{ name: "py", args: ["-3", "--version"] }]);
  });
});

describe("e2e Python 前置：缺件时判红并给出出口", () => {
  it("判红，且话术里点出「试过哪些候选」", () => {
    const missing = checkPythonReady({
      platform: "win32",
      resolve: () => null,
    });
    expect(missing.verdict).toBe("missing");
    expect(missing.interpreter).toBeNull();
    // 这一格唯一能排障的信息就是「试过哪些」——那台机器上的名字可能只是不一样。
    expect(missing.detail).toContain("python");
    expect(missing.detail).toContain("py");
  });

  it("出口是一条能直接跑的命令，并说清跑下去的下场", () => {
    const text = describePythonMissing({
      detail: checkPythonReady({ platform: "linux", resolve: () => null }).detail,
    });
    expect(text).toContain("scripts/ci-toolchain-selfcheck.mjs");
    expect(text).toContain("@critical");
  });
});

describe("e2e Python 前置：结论怎么带下去", () => {
  it("编码 / 解码往返一致", () => {
    expect(
      decodePythonPreflight(
        encodePythonPreflight({
          verdict: "ready",
          interpreter: "/usr/bin/python3",
        }),
      ),
    ).toEqual({ verdict: "ready", interpreter: "/usr/bin/python3" });
    expect(
      decodePythonPreflight(encodePythonPreflight({ verdict: "missing", interpreter: null })),
    ).toEqual({ verdict: "missing", interpreter: null });
  });

  it("读不出来时当「不知道」而不是崩（手工跑 Playwright 那条路）", () => {
    /* 手工 `pnpm exec playwright test` 时这个变量根本不存在 —— 那一格要退回
     * `fakeExecutorEnv()` 原来的行为，而不是把手工跑的那条路弄崩。 */
    expect(decodePythonPreflight(undefined)).toBeNull();
    expect(decodePythonPreflight("")).toBeNull();
    expect(decodePythonPreflight("不是 JSON")).toBeNull();
    expect(decodePythonPreflight('{"verdict":"也许"}')).toBeNull();
    expect(decodePythonPreflight('{"verdict":"ready"}')).toEqual({
      verdict: "ready",
      interpreter: null,
    });
  });
});

describe("接线在位（§13.5.12：判据要有人跑）", () => {
  it("`pnpm test:e2e` 在起 Playwright 之前判这一格，且判红不放行", () => {
    const text = readFileSync(path.join(ROOT, "scripts/e2e-run.mjs"), "utf8");
    /* 三处**判据本身**没搬（仍由 `checkPythonReady` / `encodePythonPreflight` /
     * `describePythonMissing` 各答一格），只是从 `main` 里三段就地 `await + return`
     * 收成了 `makePreflightCollectors().python()` 一步（ISSUE #1998：那三段此前
     * 排在短路之后，平台侧 36 分钟零行时连它们说没说话都读不出来）。
     * 所以判据认的是这三句**还在**，不是它们还写在 `main` 里。 */
    expect(text).toContain("const verdict = python({ env });");
    expect(text).toContain("env[PYTHON_PREFLIGHT_ENV_KEY] = encodePythonPreflight(verdict)");
    expect(text).toContain("describePythonMissing(verdict)");
    // 而且要真的被 `main` 编排上（写了不接等于没有）。
    expect(text).toContain("makePreflightCollectors({ env, cwd: ROOT })");
    expect(text).toContain("await runPreflightReadings(");
  });

  it("`playwright.config.ts` 真用上了那个绝对路径", () => {
    const text = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
    expect(text).toContain("decodePythonPreflight");
    expect(text).toMatch(/COMFY_CLI_PYTHON_KEY\]\s*=\s*pythonPreflight\.interpreter/);
  });

  it("（#3504 反向登记）E2E 执行面搬去 GA daily.yml；`.cnb.yml` 不许再有入口行", () => {
    /* Python 预检的**平台级前置格**（`--python-only`）随 #3504 整体退役：daily.yml 文件头
     * 「刻意不承接」清单写明 —— 自托管宿主机事实读数（每日 Python 可用性 / 探针读数 /
     * 工具链自证）不搬，GA runner 的工具链由镜像与 setup-* 钉死。判据本体没丢：它仍在
     * E2E 入口**内部**先跑（上面「`pnpm test:e2e` 在起 Playwright 之前判这一格，且判红不放行」
     * 那一格判着），顺序由构造保证，平台级早停格不再需要。
     * 这里钉两件事：E2E 的执行者在 GA daily.yml 里；`.cnb.yml`（剥掉整行注释，历史注释里
     * 提到名字不算执行者）两个入口行都不许回来。 */
    const daily = readFileSync(path.join(ROOT, ".github", "workflows", "daily.yml"), "utf8");
    const e2eAt = daily.indexOf("node scripts/e2e-run.mjs");
    expect(
      e2eAt,
      "GA daily.yml 里没有 E2E 那一步了 —— 判据失去执行者，等于把这条接线删了",
    ).toBeGreaterThanOrEqual(0);

    /* ⚠️ 命令形态钉在执行者所在的那份配置上：`--grep` 的值必须与开关连成一个 token（`=`）。
     * 写成空格（`--grep @critical`）时平台 runner 的命令行会把 `@` 开头的裸 token 吃掉，
     * Playwright 只收到没有值的 `--grep` —— 现场 `cnb-cdt-1k51s6mf1`：`error: option '-g, --grep <grep>'
     * argument missing`。今天 E2E 那一格不带 `--grep`（整档跑），这一句判的是**回潮时的形状**：
     * 谁把收窄加回来，必须用 `=` 连写。 */
    expect(
      daily,
      "E2E 那一步又写回了 `--grep @…`（空格那版）—— 平台命令行会吃掉那个 token",
    ).not.toMatch(/e2e-run\.mjs\s+--grep\s+\S/);

    const yml = readFileSync(path.join(ROOT, ".cnb.yml"), "utf8");
    const code = yml
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(
      code.match(/ci-toolchain-selfcheck\.mjs|e2e-run\.mjs/g) ?? [],
      "`.cnb.yml` 又出现工具链/E2E 入口行 —— 执行面已随 #3504 搬去 GA，CNB 只当触发入口",
    ).toHaveLength(0);
  });

  it("本机真跑一次（这台机器上有没有 Python 都合法，判的是形状不空转）", () => {
    /* 真起进程的那一档：有解释器时必须拿到一个绝对路径，没有时必须是 missing +
     * 一句带候选的说明。两条都不是「恒绿」——它是这台机器事实的读数。 */
    const real = checkPythonReady();
    expect(["ready", "missing"]).toContain(real.verdict);
    /* 两态收进期望值：ready ⇒ 解释器在且是绝对路径；missing ⇒ 说明点名 python ——
     * 两态都是这台机器的事实读数，断言本体无条件跑（no-conditional-expect）。 */
    expect(
      real.verdict === "ready"
        ? real.interpreter !== null && /[\\/]/.test(real.interpreter)
        : (real.detail ?? "").includes("python"),
    ).toBe(true);
  });
});
