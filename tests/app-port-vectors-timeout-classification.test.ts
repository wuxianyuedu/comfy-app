/**
 * 「拿不到测量」不许被报成「四侧不一致」（规范 §13.6.4.1 / 审查台账 R11-01）。
 *
 * 立案现场：一笔**纯文档**提交被 `scripts/check-app-port-vectors.cjs` 拦下，报
 * `[app-port-vectors] 四语言端口推导一致性失败：- Python 侧自检失败：spawnSync python3 ETIMEDOUT`，
 * 而同一条判据在钩子结束后**就地复跑退 0** —— 那不是内容红，是没拿到测量。
 * 旧实现把子进程超时与真不一致塞进同一个 `problems` 数组，标题那句因此在超时时也说得出嘴；
 * 而 `hasCommand()` 用 `try/catch → false` 把「10 秒内没回答」与「这台机器没有 Python」也糊成
 * 同一件事，那一侧于是**既不参与比对也不报红**（比报错误导得更久）。
 *
 * 本笔只拆**话术与分类**，不放宽判定：取证不到时仍然退 1。
 * 「未校验要不要放行」是另一个口径，留给这条线拍，所以这里也钉住「仍然 exit 1」这一条 ——
 * 将来若有人把它改成放行，必须连同这段注释一起改，而不是顺手让红灯变绿。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT_SOURCE = readFileSync(
  path.resolve(__dirname, "../scripts/check-app-port-vectors.cjs"),
  "utf8",
);
// 判据脚本是 CJS（与 scripts/check-*.cjs 同族，`@ts-nocheck` 后经 require 进来是 any），
// 按仓库惯例给 mod 显式标注返回形状。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const judge = require("../scripts/check-app-port-vectors.cjs") as {
  isTimeoutLike: (e: unknown) => boolean;
  probeCommand: (cmd: string, args: string[]) => string;
};

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

describe("接线在位：两类结论走两条出口", () => {
  it("超时进 unverified，真失败才进 problems", () => {
    // 锚在 catch 体内部：把 `if (isTimeoutLike(e))` 摘掉、只剩 problems.push 时这条必须红。
    // 两处都容忍 prettier 的折行（模板串会换到下一行），所以不写死单个 \n 之后的内容。
    expect(SCRIPT_SOURCE).toMatch(
      /if \(isTimeoutLike\(e\)\) \{\s*\n\s*unverified\.push\(/,
    );
    expect(SCRIPT_SOURCE).toMatch(
      /\}\s*else \{\s*\n\s*problems\.push\(\s*`Python 侧自检失败/,
    );
  });

  it("纯超时的标题不说「一致性失败」，但仍然 exit 1（本笔不放宽判定）", () => {
    expect(SCRIPT_SOURCE).toContain(
      "未能完成取证（拦下，但**不是**四侧不一致）",
    );
    const pureUnverifiedBranch = SCRIPT_SOURCE.slice(
      SCRIPT_SOURCE.indexOf("if (problems.length === 0) {"),
      SCRIPT_SOURCE.indexOf(
        'console.error("[app-port-vectors] 四语言端口推导一致性失败：")',
      ),
    );
    expect(pureUnverifiedBranch).toContain("process.exit(1)");
    expect(pureUnverifiedBranch).toContain("[未校验]");
  });

  it("被 import 时不跑检查（否则用例一 require 就现场取证并可能 process.exit）", () => {
    expect(SCRIPT_SOURCE).toMatch(/if \(require\.main === module\) \{/);
  });
});
