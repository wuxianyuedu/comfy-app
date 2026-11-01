/**
 * 平台两格的临时停用台账（ISSUE #2948）——「先临时关掉、后面再开」的形态必须有判据。
 *
 * 这一族最危险的失效形态是**静默消失**：把三条用例从固定清单里删掉，或让台账与清单
 * 各自漂开，表现都是「日志里少跑了几条」，而它与「这几条本来就不该跑」逐字同形。
 * 所以这里钉四件事：
 *
 *   ① 台账里的每一条都**还在** `FIXED_STRUCTURAL_TESTS` 里（名字留着，不是删除）；
 *   ② 每一条都写清「谁还在跑它」（本地执行者）与恢复条件 —— 否则它在这两格上就是零执行者；
 *   ③ 过滤只剔台账点名的那些，其余原样、顺序不变，且**剔了哪几条要能念出来**；
 *   ④ 名单是封闭的：加一条要人来签字（与 `fixed-gate-input-faces` 同一姿势）。
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FIXED_STRUCTURAL_TESTS } from "../scripts/fixed-structural-tests.mjs";
import {
  SUSPENDED_GATE_TESTS,
  suspendedNames,
  suspendedReading,
  withoutSuspended,
} from "../scripts/suspended-gate-tests.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("停用台账的形状", () => {
  it("名单是封闭的那一份：加一条要人来签字", () => {
    expect([...suspendedNames()].sort()).toEqual([
      "tests/base-check.test.ts",
      "tests/check-bundle-budget.test.ts",
      "tests/eslint-gate-canary.test.ts",
    ]);
  });

  it("每一条都还在固定清单里（停用不是删除 —— 删了就没有执行者了）", () => {
    const gone = SUSPENDED_GATE_TESTS.filter((e) => !FIXED_STRUCTURAL_TESTS.includes(e.test)).map(
      (e) => e.test,
    );
    expect(
      gone,
      "这些条目已经不在 `FIXED_STRUCTURAL_TESTS` 里了：停用的形态是「名字还在、只是这两格不跑」，" +
        "从清单里删掉会让那条判据在本地钩子上也消失（零执行者，`tests/ci-gate-names.test.ts` 会点名）",
    ).toEqual([]);
  });

  it("每条都写清「算在哪张单上、为什么、谁还在跑、怎么恢复」", () => {
    for (const entry of SUSPENDED_GATE_TESTS) {
      expect(entry.issue, `${entry.test} 缺 ISSUE 号`).toBeGreaterThan(0);
      expect(entry.why.length, `${entry.test} 没写清为什么停它`).toBeGreaterThan(20);
      expect(
        entry.localExecutor.length,
        `${entry.test} 没写「谁还在跑它」—— 那它在这两格上就是零执行者`,
      ).toBeGreaterThan(10);
      expect(entry.resume.length, `${entry.test} 没写恢复条件`).toBeGreaterThan(10);
    }
  });

  it("台账点名的是真实存在的用例文件（改名之后这里必须跟着改）", async () => {
    const fs = await import("node:fs");
    const missing = SUSPENDED_GATE_TESTS.filter((e) => !fs.existsSync(path.join(ROOT, e.test))).map(
      (e) => e.test,
    );
    expect(missing, "写错一个路径 = 那条永远剔不中，而清单看着还在").toEqual([]);
  });
});

describe("过滤语义", () => {
  it("只剔台账点名的那些，其余原样且顺序不变", () => {
    const files = [
      "tests/a.test.ts",
      "tests/base-check.test.ts",
      "tests/b.test.ts",
      "tests/check-bundle-budget.test.ts",
    ];
    const got = withoutSuspended(files);
    expect(got.files).toEqual(["tests/a.test.ts", "tests/b.test.ts"]);
    expect(got.dropped).toEqual(["tests/base-check.test.ts", "tests/check-bundle-budget.test.ts"]);
  });

  it("台账怎么给就怎么剔（注入一份空台账 ⇒ 一条都不剔）", () => {
    const got = withoutSuspended(["tests/base-check.test.ts"], []);
    expect(got.files).toEqual(["tests/base-check.test.ts"]);
    expect(got.dropped).toEqual([]);
  });

  it("读数逐条点名，且带上「本地还在跑」那句（否则会被读成「这批判据没了」）", () => {
    const text = suspendedReading(["tests/base-check.test.ts"]);
    expect(text).toContain("tests/base-check.test.ts");
    expect(text).toContain("ISSUE #2948");
    expect(text).toContain("本地执行者");
    expect(text).toContain("不是「这批判据没了」");
  });

  it("没剔任何东西 ⇒ 一个字都不打（不制造一条恒有的噪音行）", () => {
    expect(suspendedReading([])).toBe("");
  });

  it("清单里出现了台账没登记的名字 ⇒ 读数点名「对不上」，不装作没事", () => {
    const text = suspendedReading(["tests/nobody-registered.test.ts"]);
    expect(text).toContain("tests/nobody-registered.test.ts");
    expect(text).toContain("台账里没有这一条");
  });
});
