/**
 * 「拿不到测量」既不许被报成「四侧不一致」，也不许被当成绿（规范 §13.6.4.1 / 审查台账 R11-01）。
 *
 * 立案现场：一笔**纯文档**提交被 `scripts/check-app-port-vectors.cjs` 拦下，报
 * `[app-port-vectors] 四语言端口推导一致性失败：- Python 侧自检失败：spawnSync python3 ETIMEDOUT`，
 * 而同一条判据在钩子结束后**就地复跑退 0** —— 那不是内容红，是没拿到测量。
 * 旧实现有两处糊：① 子进程超时与真不一致塞进同一个 `problems`，于是标题那句在纯超时时也说得出嘴；
 * ② `hasCommand()` 用 `try/catch → false` 把「10 秒内没回答」与「这台机器没有 Python」糊成一件事，
 * 那一侧于是**既不参与比对也不报红**（静默漏报比报错误导得更久）。
 *
 * 第一刀（已合）只拆话术与分类，判定不放宽；本文件是**第二刀之后的形状**，口径由这条线拍板：
 * **让第二遍测量自己的形态说话**（不看 `os.loadavg()` —— Windows 恒 0，那条早就被 C 组否掉）：
 *   · 第一遍超时 ⇒ 当场再取证一次；第二遍答上了就按第二遍判（绿或真红照旧）；
 *   · 两遍都只是超时形态 ⇒ 「未校验」，**放行但点名**；
 *   · 探测不到 Python（`missing`）⇒ 同样「未校验」并点名，明说「四侧实际只答了三侧」——
 *     这一格以前是静默跳过，本文件把它变成会说话的；
 *   · 探测到命令但 `--version` 非零退出（`malformed`）⇒ **不是** `missing`：机器上有
 *     Python，只是这条探针不承认它的形态。第三刀补的正是这一格 —— 旧实现 `execFileSync`
 *     的失败只分「超时 / 其余」，其余一律 `missing`，于是这一侧被一句假话永久退出比对。
 *
 * 「放行」不是把红灯藏起来：放行的是**这一次取证**，判据本身还在 —— Node 侧逐条真跑与
 * Rust / PowerShell 侧的锁引用仍在同一趟里判，而 `missing` / 双超时都会被打出来。
 * 代价与触发面：只有第一遍超时才多花一趟（最坏 `PROBE_TIMEOUT_MS × 2 + PY_TIMEOUT_MS`）。
 *
 * **另有一条平台分叉**（ISSUE #1959）：其中一条要写 `#!/bin/sh` 的假命令 + `chmod`
 * 出执行位，这在 Windows 上不成立（libuv 不解析 shebang、`chmodSync` 不存执行位），
 * 所以经 `needsPosixExec` 只在 POSIX 上跑。判据**本身**是跨平台的
 * （`probeCommand` 对「不存在」「非零退出」的分支不依赖执行位）；另一条
 * （`present-but-nonzero`）原先用的是同一份 POSIX 夹具，现已改用两个平台都真能起的
 * `process.execPath`，**不再 skip** —— 那一格在 Windows 上照样成立，缺的只是可注入的形态。
 */
import { readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeControlFlow } from "./helpers/source-shape";

/**
 * 需要 POSIX 执行语义的用例开关：这条要写一个 `#!/bin/sh` 的假命令、再 `chmod`
 * 出执行位，而 Windows 上 libuv 不解析 shebang、`chmodSync` 也不存执行位 ——
 * 于是它探到的是 `missing`，红的形状与「判据写错了」逐字同形。
 *
 * 立案现场（ISSUE #1959）：它此前**没有**守卫，在 Linux 平台池上一直绿，
 * 所以没人发现它其实只在 POSIX 上成立。平台侧换成自托管 Windows 节点之后当场红了
 * —— 而那一跑证明的是「这条判据在 Windows 上从没被执行过」，不是「判据坏了」。
 * 与 `tests/dev-launcher-toolchain-gate.test.ts` 用的是同一条别名约定。
 */
const needsPosixExec = it.skipIf(process.platform === "win32");

/* 形态断言的对象是这个脚本的**控制流**，不是括号 —— 先过归一化，
 * oxlint `curly` 给单语句体补 `{}` 才不会把断言打成「判据写错了」。 */
const SCRIPT_SOURCE = normalizeControlFlow(
  readFileSync(path.resolve(__dirname, "../scripts/check-app-port-vectors.cjs"), "utf8"),
  "check-app-port-vectors.cjs",
);
// 判据脚本是 CJS（`@ts-nocheck`，require 进来是 any），按仓库惯例显式标注返回形状。
/* SAFETY: 类型断言已复核 */
// oxlint-disable-next-line typescript/no-require-imports
const judge = require("../scripts/check-app-port-vectors.cjs") as {
  decidePythonVerdict: (
    first: Measure,
    second: Measure | null,
  ) => { problems: Array<string>; unverified: Array<string> };
  isTimeoutLike: (e: unknown) => boolean;
  probeCommand: (cmd: string, args: Array<string>) => ProbeState;
};

/**
 * 命令探测的四态（`probeCommand` 的返回）。
 *
 * 第四档 `present-but-nonzero` 是这次补上的：旧实现只有三档，把「命令起来了、只是
 * `--version` 非零退出」静默归进 `missing`，于是 Python 侧被以「这台机器探测不到
 * Python」的名义退出四侧比对 —— 而那句话是假的。
 */
type ProbeState = "ok" | "timeout" | "missing" | "present-but-nonzero";

/** 一趟取证的返回形状（`measurePythonOnce` 的结果，也是本文件的输入夹具）。 */
type Measure = {
  problems: Array<string>;
  python: string | null;
  state: "answered" | "timeout" | "missing" | "malformed";
};

const answered = (problems: Array<string> = []): Measure => ({
  state: "answered",
  python: "python3",
  problems,
});
const timeout = (): Measure => ({
  state: "timeout",
  python: "python3",
  problems: [],
});
const missing = (): Measure => ({
  state: "missing",
  python: null,
  problems: [],
});
const malformed = (): Measure => ({
  state: "malformed",
  python: "python",
  problems: [],
});

describe("超时形状识别（execFileSync 带 timeout 的两种落法都要认）", () => {
  it("code=ETIMEDOUT 与 message 里带 ETIMEDOUT 都算「没拿到测量」", () => {
    expect(judge.isTimeoutLike({ code: "ETIMEDOUT", message: "spawnSync python3" })).toBe(true);
    // 实测那一发的报错形态：code 不在顶层，只在 message 里
    expect(judge.isTimeoutLike({ message: "spawnSync python3 ETIMEDOUT" })).toBe(true);
    expect(
      judge.isTimeoutLike({
        message: "Command failed: timed out after 30000ms",
      }),
    ).toBe(true);
  });

  it("真的执行失败 / 命令不存在都不算超时（否则真红会被读成「未校验」而放过去）", () => {
    expect(judge.isTimeoutLike({ code: "ENOENT", message: "python3 not found" })).toBe(false);
    expect(
      judge.isTimeoutLike({
        code: 1,
        message: "Python 侧自检未通过：MISMATCH a ≠ b",
      }),
    ).toBe(false);
    expect(judge.isTimeoutLike(null)).toBe(false);
    expect(judge.isTimeoutLike(undefined)).toBe(false);
  });
});

describe("命令探测分四态，不许糊成布尔", () => {
  it("不存在的命令报 missing（而不是 timeout）", () => {
    expect(judge.probeCommand("definitely-not-a-real-binary-xyz", ["--version"])).toBe("missing");
  });

  /* 「没有执行位」是**权限位**语义，而 Windows 的文件系统没有执行位（`chmodSync`
   * 在那里是空操作），于是这条夹具在 Windows 上测的不是同一件事：无扩展名的文件会被
   * `CreateProcess` 当作 `….exe` 去找、得到 ENOENT，判出的 `missing` 是巧合而不是
   * 被测形态。判据本身（EACCES 归 missing 的口径）由 `probeCommand` 的源码与
   * `scripts/check-app-port-vectors.cjs` 的注释持有，平台分叉只此一处。 */
  needsPosixExec(
    "没有执行位的文件同样归 missing（拿不到回答，下一步动作与「没有文件」同一件）",
    () => {
      const noexec = path.join(os.tmpdir(), `app-port-probe-noexec-${process.pid}`);
      writeFileSync(noexec, "#!/bin/sh\nexit 0\n");
      chmodSync(noexec, 0o644);
      try {
        expect(judge.probeCommand(noexec, ["--version"])).toBe("missing");
      } finally {
        rmSync(noexec, { force: true });
      }
    },
  );

  /* 这一格**不** skip：它判的是「命令在、只是非零退出」，而那个形态在 Windows 上照样
   * 存在 —— 缺的是「用 POSIX 才有的夹具造出来」这件事。探针命令取**跑测试自己的那个
   * Node**（`process.execPath`）并用 `-e` 立刻退 3，两个平台同形。
   *
   * 刻意**不用**「写一个带 shebang 的临时脚本」那形状：那份夹具的前提是 POSIX 内核认
   * shebang，而 Windows 的 `CreateProcess` 不认（无扩展名的文件会被当作 `…​.exe` 去找，
   * 得到 `ERROR_FILE_NOT_FOUND` ⇒ libuv 报 `ENOENT` ⇒ 探针判 `missing`）。实测这条用例
   * 在自托管 Windows 构建节点上正是这样红的 —— 红的是夹具，不是判据。 */
  it("命令在、只是非零退出 ⇒ present-but-nonzero，**不许**糊成 missing（ISSUE #1941）", () => {
    /* 真实形态：`execFileSync` 对这种失败给的是 `status !== 0` 而 `error.code === undefined`，
     * 与「命令不存在」的 `ENOENT` 完全不是一回事。旧实现只分「超时 / 其余」，
     * 于是这一格被读成「这台机器没有 Python」—— 一句假话，且给出的下一步动作也是错的。 */
    expect(judge.probeCommand(process.execPath, ["-e", "process.exit(3)"])).toBe(
      "present-but-nonzero",
    );
  });

  it("真的存在的解释器仍是 ok（四态没有把正常路径收窄）", () => {
    // python3 不在 PATH 上时这一格不成立 —— 那是机器的形状，不是判据的形状，
    // 所以只在探到 ok 时断言，没探到就跳过。
    if (judge.probeCommand("python3", ["--version"]) !== "ok") {
      return;
    }
    expect(judge.probeCommand("python3", ["--version"])).toBe("ok");
  });
});

describe("两遍取证的判决（decidePythonVerdict 全网格）", () => {
  it("第二遍答上了且没有不一致 ⇒ 绿，且**不留**未校验（不许把已取证的一侧继续点名）", () => {
    expect(judge.decidePythonVerdict(timeout(), answered())).toEqual({
      problems: [],
      unverified: [],
    });
  });

  it("第一遍答上了时第二遍根本不该参与（second=null 用第一遍说话）", () => {
    expect(judge.decidePythonVerdict(answered(), null)).toEqual({
      problems: [],
      unverified: [],
    });
  });

  it("真不一致进 problems，且**不许**同时被写成未校验（那会把红洗成「没测」）", () => {
    const bad = answered(["Python 侧自检未通过：MISMATCH a ≠ b"]);
    const out = judge.decidePythonVerdict(timeout(), bad);
    expect(out.problems).toEqual(["Python 侧自检未通过：MISMATCH a ≠ b"]);
    expect(out.unverified).toEqual([]);
  });

  it("两遍都只是超时 ⇒ 未校验一条、problems 为空（放行靠的是这一格不为空时不判红）", () => {
    const out = judge.decidePythonVerdict(timeout(), timeout());
    expect(out.problems).toEqual([]);
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toContain("两遍");
    expect(out.unverified[0]).toContain("拿不到测量");
    // 话术里必须把它与「四侧不一致」明确分开 —— 那正是当初误导人的那一句。
    expect(out.unverified[0]).toContain("不是「四侧推导不一致」");
  });

  it("只跑了一趟（second=null）而它是超时 ⇒ 仍然报「没拿到测量」，不许当绿", () => {
    const out = judge.decidePythonVerdict(timeout(), null);
    expect(out.problems).toEqual([]);
    expect(out.unverified).toHaveLength(1);
  });

  it("missing ⇒ 未校验并点名「四侧实际只答了三侧」—— 这一格以前是静默跳过", () => {
    const out = judge.decidePythonVerdict(missing(), null);
    expect(out.problems).toEqual([]);
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toContain("没有取证");
    expect(out.unverified[0]).toContain("三侧");
    // 不许把「探测不到」说成超时：两种话术的下一动作不同（装 Python vs 换台闲机器复跑）。
    expect(out.unverified[0]).toContain("**不是**超时");
  });

  it("第一遍超时、第二遍变成探测不到 ⇒ 报那句诚实的话（第二遍的回答优先于第一遍的形态）", () => {
    const out = judge.decidePythonVerdict(timeout(), missing());
    expect(out.unverified[0]).toContain("探测不到");
    expect(out.unverified[0]).not.toContain("两遍都没有");
  });

  it("malformed ⇒ 未校验一条，且话术**不许**说成「机器上没装 Python」（ISSUE #1941）", () => {
    const out = judge.decidePythonVerdict(malformed(), null);
    expect(out.problems).toEqual([]);
    expect(out.unverified).toHaveLength(1);
    expect(out.unverified[0]).toContain("存在");
    // 两种形态的下一动作不同（装 Python vs 换探测方式），糊成一档等于把后者指错方向。
    expect(out.unverified[0]).toContain("**不是**没装 Python");
    expect(out.unverified[0]).toContain("三侧");
    // 也不许把它读成超时：那会触发「再取一遍」这条不该走的路径。
    expect(out.unverified[0]).toContain("**不是**超时");
    expect(out.unverified[0]).not.toContain("两遍都没有");
  });

  it("malformed 与 missing 必须给出不同的话术（同一句 = 又一次糊档）", () => {
    expect(judge.decidePythonVerdict(malformed(), null).unverified[0]).not.toBe(
      judge.decidePythonVerdict(missing(), null).unverified[0],
    );
  });

  it("第二遍从 malformed 变成答上了 ⇒ 照第二遍判，不留未校验（放行只放行没取到证的那一格）", () => {
    expect(judge.decidePythonVerdict(malformed(), answered())).toEqual({
      problems: [],
      unverified: [],
    });
  });
});

describe("接线在位：复跑真的会发生，出口真的分两条", () => {
  it("第一遍是超时形态 ⇒ 当场再取一遍（不是给人留「请先隔离复跑」的作业）", () => {
    expect(SCRIPT_SOURCE).toMatch(
      /if \(first\.state === "timeout"\) \{[\s\S]{0,600}?second = measurePythonOnce\(pyChecker\);/,
    );
    // 复跑必须打日志：静默 sleep / 静默重试是本仓点名的坏形态。
    expect(SCRIPT_SOURCE).toMatch(
      /console\.log\(\s*\n?\s*"\[app-port-vectors\] Python 侧第一遍只是超时形态/,
    );
  });

  it("catch 里按形态分流：超时返回 timeout 态，真失败返回带 problems 的 answered 态", () => {
    /* 判的是「catch 里按形态分流、超时走 timeout 态」，不判 catch 绑定的名字：
     * 改名（unicorn/catch-error-name 那类）与这条语义无关，钉死名字会让它假红。 */
    expect(SCRIPT_SOURCE).toMatch(/if \(isTimeoutLike\(\w+\)\) return \{ state: "timeout"/);
    expect(SCRIPT_SOURCE).toMatch(/problems: \[\s*\n?\s*`Python 侧自检失败：/);
  });

  it("判决结果同时喂两条出口（problems 与 unverified 各走各的）", () => {
    expect(SCRIPT_SOURCE).toMatch(/const verdict = decidePythonVerdict\(first, second\);/);
    expect(SCRIPT_SOURCE).toMatch(/problems\.push\(\.\.\.verdict\.problems\);/);
    expect(SCRIPT_SOURCE).toMatch(
      /for \(const note of verdict\.unverified\) unverified\.push\(note\);/,
    );
  });

  it("纯未校验那一支：说「未完全取证（放行）」、点名、且**不再** exit 1", () => {
    const branch = SCRIPT_SOURCE.slice(
      SCRIPT_SOURCE.indexOf("if (problems.length === 0) {"),
      SCRIPT_SOURCE.indexOf('console.error("[app-port-vectors] 四语言端口推导一致性失败：")'),
    );
    expect(branch).toContain("未完全取证");
    expect(branch).toContain("（放行）");
    expect(branch).toContain("[未校验]");
    expect(branch).not.toContain("process.exit(1)");
    // 也不能冒充成绿：标题不许是那句「一致性 OK」。
    expect(branch).not.toContain("四语言端口推导一致性 OK");
  });

  it("真不一致那一支照旧拦（放宽只放宽了「没拿到测量」那一格）", () => {
    const tail = SCRIPT_SOURCE.slice(
      SCRIPT_SOURCE.indexOf('console.error("[app-port-vectors] 四语言端口推导一致性失败：")'),
    );
    expect(tail).toContain("process.exit(1)");
    expect(tail).toContain("[未校验·附带]");
  });

  it("被 import 时不跑检查（否则用例一 require 就现场取证并可能 process.exit）", () => {
    // 归一化之后块括号没了，判的是那个条件本身（括号在不在不影响这条判据）。
    expect(SCRIPT_SOURCE).toMatch(/if \(require\.main === module\)/);
  });
});
