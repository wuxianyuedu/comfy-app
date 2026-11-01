/**
 * 平台两格的临时停用台账（ISSUE #2948）——「先临时关掉、后面再开」的形态必须有判据。
 *
 * 这一族最危险的失效形态是**静默消失**：把三条用例从固定清单里删掉，或让台账与清单
 * 各自漂开，表现都是「日志里少跑了几条」，而它与「这几条本来就不该跑」逐字同形。
 * 所以这里钉四件事：
 *
 *   ① 台账里的每一条都**还在** `FIXED_STRUCTURAL_TESTS` 里（名字留着，不是删除）；
 *   ② 每一条都写清「停用期间还剩谁在跑这条用例文件」（`executorsNow`，空就是空）、
 *    判据本体此刻在哪儿跑（`guardNote`）与恢复条件 —— 而且 ①② 都不是自述：
 *    `executorsNow` 要与 `.githooks/pre-commit` 里「组 C 已被撤」这件机器事实对账
 *    （ISSUE #2957：原先三条都写「本地钩子组 C」，而那个执行者 2026-10-20 就不跑了）；
 *   ③ 过滤只剔台账点名的那些，其余原样、顺序不变，且**剔了哪几条要能念出来**；
 *   ④ 名单是封闭的：加一条要人来签字（与 `fixed-gate-input-faces` 同一姿势）。
 */
import { readFileSync } from "node:fs";
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

  it("每条都写清「算在哪张单上、为什么、停用期间还剩谁在跑、判据本体在哪儿、怎么恢复」", () => {
    for (const entry of SUSPENDED_GATE_TESTS) {
      expect(entry.issue, `${entry.test} 缺 ISSUE 号`).toBeGreaterThan(0);
      expect(entry.why.length, `${entry.test} 没写清为什么停它`).toBeGreaterThan(20);
      expect(
        Array.isArray(entry.executorsNow),
        `${entry.test} 的 executorsNow 不是数组 —— 它是「停用期间还剩谁在跑这条用例文件」，` +
          "空数组就是「没有」，不许用一句通顺的话顶替",
      ).toBe(true);
      expect(entry.resume.length, `${entry.test} 没写恢复条件`).toBeGreaterThan(10);
      expect(entry.guardNote.length, `${entry.test} 没写判据本体此刻在哪儿跑`).toBeGreaterThan(10);
    }
  });

  /**
   * ISSUE #2957 那一格：台账原先三条都写「本地钩子组 C」，而钩子自己把 C 撤了。
   * 这里把那句自述变成**可对账的**：先钉住钩子里的机器事实，再禁止台账把它当执行者。
   */
  it("组 C 在本地不执行是钩子里的机器事实（台账不许把它写成执行者）", () => {
    const hook = readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf8");
    // 事实本体：run_group() 对 id=C 写 skip/moved 后 return 0（AGENTS 硬规则 7 明写这一档）。
    /* 钩子里那一段的真实形态是 `return 0`（**不带分号**）—— 这条正则先前按 `return 0;` 写，
     * 当场红了一次才回去核对；写这条的人（我）凭印象加了个分号。所以把"取不到事实"
     * 设计成红而不是静默放行是对的做法：它第一次跑就抓住了自己的量具错。 */
    const skipMatch = /if \[ "\$id" = "C" \]; then[\s\S]{0,240}?\breturn 0\b/m.exec(hook);
    const skipBlock = skipMatch?.[0] ?? "";
    expect(
      skipBlock,
      '钩子里找不到「`if [ "$id" = "C" ]; then … return 0`」那一段 —— 要么组 C 的执行者' +
        "回来了（那就回头核对每条 `executorsNow` 是否该补上），要么这段被换了形态而这条判据" +
        "取不到机器事实了。两种都必须有人来看这一行，不许让它静默放行。",
    ).not.toBe("");
    expect(
      skipBlock,
      "组 C 那一档必须把「被撤」写在状态文件里（`.skip` / `.moved`），否则读数分不出" +
        "「没跑」与「跑过且绿」",
    ).toMatch(/\.skip/);
    for (const entry of SUSPENDED_GATE_TESTS) {
      expect(
        entry.executorsNow.join(" "),
        `${entry.test}：组 C 的本地执行者已被钩子撤掉，executorsNow 里却把它当成还在跑它 —— ` +
          "这一句会把「停用期间零自动执行者」读成「还有一层兜底」（ISSUE #2957 的现场）",
      ).not.toMatch(/组 ?C|本地钩子/);
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

  it("读数逐条点名，并照实说「自动执行者：无」（不许写成「本地还在跑」）", () => {
    const text = suspendedReading(["tests/base-check.test.ts"]);
    expect(text).toContain("tests/base-check.test.ts");
    expect(text).toContain("ISSUE #2948");
    expect(text).toContain("自动执行者：**无**");
    expect(text).toContain("不是「这批判据没了」");
    // 判据本体与用例文件是两件事，读数里两条都要在（混起来就会被人当成"整个判据停了"）
    expect(text).toContain("判据本体");
    expect(text).not.toContain("本地钩子照跑");
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
