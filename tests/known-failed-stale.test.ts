/**
 * 「已知基线失败登记过期」判据（`scripts/check-known-failed-stale.mjs`）的判据。
 *
 * 这一条补的是 `KNOWN_FAILED_FILES` 那张表的纪律空档 —— 它的注释从第一天起就写着
 * 「修好立刻删」，而没有任何东西在判「它有没有过期」（规范 §11.12 第 3、4 条）。
 * 现场就是这张表自己：`tests/theme-dark-token-cascade.test.ts` 被登记之后，真因
 * （判据白名单漏了 `--color-card` 拼法）没人回头修，而该文件**另外 17 条已绿的
 * 断言**一并被从增量面摘掉（粒度是文件）—— 静默跳过比红更糟，红会挡住提交。
 *
 * 所以这里两头都要判，缺一即形同虚设：
 *
 *   · **判决**：三层（不存在 / 没跑起来 / 全绿）各真跑一遍纯入口，而不是「源码长这样」
 *     （同族事故 ISSUE #1356：抠源码正则当判决；#1345：把脚本自己打的 label 当执行记录）。
 *   · **触发面与时序**：清单为空是常态，必须零耗时退出 —— 否则每笔提交都付一次
 *     真跑，等于给全仓加税（§13.5.8）。同时必须确认这一条真的接进了 pre-commit。
 *
 * 本文件里最值钱的两条用例是那两条**反假绿**的：「vitest 起不来」与「一条用例都没跑」
 * 都必须报红。判据本体第一版就栽在后者上 —— 它把「命令坏了」的退出码读成了
 * 「登记项还红着」，于是给出一个假绿的 `[ok]`（详见该脚本 `resultFile()` 的注释）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkRegistrations,
  judgeStillFailing,
} from "../scripts/check-known-failed-stale.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HOOK = ".githooks/pre-commit";
const GATE_SCRIPT = "scripts/check-known-failed-stale.mjs";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** D 组步骤 = 钩子里 `  run "<标签>" <命令>` 那些行（行首锚定，注释掉的不算）。 */
function dGroupSteps(hookText: string) {
  return [...hookText.matchAll(/^ {2}run "([^"]+)" (.+)$/gm)].map((m) => ({
    label: m[1] ?? "",
    cmd: m[2] ?? "",
  }));
}

/** 一次成功跑完、全部通过的 vitest 结果（status 0 + 有执行证据）。 */
const RAN_GREEN = {
  status: 0,
  stdout: "",
  stderr: "",
  commandLine: "vitest run …",
};
const EVIDENCE_GREEN = {
  files: [{ name: "tests/x.test.ts", status: "passed" }],
  numTotalTests: 12,
};

/** 一次跑完、有文件红着的结果（status 1 + 有执行证据）。 */
const RAN_RED = { ...RAN_GREEN, status: 1 };
const EVIDENCE_RED = {
  files: [{ name: "tests/theme-dark-token-cascade.test.ts", status: "failed" }],
  numTotalTests: 18,
};

describe("登记项的存在性判决（免费那一维）", () => {
  it("每个登记项都指向真实文件 ⇒ 放行", () => {
    const res = checkRegistrations(
      ["tests/a.test.ts", "tests/b.test.ts"],
      () => true,
    );
    expect(res).toEqual({ exitCode: 0, problems: [] });
  });

  it("登记项指向不存在的文件 ⇒ 阻断并点出「排除项永远匹配不到」", () => {
    const res = checkRegistrations(
      ["tests/gone.test.ts"],
      (rel) => rel !== "tests/gone.test.ts",
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems[0]).toContain("tests/gone.test.ts");
    // 话术要指出这是**静默失效**（排除项不匹配任何东西），否则读的人会以为
    // 「文件没了就没了，无所谓」—— 而它正是这条判据存在的原因之一。
    expect(res.problems[0]).toContain("排除项");
  });

  it("重复登记同一条 ⇒ 阻断（顺手又加一条也是这一族）", () => {
    const res = checkRegistrations(
      ["tests/a.test.ts", "tests/a.test.ts"],
      () => true,
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("两次");
  });

  it("空清单 ⇒ 没有问题（这一步的常态）", () => {
    expect(checkRegistrations([], () => false)).toEqual({
      exitCode: 0,
      problems: [],
    });
  });
});

describe("登记项「还红着吗」的判决（真跑那一维）", () => {
  it("跑完且红着 ⇒ 放行，且报出是哪些文件红着", () => {
    const res = judgeStillFailing(
      ["tests/theme-dark-token-cascade.test.ts"],
      RAN_RED,
      "vitest run …",
      EVIDENCE_RED,
    );
    expect(res.exitCode).toBe(0);
    expect(res.failedFiles).toEqual(["tests/theme-dark-token-cascade.test.ts"]);
  });

  it("跑完且全绿 ⇒ 阻断，并说清「登记已过期 + 去哪儿删」", () => {
    const res = judgeStillFailing(
      ["tests/theme-dark-token-cascade.test.ts"],
      RAN_GREEN,
      "vitest run …",
      EVIDENCE_GREEN,
    );
    expect(res.exitCode).toBe(1);
    const msg = res.problems.join("\n");
    // 话术里必须有这三个落点：结论（过期）、原因（在摘整个文件）、修法（去哪儿删）。
    expect(msg).toContain("过期");
    expect(msg).toContain("增量面");
    expect(msg).toContain("quality-gate-shared.mjs");
  });

  it("**反假绿**：vitest 压根起不来（子进程没起来）⇒ 阻断，不许当「还红着」", () => {
    const res = judgeStillFailing(
      ["tests/x.test.ts"],
      {
        ...RAN_RED,
        error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }),
      },
      "vitest run …",
      EVIDENCE_RED,
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("起 vitest 失败");
  });

  it("**反假绿**：退出码非零但一条用例都没跑（参数写坏）⇒ 阻断，不许当「还红着」", () => {
    // 这一条是本判据本体第一版的真实事故：`--reporter=basic` 在 vitest 5 已删，
    // vitest 以 status 1 退出、零用例，而判决把那个 1 读成了「登记项还红着」⇒ 假绿。
    // ⇒ 「跑过」这个读数必须来自 vitest 写下的结构化产物，不能来自退出码。
    const res = judgeStillFailing(
      ["tests/x.test.ts"],
      { ...RAN_RED, status: 1 },
      "vitest run --reporter=basic …",
      null,
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("拿不到执行证据");
  });

  it("**反假绿**：结果文件在、但里面 0 条用例 ⇒ 同样判「没跑起来」", () => {
    const res = judgeStillFailing(
      ["tests/x.test.ts"],
      { ...RAN_RED, status: 1 },
      "vitest run …",
      { files: [], numTotalTests: 0 },
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("拿不到执行证据");
  });
});

describe("判据与仓库现状、提交链的接线", () => {
  it("当前登记表为空（这一条的常态，也是零耗时的前提）", async () => {
    const { KNOWN_FAILED_FILES } =
      await import("../scripts/quality-gate-shared.mjs");
    // 非空时本判据会真跑那几个文件 —— 那是设计如此，不是漂移。这里只钉住
    // 「空是常态、且空时不该有任何条目」，避免有人随手加一条而不去登记归属。
    expect(Array.isArray(KNOWN_FAILED_FILES)).toBe(true);
    expect(KNOWN_FAILED_FILES).toEqual([]);
  });

  it("这一条真的接进了 pre-commit 的 D 组（否则判据没有执行者）", () => {
    const steps = dGroupSteps(read(HOOK));
    const hit = steps.find((s) => s.cmd.includes(GATE_SCRIPT));
    // `cmd` 逐字相等而不是 `toContain`：把这一行注掉后 `dGroupSteps` 的行首锚定
    // 已经不认它（`hit` 会是 undefined）——「把这一步静音」正是这一族要拦的动作
    // （同 §13.5.8「在场判据要解析、不要 toContain」）。
    expect(hit?.cmd).toBe("node scripts/check-known-failed-stale.mjs");
  });
});
