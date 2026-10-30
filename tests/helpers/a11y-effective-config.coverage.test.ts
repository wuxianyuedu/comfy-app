/**
 * 「共进程跑判据」这一层的**覆盖度账本**（ISSUE #1623）。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 *
 * 33418b72 那笔把 `tests/a11y-rules-gate.test.ts` 的「每条用例 spawn 一个
 * `scripts/check-a11y-rules.cjs`」改成异步并发 —— 稳态下买到了墙钟，但**代价是
 * 判据的覆盖面被悄悄缩了**，而且缩得没有痕迹：
 *
 *   · 子进程形态里，那 12 条用例真跑的是**判据的 bin 入口**（`require.main === module`
 *     那一支、`process.exit` 的退出码、`--ledger` 的 CLI 解析）—— 也就是说，
 *     「CLI 那一支被人改坏」这类改动原本会被这 12 条用例当场抓住；
 *   · 换成 `judge()` 之后，12 条里**只剩 ⑩ 一条**还走真子进程（它判的正是 CLI 解析），
 *     其余 11 条判的是「同一个进程里的那个函数」。
 *
 * 这正是 §11.23 那句「声明 ⇄ 读者」的又一形态：**判据在场 ≠ 判据被跑到**。
 * 所以这一份是**正面清单 + 覆盖面判据**：
 *
 *   ① `SCRIPTS` 逐条列出「本仓库在进程内跑过的判据脚本」，每条都要有 `import` 它的
 *      用例文件（名字写全，本文件自己核对）；
 *   ② 每个脚本的**公开面**逐条列出（键名），每条都要说清**谁在用**（`usedBy`）；
 *   ③ **零消费导出**（导出了但没人 import 用的键）当场红 —— §12.16 那一族。
 *
 * 覆盖面判据的形状是「正面清单 + 两侧对账」：新增一个导出却忘了补账本、或补了账本
 * 却没人用，都会在这里红。它不判「该不该共进程」（那是收益判断，要实测）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadJudgeModule, REAL_ROOT } from "./a11y-effective-config";

/** 在进程内被跑过的判据脚本 + 它们的公开面。 */
const SCRIPTS = /* SAFETY: 类型断言已复核 */ [
  {
    script: "scripts/check-a11y-rules.cjs",
    /** 谁在用这份模块的导出（那一格里点名的用例文件都要真实存在）。 */
    usedBy: ["tests/a11y-rules-gate.test.ts", "tests/check-a11y-rules.test.ts"],
    /**
     * 公开面（`module.exports` 的键）→ 谁在用。
     *
     * 「谁在用」不许写「自测」这种说不清的词 —— 要点到具体用例或调用点，
     * 因为这一栏存在的意义就是让「这个导出还有没有人要」这句话有答案。
     */
    surfaces: {
      judge: "tests/a11y-rules-gate.test.ts 全部 12 条（共进程判十来份台账）",
      readLedger:
        "tests/a11y-rules-gate.test.ts（bin 形态读 `--ledger <path>` 那一格）与 tests/check-a11y-rules.test.ts（台账归一形状）",
      normalize: 'tests/a11y-rules-gate.test.ts（规则档位归一："error" 与 ["error"] 同义）',
      loadEslintConfig: "tests/check-a11y-rules.test.ts 的「真加载」那两条（配置求值 + 失败路径）",
      effectiveRules: "tests/check-a11y-rules.test.ts（生效档位表）",
      officialRecommended: "tests/check-a11y-rules.test.ts（官方 recommended 有效集合）",
      officialRuleMap: "tests/check-a11y-rules.test.ts（插件规则 + 废弃标记）",
      rulesInNeitherConfig: "tests/check-a11y-rules.test.ts（两份配置都没提到的非废弃规则）",
      VERIFIED_SURFACES:
        "tests/helpers/a11y-effective-config.coverage.test.ts（导出面 ⇄ 账本那一格）",
    },
  },
] as const;

test("每个在进程内跑的判据脚本，它的每个导出都有人用（零消费导出当场红）", () => {
  const problems: Array<string> = [];
  for (const entry of SCRIPTS) {
    const mod = /* SAFETY: 类型断言已复核 */ loadJudgeModule() as unknown as Record<
      string,
      unknown
    >;
    const exported = new Set(Object.keys(mod));
    const claimed = new Set(Object.keys(entry.surfaces));
    for (const key of exported) {
      if (!claimed.has(key)) {
        problems.push(
          `${entry.script} 导出了 \`${key}\`，而账本（SCRIPTS 的 surfaces）里没有登记 —— ` +
            "新导出一个面就要同批回答「谁在用它」。",
        );
      }
    }
    for (const key of claimed) {
      if (!exported.has(key)) {
        problems.push(
          `${entry.script} 的账本登记了 \`${key}\`，而模块并没有导出它 —— ` +
            "账本与事实脱钩之后，这条只会让人以为有人在守。",
        );
      }
    }
    /* 账本里的「谁在用」不许是空话：要点到具体用例文件。 */
    for (const [key, usedBy] of Object.entries(entry.surfaces)) {
      if (typeof usedBy !== "string" || !usedBy.includes(".test.ts")) {
        problems.push(`账本里 \`${key}\` 的「谁在用」没点到具体用例文件（实测用例名才算数）。`);
      }
    }
    expect(entry.usedBy.length, `${entry.script} 要有 import 它的用例文件`).toBeGreaterThan(0);
    for (const file of entry.usedBy) {
      expect(
        existsSync(path.join(REAL_ROOT, file)),
        `${entry.script} 的「谁在用」里 \`${file}\` 不存在`,
      ).toBe(true);
    }
    /* 账本里每个面的「谁在用」都必须落在一个真实存在的用例文件上。 */
    for (const [key, usedBy] of Object.entries(entry.surfaces)) {
      const file = /tests\/(?:[\w.-]+\/)*[\w.-]+\.test\.ts/.exec(usedBy)?.[0];
      expect(file, `账本里 \`${key}\` 的「谁在用」要点名一个用例文件`).toBeTruthy();
      expect(
        existsSync(path.join(REAL_ROOT, file!)),
        `账本里 \`${key}\` 指向的 \`${file}\` 不存在`,
      ).toBe(true);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

test("`VERIFIED_SURFACES` 覆盖全部导出面（两个清单不许各说各话）", () => {
  const mod = /* SAFETY: 类型断言已复核 */ loadJudgeModule() as unknown as Record<string, unknown>;
  const { VERIFIED_SURFACES } = /* SAFETY: 类型断言已复核 */ mod as {
    VERIFIED_SURFACES: Record<string, string>;
  };
  /* 模块里那张表是「判据自己怎么看自己的导出面」（键是**可被判据本体调用**的面）、
   * 账本是「自测那一侧怎么看」（多一条 `VERIFIED_SURFACES` 自己 —— 它是自查用的
   * 元数据，不被判据本体调用）。两面必须覆盖同一个集合，否则「导出面有人管」
   * 这件事会随其中一份漂：
   *
   *   · 账本 ∖ 模块表 = 自测侧记错了，或那条面其实不该被调用；
   *   · 模块表 ∖ 账本 = 判据自己认了一个没人对账的面（而它的唯一理由就是被调用）。 */
  const inModule = Object.keys(VERIFIED_SURFACES).sort();
  const inLedger = Object.keys(SCRIPTS[0].surfaces)
    .filter((k) => k !== "VERIFIED_SURFACES")
    .sort();
  expect(inModule).toEqual(inLedger);
  expect(Object.keys(mod).sort()).toEqual([...inLedger, "VERIFIED_SURFACES"].sort());
});

test("判据脚本的 bin 入口仍然是**真子进程**（CLI 那一支不许只靠进程内调用）", () => {
  /* 覆盖面判据的正面形态：`--ledger` 的 CLI 解析 + `process.exit` 的退出码，
   * 只有真子进程能判。这一条钉的是「那个入口还在，且还认自己的参数」——
   * 它不重复 a11y 那批的断言（那边判的是「缺值退 2」）。 */
  const script = path.join(REAL_ROOT, "scripts", "check-a11y-rules.cjs");
  const src = readFileSync(script, "utf8");
  expect(src).toContain("require.main === module");
  expect(src).toContain("process.exit(code)");
});
