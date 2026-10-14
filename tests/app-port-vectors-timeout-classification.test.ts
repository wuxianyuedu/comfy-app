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
 *     这一格以前是静默跳过，本文件把它变成会说话的。
 *
 * 「放行」不是把红灯藏起来：放行的是**这一次取证**，判据本身还在 —— Node 侧逐条真跑与
 * Rust / PowerShell 侧的锁引用仍在同一趟里判，而 `missing` / 双超时都会被打出来。
 * 代价与触发面：只有第一遍超时才多花一趟（最坏 `PROBE_TIMEOUT_MS × 2 + PY_TIMEOUT_MS`）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT_SOURCE = readFileSync(
  path.resolve(__dirname, "../scripts/check-app-port-vectors.cjs"),
  "utf8",
);
// 判据脚本是 CJS（`@ts-nocheck`，require 进来是 any），按仓库惯例显式标注返回形状。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const judge = require("../scripts/check-app-port-vectors.cjs") as {
  isTimeoutLike: (e: unknown) => boolean;
  probeCommand: (cmd: string, args: string[]) => string;
  decidePythonVerdict: (
    first: Measure,
    second: Measure | null,
  ) => { problems: string[]; unverified: string[] };
};

/** 一趟取证的返回形状（`measurePythonOnce` 的结果，也是本文件的输入夹具）。 */
interface Measure {
  state: "answered" | "timeout" | "missing";
  python: string | null;
  problems: string[];
}

const answered = (problems: string[] = []): Measure => ({
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

describe("超时形状识别（execFileSync 带 timeout 的两种落法都要认）", () => {
  it("code=ETIMEDOUT 与 message 里带 ETIMEDOUT 都算「没拿到测量」", () => {
    expect(
      judge.isTimeoutLike({ code: "ETIMEDOUT", message: "spawnSync python3" }),
    ).toBe(true);
    // 实测那一发的报错形态：code 不在顶层，只在 message 里
    expect(
      judge.isTimeoutLike({ message: "spawnSync python3 ETIMEDOUT" }),
    ).toBe(true);
    expect(
      judge.isTimeoutLike({
        message: "Command failed: timed out after 30000ms",
      }),
    ).toBe(true);
  });

  it("真的执行失败 / 命令不存在都不算超时（否则真红会被读成「未校验」而放过去）", () => {
    expect(
      judge.isTimeoutLike({ code: "ENOENT", message: "python3 not found" }),
    ).toBe(false);
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

describe("命令探测分三态，不许糊成布尔", () => {
  it("不存在的命令报 missing（而不是 timeout）", () => {
    expect(
      judge.probeCommand("definitely-not-a-real-binary-xyz", ["--version"]),
    ).toBe("missing");
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
    expect(SCRIPT_SOURCE).toMatch(
      /if \(isTimeoutLike\(e\)\) return \{ state: "timeout"/,
    );
    expect(SCRIPT_SOURCE).toMatch(/problems: \[\s*\n?\s*`Python 侧自检失败：/);
  });

  it("判决结果同时喂两条出口（problems 与 unverified 各走各的）", () => {
    expect(SCRIPT_SOURCE).toMatch(
      /const verdict = decidePythonVerdict\(first, second\);/,
    );
    expect(SCRIPT_SOURCE).toMatch(/problems\.push\(\.\.\.verdict\.problems\);/);
    expect(SCRIPT_SOURCE).toMatch(
      /for \(const note of verdict\.unverified\) unverified\.push\(note\);/,
    );
  });

  it("纯未校验那一支：说「未完全取证（放行）」、点名、且**不再** exit 1", () => {
    const branch = SCRIPT_SOURCE.slice(
      SCRIPT_SOURCE.indexOf("if (problems.length === 0) {"),
      SCRIPT_SOURCE.indexOf(
        'console.error("[app-port-vectors] 四语言端口推导一致性失败：")',
      ),
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
      SCRIPT_SOURCE.indexOf(
        'console.error("[app-port-vectors] 四语言端口推导一致性失败：")',
      ),
    );
    expect(tail).toContain("process.exit(1)");
    expect(tail).toContain("[未校验·附带]");
  });

  it("被 import 时不跑检查（否则用例一 require 就现场取证并可能 process.exit）", () => {
    expect(SCRIPT_SOURCE).toMatch(/if \(require\.main === module\) \{/);
  });
});
