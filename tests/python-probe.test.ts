/**
 * `scripts/python-probe.mjs` 的判据（ISSUE #1961）。
 *
 * ## 它答的是「论据」，不是「结论」
 *
 * 缺 Python 时那几条用例按既有口径走 `env` 档**跳过并登记**（`tests/helpers/python-exe.ts`
 * 的 `hasPython()`）—— 也就是说它们**不会让任何门禁变红**，缺件在日志里是隐身的。
 * `--python-only` 只答「门禁要的那个解释器在不在」，答不了「另外几个命令在哪」，
 * 而后者恰好是下一动作的分岔所在：
 *
 *   · `python` 起不来、`py` 起得来 —— 两者都是「有解释器」（`py` 是官方启动器，
 *     判据是 `py -3 --version`；裸 `py` 是「列出已装版本」并退非零）；
 *   · 三个都起不来、盘上找得到安装根 —— 「装过、这个执行账号 PATH 里没有它」；
 *   · 三个都起不来、安装根零命中 —— 才是「这台机真没装」。
 *
 * 两种情形在 `CommandNotFoundException` 里**逐字同形**，处置却相反（改 PATH vs 去装）。
 *
 * ## 判据只钉住「它不许自己再写一份候选表」
 *
 * 这本文件最容易烂的地方不是输出格式，而是**它自己去探了另一份候选**——那正是
 * #1959 第二轮红过的形态（同一步里探的面与门禁探的不是同一份）。所以判据盯的是
 * 结构：它必须走 `ci-toolchain-python.mjs` 的 `findPython`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { probeLines } from "../scripts/python-probe.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 第二条链（`resolvePython`）的替身 —— **必须注入**：不注入时它会去问真机器，
 * 于是同一条用例在不同宿主上给出不同结论（这台机有 python3、那台机没有）。
 * 注入一个「永远答不到」的版本是本文件多数用例的基线。
 */
const noResolve = () => null;

/** 造一个「只有这些命令答得上」的世界（键是 `命令 + 参数` 的拼接）。 */
function fakeRun(ok: Record<string, string>) {
  return (cmd: string, args: Array<string>) => {
    const key = [cmd, ...args].join(" ");
    const out = ok[key];
    return out === undefined ? { ok: false, out: "" } : { ok: true, out };
  };
}

/**
 * 候选名与顺序**按平台**取自 `ci-toolchain-python.mjs`（那里是唯一出处）——
 * 判据不能把期望值写成某一边的字面量，否则这条用例会随「跑判据的宿主」变红变绿
 * （§13.5.3.5.1 的第三类：把「这台宿主长什么样」写成恒真性质）。
 */
const CANDIDATES: ReadonlyArray<string> =
  process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];

describe("python-probe：逐个候选答「起不起得来」", () => {
  it("候选**全部**列出，可用的那几行带上版本号", () => {
    /* 「全报成功」的世界：每个候选的探针都答一句版本号。`py` 的判据是
     * `py -3 --version`（裸 `py` 是「列出已装版本」并退非零）。 */
    const ok = Object.fromEntries(
      CANDIDATES.map((name) => [
        [name, ...(name === "py" ? ["-3"] : []), "--version"].join(" "),
        "Python 3.12.2",
      ]),
    );
    const lines = probeLines({ run: fakeRun(ok), resolve: noResolve });
    for (const name of CANDIDATES) {
      // 每个候选都有一行结论 —— 「哪个不在」正是下一动作的一半。
      expect(
        lines.some((l) => l.includes(name)),
        `${name} 没有出现在读数里`,
      ).toBe(true);
    }
    // 可用的那一行打的是**带版本号**的读数（人要拿它在构建之间比对）。
    expect(lines.some((l) => l.startsWith("ok") && l.includes("3.12.2"))).toBe(true);
    expect(lines.join("\n")).toContain("门禁链要的解释器在这台机器上");
  });

  it("一个答得上的都没有时，逐个都记成不可用", () => {
    const lines = probeLines({ run: fakeRun({}), resolve: noResolve });
    const text = lines.join("\n");
    for (const name of CANDIDATES) {
      expect(
        lines.some((l) => l.startsWith("--") && l.includes(name)),
        `${name} 在「全部不可用」的世界里没有被点名`,
      ).toBe(true);
    }
    expect(text).toContain("一个可用解释器都没有");
  });

  it("`py` 的判据是 `py -3`，不是裸 `py`（裸 py 是「列出已装版本」并退非零）", () => {
    /* 只认裸 `py` 的世界：`py -3` 问不到 ⇒ **不许**把 `py` 算成可用。
     * 这一条在 Windows 上是它的存在理由；在 POSIX 上候选里没有 `py`，
     * 于是「裸 py 不算可用」这一条断言必然成立 —— 期望值取「不可用」，
     * 两个平台上都真。 */
    const lines = probeLines({
      run: fakeRun({ py: "Installed Pythons:" }),
      resolve: noResolve,
    });
    expect(
      lines.some((l) => l.startsWith("ok") && l.includes("py")),
      "裸 `py` 答得上不该被算成可用解释器",
    ).toBe(false);
  });

  it("一个都没有时接上取证（下一动作靠它，不靠猜）", () => {
    const lines = probeLines({ run: fakeRun({}), resolve: noResolve });
    const text = lines.join("\n");
    expect(text).toContain("一个可用解释器都没有");
    // 取证那份开头就在这句话上（`pythonForensics` 的唯一出处）。
    expect(text).toContain("python 探测现场");
    // 下一动作要能直接复制着跑。
    expect(text).toContain("node scripts/ci-toolchain-selfcheck.mjs --python-only");
  });

  it("它不许自己再写一份候选表 —— 候选与探测都取自 `ci-toolchain-python.mjs`", () => {
    const src = readFileSync(path.join(ROOT, "scripts", "python-probe.mjs"), "utf8");
    expect(src).toContain('from "./ci-toolchain-python.mjs"');
    expect(src).toContain("findPython");
    /* 反向：它自己**不许**起子进程（那等于绕过 `findPython`，在同一台机器上问出
     * 第二次答案）。`spawnSync` / `execFileSync` 出现在这里就是回潮形态。 */
    expect(src).not.toMatch(/from "node:child_process"/);
  });

  it("探「哪些候选」是可注入的 —— `findPython` 的候选表因此没有第二份", () => {
    const src = readFileSync(path.join(ROOT, "scripts", "ci-toolchain-python.mjs"), "utf8");
    // 两个入参（探谁、每个带什么参数）是 `probeLines` 复用同一份实现的依据。
    expect(src).toMatch(/candidates = PY_CANDIDATES/);
    expect(src).toMatch(/probeArgs = PY_PROBE_ARGS/);
  });
});
