/**
 * 「共进程跑判据」的覆盖度账本（ISSUE #1623）。33418b72 把 `tests/a11y-rules-gate.test.ts` 改成并发 `judge()`：
 * 墙钟变快，但 12 条里只剩 ⑩ 还走真子进程（bin 入口 / `process.exit` / `--ledger` 解析的覆盖被悄悄缩掉，
 * §11.23「判据在场 ≠ 判据被跑到」）。账本判三件：`SCRIPTS` 与 import 它的用例、`surfaces` 的 `usedBy`、零消费导出当场红。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadJudgeModule, REAL_ROOT } from "./a11y-effective-config";

/** 在进程内被跑过的判据脚本 + 它们的公开面。 */
/* SAFETY: 类型断言已复核 */
const SCRIPTS = [
  {
    script: "scripts/check-a11y-rules.cjs",
    /** 谁在用这份模块的导出（那一格里点名的用例文件都要真实存在）。 */
    usedBy: ["tests/a11y-rules-gate.test.ts", "tests/check-a11y-rules.test.ts"],
    /**
     * 公开面（`module.exports` 的键）→ 谁在用。「谁在用」不许写「自测」这种说不清的词，要点到具体
     * 用例或调用点 —— 这一栏存在的意义就是让「这个导出还有没有人要」有答案。
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
    /* SAFETY: 类型断言已复核 */
    const mod = loadJudgeModule() as unknown as Record<string, unknown>;
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
  /* SAFETY: 类型断言已复核 */
  const mod = loadJudgeModule() as unknown as Record<string, unknown>;
  /* SAFETY: 类型断言已复核 */
  const { VERIFIED_SURFACES } = mod as {
    VERIFIED_SURFACES: Record<string, string>;
  };
  /* 模块那张表是「判据自己怎么看自己的导出面」（键必须可被判据本体调用），账本是「自测那一侧怎么看」
     （多一条 `VERIFIED_SURFACES` 自身 —— 自查元数据，不被本体调用）。两面须覆盖同一集合，否则会漂：
     账本 ∖ 模块 = 自测记错或那条面不该被调用；模块 ∖ 账本 = 判据认了一个没人对账的面。 */
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
