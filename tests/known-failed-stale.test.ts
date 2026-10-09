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
import {
  runGate,
  touchesMechanism,
} from "../scripts/known-failed-selftest-gate.mjs";

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

/**
 * vitest 报告里的 `testResults[].name` 是**绝对路径**（实测），登记表写的是仓库相对
 * 路径 —— 判决按绝对路径归一化后比对。夹具必须照这个真实形状给，否则喂出来的绿是假的
 * （这条曾经就是相对的，于是「清单多条时按整场退出码判」的粗糙口径一直没被照出来）。
 */
function evidenceFor(entries: [rel: string, status: string][]) {
  return {
    files: entries.map(([rel, status]) => ({
      name: path.join(ROOT, rel).replaceAll("\\", "/"),
      status,
    })),
    numTotalTests: entries.length,
  };
}

/** 一次成功跑完、全部通过的 vitest 结果（status 0 + 有执行证据）。 */
const RAN_GREEN = {
  status: 0,
  stdout: "",
  stderr: "",
  commandLine: "vitest run …",
};
const EVIDENCE_GREEN = evidenceFor([["tests/x.test.ts", "passed"]]);

/** 一次跑完、有文件红着的结果（status 1 + 有执行证据）。 */
const RAN_RED = { ...RAN_GREEN, status: 1 };
const EVIDENCE_RED = evidenceFor([
  ["tests/theme-dark-token-cascade.test.ts", "failed"],
]);

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

/**
 * 自证档的**执行者**（`scripts/known-failed-selftest-gate.mjs`，ISSUE #1282 的第二刀）。
 *
 * 上一条接线用例钉的是「判据本体接进了 D 组」，而本组钉的是更细的一层：
 * **判据的「真跑那一档」在空表常态下从没被执行过，它的自证入口原先一个执行者都没有。**
 * 所以这里既要判「这条门禁真的在钩子里」，也要判它的判决本身真的会拦
 * （同族先例 ISSUE #1356：源码文本断言不是执行记录）。
 */
describe("自证档的执行者（碰了这套机制才跑的门禁）", () => {
  const SELFTEST_GATE = "scripts/known-failed-selftest-gate.mjs";
  const MECHANISM_INPUTS = [
    "scripts/quality-gate-shared.mjs",
    "scripts/check-known-failed-stale.mjs",
    ".githooks/pre-commit",
  ];

  it("没碰这套机制 ⇒ 零输出、放行（不给无关提交加时间）", () => {
    const res = runGate({
      staged: ["src/lib/x.ts", "tests/y.test.ts"],
      selfTest: null,
    });
    expect(res.exitCode).toBe(0);
    expect(res.touched).toEqual([]);
  });

  it("碰了机制但没拿到自证读数 ⇒ 阻断（判不了的形状按不放行）", () => {
    const res = runGate({
      staged: ["scripts/quality-gate-shared.mjs"],
      selfTest: null,
    });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain("没有拿到自证读数");
  });

  it("碰了机制、自证绿 ⇒ 放行，并报出命中哪一处", () => {
    const res = runGate({
      staged: MECHANISM_INPUTS,
      selfTest: { status: 0, stdout: "", stderr: "" },
    });
    expect(res.exitCode).toBe(0);
    expect(res.touched).toEqual(MECHANISM_INPUTS);
  });

  it("碰了机制、自证红 ⇒ 阻断，并把自证的真实输出带出来", () => {
    // **判据现场的最贵一问**：自证红了说明「真跑那一档」坏了，而它判的是
    // **下一次别线登记**能不能被正确判过期 —— 只打一句「自证失败」等于把人挡在证据外。
    const res = runGate({
      staged: ["scripts/check-known-failed-stale.mjs"],
      selfTest: {
        status: 1,
        stdout: "✗ 自证失败：量具坏了",
        stderr: "",
      },
    });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain("自证红了");
    expect(res.problem).toContain("自证失败：量具坏了");
    expect(res.problem).toContain("--self-test");
  });

  it("起不来（status 为 null 但拿到了读数对象）⇒ 同样阻断", () => {
    const res = runGate({
      staged: ["scripts/quality-gate-shared.mjs"],
      selfTest: { status: null, stdout: "", stderr: "起自证失败：spawn ENOENT" },
    });
    expect(res.exitCode).toBe(1);
    expect(res.problem).toContain("自证红了");
  });

  it("触发面只认这三处输入 —— 别的 `scripts/*.mjs` 不算碰机制", () => {
    // 窄触发面是这一步的全部代价担保：宽一档就给无关提交加了 ~0.9s。
    expect(touchesMechanism(["scripts/run-tests.mjs"])).toBe(false);
    expect(touchesMechanism(["scripts/affected-tests.mjs"])).toBe(false);
    expect(touchesMechanism(["docs/standards/11-测试与可观测性.md"])).toBe(
      false,
    );
    for (const f of MECHANISM_INPUTS) {
      expect(touchesMechanism([f]), `${f} 应当算命中`).toBe(true);
    }
  });

  it("这一条真的接进了 pre-commit 的 D 组（否则自证还是没有执行者）", () => {
    const steps = dGroupSteps(read(HOOK));
    const hit = steps.find((s) => s.cmd.includes(SELFTEST_GATE));
    expect(hit?.cmd).toBe(`node ${SELFTEST_GATE}`);
    // 顺序：先判「登记过期」，再判「判据自己还活着」—— 后者的读数解释前者为什么可信。
    const order = steps.map((s) => s.cmd);
    expect(order.indexOf(`node ${SELFTEST_GATE}`)).toBeGreaterThan(
      order.indexOf("node scripts/check-known-failed-stale.mjs"),
    );
  });

  it("自证本体确实带**两只探针**（红侧 + 绿侧对照组，缺一即形同虚设）", () => {
    // 源码文本断言在这里是**够的**：它判的不是「自证跑起来了吗」（那由下面那条真跑的
    // 用例判），而是「自证的设计里有没有两只探针」这个结构事实 —— 少了一只时，
    // judgeStillFailing 恒放行也照样绿（实测过）。真跑的判决归下面那条。
    const src = read("scripts/check-known-failed-stale.mjs");
    expect(src).toContain("known-failed-stale-probe.test.ts");
    expect(src).toContain("known-failed-stale-probe-green.test.ts");
    expect(src).toContain("期望「已过期」");
  });
});
