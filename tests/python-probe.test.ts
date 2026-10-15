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
import { resolvePython } from "../src/lib/process/python-resolve";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 第二条链（`resolvePython`）的替身 —— **必须注入**：不注入时它会去问真机器，
 * 于是同一条用例在不同宿主上给出不同结论（这台机有 python3、那台机没有）。
 * 注入一个「永远答不到」的版本是本文件多数用例的基线。
 */
const noResolve = () => null;

/** 造一个「只有这些命令答得上」的世界（键是 `命令 + 参数` 的拼接）。 */
function fakeRun(ok: Record<string, string>) {
  return (cmd: string, args: string[]) => {
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
const CANDIDATES: readonly string[] =
  process.platform === "win32"
    ? ["python", "py", "python3"]
    : ["python3", "python"];

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
    expect(lines.some((l) => l.startsWith("ok") && l.includes("3.12.2"))).toBe(
      true,
    );
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
    const lines = probeLines({ run: fakeRun({ py: "Installed Pythons:" }), resolve: noResolve });
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
    expect(text).toContain(
      "node scripts/ci-toolchain-selfcheck.mjs --python-only",
    );
  });

  it("它不许自己再写一份候选表 —— 候选与探测都取自 `ci-toolchain-python.mjs`", () => {
    const src = readFileSync(
      path.join(ROOT, "scripts", "python-probe.mjs"),
      "utf8",
    );
    expect(src).toContain('from "./ci-toolchain-python.mjs"');
    expect(src).toContain("findPython");
    /* 反向：它自己**不许**起子进程（那等于绕过 `findPython`，在同一台机器上问出
     * 第二次答案）。`spawnSync` / `execFileSync` 出现在这里就是回潮形态。 */
    expect(src).not.toMatch(/from "node:child_process"/);
  });

  it("结论与自证那一侧一致：PATH 扫不到、但 OS 认得这个名字时必须答「有」", () => {
    /* 立案现场（ISSUE #1961 平台侧第八跑）：**同一台机器、相邻两个 stage 结论相反**
     * —— `Python 可用性`（自证侧 `findPython`，拿裸名字真起一次）退 0，而紧接着的
     * `E2E 关键流程`（`resolvePython` → `whichCommand`）说「PATH 上没有可用的
     * Python」并退 1，红在整条流水线的**最后一个** stage 上。
     *
     * 两个答案都说得通，分歧在两个探针看的不是同一个世界：Windows 上 `python.exe`
     * 常常**只**经「应用执行别名」或注册表 `App Paths` 被认得，而 `whichCommand`
     * 是本仓自己写的「PATH × PATHEXT 逐目录扫文件」，它不看这两个机制。
     *
     * 真实机型上造不出这两个机制，所以这里把「OS 认不认」注入进来判**第二层在不在**
     * ——少了它，`resolvePython` 就又一次只认自己那份扫描结果。 */
    const aliasOnly = (cmd: string, args: string[]): string | null => {
      void args;
      // 模拟「别名：拿这个名字真起一次起得来」，而 PATH 目录里一个文件都没有。
      return cmd === "python" ? null : "ENOENT";
    };
    expect(
      resolvePython({ candidates: ["python"], bareSpawn: aliasOnly }),
    ).toMatchObject({ command: "python", path: "python" });
    // 反方向：OS 也不认时必须是 null（否则判据会逼人把「没有」读成「有」）。
    expect(
      resolvePython({ candidates: ["python"], bareSpawn: () => "ENOENT" }),
    ).toBeNull();
  });

  it("第二层不许被「注入探针」穿透 —— 那是单测在模拟这台机器", () => {
    /* 判据自己踩过一次：第二层接上后，`e2e-fake-comfyui-executor-env` 两条
     * 「PATH 上一个都没有 ⇒ null」在 Linux 上当场翻红 —— 宿主真有 `python3`，
     * 而用例注入的是一个空目录 + 替身探针。判据被自己的宿主环境污染，比不判更坏：
     * 它在别的机器上会给出不一样的结论。所以「注入了 probe」= 不碰宿主。 */
    expect(
      resolvePython({
        candidates: ["python"],
        probe: {
          // 「这条路根本不该被走到」：走到就抛，比空实现更能证明判据在拦它。
          access: () => {
            throw new Error("注入了 probe 时不许再碰宿主");
          },
          spawn: () => null,
        },
      }),
    ).toBeNull();
  });

  it("两条链的结论**并列**打出来 —— 只看一边分不出是哪一边错", () => {
    /* 立案现场（ISSUE #1961）：`Python 可用性`（裸名字那条链）绿、`E2E 关键流程`
     * （`resolvePython` 那条链）报「没有 Python」。只看一边的日志，人根本不知道
     * 还有另一条链、更不知道哪边对。所以这一节必须**总是**打出来。 */
    const lines = probeLines({ run: fakeRun({}), resolve: noResolve });
    const text = lines.join("\n");
    expect(text).toContain("resolvePython（手工扫 PATH × PATHEXT）:");
    // 第二条链落空时，逐候选点名「手工扫不到 / 起不来」。
    for (const name of CANDIDATES) {
      expect(
        lines.some((l) => l.startsWith("--") && l.includes(name)),
        `${name} 在第二条链上没有结论`,
      ).toBe(true);
    }
    // 两条链可能给出**相反**结论，这一句就是那一格的指路牌。
    expect(text).toContain("两条链对同一台机器给了相反结论");
  });

  it("第二条链命中时打出它的命令与绝对路径", () => {
    const lines = probeLines({
      run: fakeRun({}),
      resolve: () => ({
        command: "py",
        path: "C:\\Windows\\py.exe",
        args: ["-3"],
      }),
    });
    const text = lines.join("\n");
    expect(text).toContain("py -3");
    expect(text).toContain("C:\\Windows\\py.exe");
    // 命中了就不该再打「相反结论」那句 —— 否则它会变成一句恒真的噪音。
    expect(text).not.toContain("两条链对同一台机器给了相反结论");
  });

  it("探「哪些候选」是可注入的 —— `findPython` 的候选表因此没有第二份", () => {
    const src = readFileSync(
      path.join(ROOT, "scripts", "ci-toolchain-python.mjs"),
      "utf8",
    );
    // 两个入参（探谁、每个带什么参数）是 `probeLines` 复用同一份实现的依据。
    expect(src).toMatch(/candidates = PY_CANDIDATES/);
    expect(src).toMatch(/probeArgs = PY_PROBE_ARGS/);
  });
});
