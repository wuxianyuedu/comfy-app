/**
 * `scripts/check-a11y-rules.cjs` 的加载与入口自测（ISSUE #1623）。与 `a11y-rules-gate.test.ts` 分工：那份判
 * 台账五向口径；这份判「判据怎么被加载」——① 真加载只求值一次（§11.19.1 档 E，首价在收集期付掉）、
 * ② 导出面每个都能调用、③ 求值失败时给出结论或带原因冒出，不许把半张表当结论。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadJudgeModule, REAL_ROOT, SCRIPT } from "./helpers/a11y-effective-config";

/**
 * 本文件里真读仓库根 `eslint.config.js` 的用例的显式预算（PR-C 前它 import 整个 `eslint-config-next`）。
 * 登记的是**实测成本，不是给慢用例兜底**（§11.13）：进程内首值 36.4s（冷检出 40s+）、bin 形态真子进程 57.1s，
 * 都顶穿默认 30s 档；此前用例没带预算，钩子必冷时红的是「没记账的成本」。⚠️ 120s 只对子进程档还有意义（暖机搬走了进程内那笔，`CLI_BUDGET`）。
 */
const CONFIG_BUDGET = { timeout: 120_000 };

/**
 * 「bin 形态」真起子进程用例的显式预算。它非起进程不可（判 `CLI_ARGS` ← `process.argv` → `judge` →
 * `process.exit(code)`），而子进程有自己的模块缓存、借不到本进程暖机：热检出 3.5s、满载 11s+、隔离 57.1s。
 * 与 `a11y-rules-gate` 的 `CLI_BUDGET` 同源给足；30s 全局是给真进程的余量，不是给慢用例兜底（§11.13）。
 */
const CLI_BUDGET = { timeout: 120_000 };

  /* 收集期暖机一次：把「每进程只付一次」的真加载放在用例计时之外。否则谁排第一条就替全文件付那 3408ms
   * （冷检出 40s+），而它恰恰叫「只求值一次」—— 99% CPU 下实测红成 `Test timed out in 30000ms`（§13.6.4 负载假红）。
   * `a11y-rules-gate.test.ts` 早有这一步（`await judgeWith(REAL_LEDGER)`）；暖机不替用例断言，失败时抛、整份文件红。 */
await loadJudgeModule().loadEslintConfig();

test("真加载：求值的是仓库根那份 `eslint.config.js`，且只求值一次", CONFIG_BUDGET, async () => {
  const { loadEslintConfig } = loadJudgeModule();

  /* 暖机已经在收集期把这一笔付掉了，所以这里的 `firstMs` 通常就是 0ms ——
   * 它**只**作为下面那条话术的读数，不当断言：首次求值的墙钟是机器读数，
   * 不是判据的性质（热检出 3.4s、冷检出 40s+、`.next/` 命中 1.1–1.7s）。 */
  const first = Date.now();
  /* SAFETY: 类型断言已复核 */
  const flat = (await loadEslintConfig()) as Array<{
    rules?: unknown;
  }>;
  const firstMs = Date.now() - first;

  // 第二次必须是「同一份」且是常数时间 —— 共进程的全部收益都在这一条上。
  const second = Date.now();
  /* SAFETY: 类型断言已复核 */
  const again = (await loadEslintConfig()) as Array<{
    rules?: unknown;
  }>;
  const secondMs = Date.now() - second;

  expect(Array.isArray(flat)).toBe(true);
  expect(flat.length).toBeGreaterThan(0);
  expect(again).toBe(flat);
  /* 第三次拿到的还是同一个实例 —— 「只求值一次」这一半判据是**与机器快慢无关**的：
   * 去掉记忆化（每次都重新 `import()` 再 flatten）会在这里当场红。
   * 原先这一格写的是 `firstMs > 0`，它在冷进程里恒真、在暖进程里恒假
   * （`Date.now()` 粒度下缓存命中的耗时就是 0）—— 一条会随机器状态翻向的断言
   * 正是本文件要防的形态，而它想证明的「拿到过一份真配置」已由上面两条覆盖。 */
  expect(await loadEslintConfig()).toBe(flat);
  /* 第二次不许再走一遍求值：给它一个**很宽**的上限（100ms / 首次通常 40ms–1.7s，
   * 冷检出上 40s+），只要不是「又一次真加载」就够 —— 这里刻意不把首次的时间
   * 当成断言（那会把「机器快慢」判成回归）。 */
  expect(secondMs, `第二次读配置不该再走一遍 import 求值（首值实测 ${firstMs}ms）`).toBeLessThan(
    100,
  );
});

test(
  "真加载：那份配置里确实装着 jsx-a11y 插件（判据的四张表都从它读）",
  CONFIG_BUDGET,
  async () => {
    const { officialRuleMap, effectiveRules } = loadJudgeModule();
    const rules = await officialRuleMap();
    const effective = await effectiveRules();
    expect(rules.size).toBeGreaterThan(0);
    expect([...rules.keys()].every((n) => n.startsWith("jsx-a11y/"))).toBe(true);
    expect(Object.keys(effective).length).toBeGreaterThan(0);
  },
);

test("导出面：每个导出都是可调用的（不是「导了没人用」的空壳）", () => {
  /* SAFETY: 类型断言已复核 */
  const mod = loadJudgeModule() as unknown as Record<string, unknown>;
  /* SAFETY: 类型断言已复核 */
  const { VERIFIED_SURFACES } = mod as {
    VERIFIED_SURFACES: Record<string, string>;
  };
  for (const key of Object.keys(VERIFIED_SURFACES)) {
    expect(typeof mod[key], `导出 \`${key}\` 应当是函数`).toBe("function");
  }
  /* 元数据自己不是函数 —— 它是「导出面 ⇄ 执行者」那份自查表。 */
  expect(typeof VERIFIED_SURFACES).toBe("object");
});

test("失败路径：真加载失败时带给原因冒出去，不吞（更不把半张表当结论）", CONFIG_BUDGET, () => {
  /* 这一格的**真站点**在 bin 形态里（`.next/` 陈旧、插件包缺失这类加载错误），但它在**共进程**里没有身份：
   * `createRequire` / `import()` 都走该脚本的模块缓存，「子进程必失败、缓存后必成功」的样本没法在同一进程里两形态各测一次。
   * 所以这里钉的是判据对本进程那份配置的态度：`loadEslintConfig()` 要么给真扁平配置、要么抛，
   * 不许回「空的/半张」配置让上层四向判据静默全绿（§11.23「判据在场 ≠ 判据在跑」）。 */
  const { loadEslintConfig } = loadJudgeModule();
  return loadEslintConfig().then(
    (flat) => {
      expect(Array.isArray(flat)).toBe(true);
      expect(flat).not.toHaveLength(0);
    },
    (error: unknown) => {
      // 抛是可以接受的那一支，但**必须**带原因（裸 throw 等于吞掉根因）。
      expect(error).toBeInstanceOf(Error);
      /* SAFETY: 类型断言已复核 */
      expect(String((error as Error).message).length).toBeGreaterThan(0);
    },
  );
});

test("bin 形态：`--report` 走真子进程仍退 0，且摘要里点名生效条数", CLI_BUDGET, () => {
  /* 为什么非要真子进程：判的是入口那一支（`CLI_ARGS` ← `process.argv` → `judge` → `process.exit(code)`），
   * 进程内调用根本不经过 `process.argv`（覆盖面见 `tests/helpers/a11y-effective-config.coverage.test.ts`）。
   * 它付一次真加载且借不到本进程暖机，故独占 `CLI_BUDGET`；「起子进程跑本判据」只允许这里与 `--ledger` 缺值档。 */
  const stdout = execFileSync(process.execPath, [SCRIPT, "--report"], {
    cwd: REAL_ROOT,
    encoding: "utf8",
  });
  expect(stdout).toContain("--report 模式");
  expect(stdout).toContain("[a11y-rules]");
});

test("bin 形态的脚本头两块注释与事实同源（成本那一节的判据还在）", () => {
  /* 结构判据：文件头「成本」一节是这支改造的理由说明，不是散文 —— `--ledger` 口子、`judge(ledger)` 的显式入参、
   * CJS 都必须在源码里找得到（§13.5.14「声明 ⇄ 读者」同族）。`judge()` 的入参形状是两侧合并的产物：
   * 配置只从 `configFacts()` 来、台账只从入参来（master 侧收配置、本笔收台账）。 */
  const src = readFileSync(path.join(REAL_ROOT, "scripts", "check-a11y-rules.cjs"), "utf8");
  expect(src).toContain("--ledger <path>");
  expect(src).toContain("async function judge(ledger)");
  expect(src).toContain("await configFacts()");
  /* 配置读面只留一个：四个读点不许再各自 `import()` 一遍（那正是成本被乘的地方）。 */
  expect(src.match(/function configFacts\(/g)).toHaveLength(1);
  expect(src).toContain("loadEslintConfig");
});
