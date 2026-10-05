/**
 * 「已知基线失败登记过期」判据（`scripts/check-known-failed-stale.mjs`）的判据。
 *
 * 这一条补的是 `KNOWN_FAILED_CASES` 登记表的纪律空档 —— 它的注释从第一天起就写着
 * 「修好立刻删」，而没有任何东西在判「它有没有过期」（规范 §11.12 第 3、4 条）。
 * 现场就是这张表自己：`tests/theme-dark-token-cascade.test.ts` 被登记之后，真因
 * （判据白名单漏了 `--color-card` 拼法）没人回头修，而该文件**另外 17 条已绿的
 * 断言**一并被从增量面摘掉 —— 静默跳过比红更糟，红会挡住提交。
 *
 * 所以这里**四条腿**都要判（粒度收到用例之后多出中间两条），缺一即形同虚设：
 *
 *   · 文件存在且被 git 跟踪；
 *   · 用例全名在**它的**文件里存在（运行时枚举，不是扫源码文本）；
 *   · 用例全名**全库唯一**（`-t` 是全局过滤器，重名会静默跳过别人的用例）；
 *   · **登记的那一条**真的红着（「同文件里别的用例红」不算）。
 *
 * 判决一律喂纯函数夹具（`checkRegistrations` / `checkCaseNames` / `judgeStillFailing`），
 * 而不是「源码长这样」或真跑 vitest —— 同族事故 ISSUE #1356（抠源码正则当判决）、
 * #1345（把脚本自己打的 label 当执行记录）。执行链路的真实性由「接进 pre-commit」那条钉。
 *
 * 本文件里最值钱的是那几条**反假绿**用例：「vitest 起不来」与「一条用例都没跑」都必须
 * 报红 —— 判据本体第一版就栽在后者上，它把「命令坏了」的退出码读成了「登记项还红着」，
 * 给出一个假绿的 `[ok]`（详见该脚本 `resultFile()` 的注释）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkCaseNames,
  checkRegistrations,
  judgeStillFailing,
  leafOf,
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

/** 一条登记项夹具。 */
const CASE_A = {
  file: "tests/a.test.ts",
  fullName: "outer > the red one",
  why: "夹具",
};

/** 一次成功跑完、全部通过的 vitest 结果（status 0 + 有执行证据）。 */
const RAN_GREEN = {
  status: 0,
  stdout: "",
  stderr: "",
  commandLine: "vitest run …",
};
const EVIDENCE_GREEN = {
  files: [{ name: "tests/a.test.ts", status: "passed" }],
  numTotalTests: 12,
  assertions: [{ file: "tests/a.test.ts", status: "passed", fullName: CASE_A.fullName }],
};

/** 一次跑完、**登记的那一条**红着的结果（status 1 + 有执行证据）。 */
const RAN_RED = { ...RAN_GREEN, status: 1 };
const EVIDENCE_RED = {
  files: [{ name: "tests/a.test.ts", status: "failed" }],
  numTotalTests: 18,
  assertions: [
    { file: "tests/a.test.ts", status: "failed", fullName: CASE_A.fullName },
    { file: "tests/a.test.ts", status: "passed", fullName: "outer > a green one" },
  ],
};

describe("登记项的存在性判决（免费那一维）", () => {
  it("每个登记项都指向真实文件 ⇒ 放行", () => {
    const res = checkRegistrations([CASE_A], () => true);
    expect(res).toEqual({ exitCode: 0, problems: [] });
  });

  it("登记项指向不存在的文件 ⇒ 阻断并点出「排除项永远匹配不到」", () => {
    const res = checkRegistrations(
      [{ ...CASE_A, file: "tests/gone.test.ts" }],
      (rel) => rel !== "tests/gone.test.ts",
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems[0]).toContain("tests/gone.test.ts");
    // 话术要指出这是**静默失效**（排除项不匹配任何东西），否则读的人会以为
    // 「文件没了就没了，无所谓」—— 而它正是这条判据存在的原因之一。
    expect(res.problems[0]).toContain("登记");
  });

  it("重复登记同一条（同文件 + 同全名）⇒ 阻断", () => {
    const res = checkRegistrations([CASE_A, { ...CASE_A }], () => true);
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("两次");
  });

  it("同文件但全名不同 ⇒ 不算重复（粒度是用例，同文件可以有多条登记）", () => {
    const res = checkRegistrations(
      [CASE_A, { ...CASE_A, fullName: "outer > another red one" }],
      () => true,
    );
    expect(res).toEqual({ exitCode: 0, problems: [] });
  });

  it("空清单 ⇒ 没有问题（这一步的常态）", () => {
    expect(checkRegistrations([], () => false)).toEqual({
      exitCode: 0,
      problems: [],
    });
  });
});

describe("用例全名的存在性与唯一性（`-t` 是全局过滤器，这是前提）", () => {
  /** 叶子标题用于定候选文件；这里把它做成「登记文件命中」的注入口。 */
  const leafOk = (leaf: string) =>
    leaf === leafOf(CASE_A.fullName) ? [CASE_A.file] : [];
  const listOk = (files: string[]) =>
    files.includes(CASE_A.file)
      ? [CASE_A.fullName, "outer > a green one"]
      : [CASE_A.fullName];

  it("叶子标题在登记文件里、且全名在运行时枚举里唯一 ⇒ 放行", () => {
    expect(checkCaseNames([CASE_A], leafOk, listOk)).toEqual({
      exitCode: 0,
      problems: [],
    });
  });

  it("叶子标题在登记文件里找不到 ⇒ 阻断（动态标题 / 拼错，唯一性也判不了）", () => {
    const res = checkCaseNames([CASE_A], () => [], listOk);
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("静态字面量");
  });

  it("全名在运行时枚举里不存在（改名 / 挪 describe）⇒ 阻断", () => {
    const res = checkCaseNames(
      [CASE_A],
      leafOk,
      () => ["outer > renamed one"],
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("运行时枚举里不存在");
  });

  it("**反静默**：全名在另一份候选文件里也出现 ⇒ 阻断，并说明会静默跳过别人的用例", () => {
    const res = checkCaseNames(
      [CASE_A],
      (leaf) =>
        leaf === leafOf(CASE_A.fullName) ? [CASE_A.file, "tests/b.test.ts"] : [],
      // 两份候选文件里各有一条同名用例 ⇒ 枚举里出现两次 ⇒ 冲突。
      () => [CASE_A.fullName, CASE_A.fullName],
    );
    expect(res.exitCode).toBe(1);
    const msg = res.problems.join("\n");
    expect(msg).toContain("多次");
    expect(msg).toContain("全局过滤器");
  });

  it("拿不到运行时枚举（量具起不来）⇒ 阻断，不许当通过", () => {
    const res = checkCaseNames([CASE_A], leafOk, () => null);
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("拿不到");
  });

  it('全名按 " > " 切叶子（vitest getFullName 的分隔符）', () => {
    expect(leafOf("a > b > c")).toBe("c");
    expect(leafOf("no separator")).toBe("no separator");
  });
});

describe("登记项「还红着吗」的判决（真跑那一维）", () => {
  it("登记的那一条红着 ⇒ 放行，且报出是哪些文件红着", () => {
    const res = judgeStillFailing([CASE_A], RAN_RED, "vitest run …", EVIDENCE_RED);
    expect(res.exitCode).toBe(0);
    expect(res.failedFiles).toEqual(["tests/a.test.ts"]);
  });

  it("跑完且全绿 ⇒ 阻断，并说清「登记已过期 + 去哪儿删」", () => {
    const res = judgeStillFailing(
      [CASE_A],
      RAN_GREEN,
      "vitest run …",
      EVIDENCE_GREEN,
    );
    expect(res.exitCode).toBe(1);
    const msg = res.problems.join("\n");
    // 话术里必须有这三个落点：结论（过期）、修法（去哪儿删）、登记项本身。
    expect(msg).toContain("过期");
    expect(msg).toContain("quality-gate-shared.mjs");
    expect(msg).toContain(CASE_A.fullName);
  });

  it("**同一问的关键形态**：同文件里别的用例红着、但登记的那一条已绿 ⇒ 阻断", () => {
    // 少了这一问，把全名指到一条已绿的用例上照样通过 —— 而「这一条现在红着」
    // 正是登记存在的唯一资格。
    const res = judgeStillFailing(
      [CASE_A],
      RAN_RED,
      "vitest run …",
      {
        ...EVIDENCE_RED,
        assertions: [
          { file: "tests/a.test.ts", status: "passed", fullName: CASE_A.fullName },
          { file: "tests/a.test.ts", status: "failed", fullName: "outer > another" },
        ],
      },
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("自己那条没红");
  });

  it("全名落在别的文件上的红 ⇒ 不算（登记必须指对文件，粒度是用例）", () => {
    const res = judgeStillFailing(
      [CASE_A],
      RAN_RED,
      "vitest run …",
      {
        ...EVIDENCE_RED,
        assertions: [
          { file: "tests/b.test.ts", status: "failed", fullName: CASE_A.fullName },
        ],
      },
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("自己那条没红");
  });

  it("**反假绿**：vitest 压根起不来（子进程没起来）⇒ 阻断，不许当「还红着」", () => {
    const res = judgeStillFailing(
      [CASE_A],
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
      [CASE_A],
      { ...RAN_RED, status: 1 },
      "vitest run --reporter=basic …",
      null,
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("拿不到执行证据");
  });

  it("**反假绿**：结果文件在、但里面 0 条用例 ⇒ 同样判「没跑起来」", () => {
    const res = judgeStillFailing(
      [CASE_A],
      { ...RAN_RED, status: 1 },
      "vitest run …",
      { files: [], numTotalTests: 0, assertions: [] },
    );
    expect(res.exitCode).toBe(1);
    expect(res.problems.join("\n")).toContain("拿不到执行证据");
  });
});

describe("判据与仓库现状、提交链的接线", () => {
  it("当前登记表为空（这一条的常态，也是零耗时的前提）", async () => {
    const { KNOWN_FAILED_CASES, KNOWN_FAILED_FILES } =
      await import("../scripts/quality-gate-shared.mjs");
    // 非空时本判据会真跑那几个文件 —— 那是设计如此，不是漂移。这里只钉住
    // 「空是常态、且空时不该有任何条目」，避免有人随手加一条而不去登记归属。
    expect(Array.isArray(KNOWN_FAILED_CASES)).toBe(true);
    expect(KNOWN_FAILED_CASES).toEqual([]);
    // 派生量必须跟着空（空表的文件视图也空）。
    expect(KNOWN_FAILED_FILES).toEqual([]);
  });

  it("这个脚本在清单为空时零耗时退出（每笔提交都付一次真跑 = 给全仓加税）", () => {
    // 判据挂 D 组、每笔提交都跑 —— 常态必须免费。`--list` 是它的空转形态。
    const out = read(GATE_SCRIPT);
    expect(out).toMatch(/KNOWN_FAILED_CASES\.length === 0/);
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
