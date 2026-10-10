/**
 * `scripts/check-a11y-rules.cjs` 的**加载与入口**自测（ISSUE #1623）。
 *
 * 与 `tests/a11y-rules-gate.test.ts` 的分工：那一份判**台账那五向口径**
 * （十来份台账各判一次，共进程、付一次 `eslint.config.js` 的真加载）；
 * 这一份判**判据怎么被加载起来**：
 *
 *   ① 真加载 —— `loadEslintConfig()` 求值的是仓库根那份真配置，且**只求值一次**
 *      （同一份 module graph 里第二次是常数时间）。这一条是「共进程」这件事的
 *      前提，也是它全部收益的出处（§11.19.1 档 E）。**首价在收集期就付掉**
 *      （见下方暖机那段）—— 否则它落进第一条用例的 30s 预算，CPU 一满就假红
 *      （§13.6.4）；
 *   ② 导出面 —— 每个导出都能被调用（不是「导了但没人用」的空壳）；
 *   ③ 失败路径 —— `eslint.config.js` 求值失败时**判据要么给出结论、要么带着原因
 *      冒出去**，不许把半张表当结论用（这是本轮改造里唯一「没法在子进程里两种形态
 *      各测一次」的那一格，理由写在用例里）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import {
  loadJudgeModule,
  REAL_ROOT,
  SCRIPT,
} from "./helpers/a11y-effective-config";

/* 收集期**暖机一次**：把「每进程只付一次」的那回真加载放在**用例计时之外**。
 *
 * 这份文件此前没有这一步，于是谁排在第一条就替全文件付那一次求值 —— 而那条用例
 * 恰恰叫「只求值一次」，判的是一瞬间的事（第二次必须常数时间），却把首次那
 * 3408ms（空闲实测）到 40s+（冷检出，见 `tests/helpers/a11y-effective-config.ts`）
 * 的真加载算进了自己的 30s 预算里。它在 99% CPU 下的表现正是 `Test timed out in
 * 30000ms`（实测：load ≈56 时 4 次里红 2 次，同一份代码、同一个提交，隔离复跑
 * 立刻全绿 —— §13.6.4 的负载假红，不是回归）。
 *
 * 同目录的 `tests/a11y-rules-gate.test.ts` 早就有这一步（`await judgeWith(REAL_LEDGER)`），
 * 理由与这里逐字同源：**预算不该被别人的成本占着**（§11.13 的第三种形态）。
 * 本文件是同一份判据的「加载与入口」那一半，共用同一份一次性成本，却没有共用
 * 这一步 —— 于是那句「谁排第一谁付首价」在本文件里重新长了出来。
 *
 * ⚠️ 暖机**不替用例断言任何东西**：它只让那条成本落在用例之外，四条真加载用例的
 * 断言一个字未改（第二次仍是常数时间、导出面仍逐条可调用、失败路径仍不吞）。
 * 失败时让它抛 —— 读不到配置就是本判据要报的故障，收在收集期整份文件红。
 */
await loadJudgeModule().loadEslintConfig();

/**
 * 「bin 形态」那条**真起子进程**用例的显式预算。
 *
 * 它非起进程不可（判的是 `CLI_ARGS` 从 `process.argv` 取参 → `judge` →
 * `process.exit(code)` 那一支，进程内调用根本不经过 `process.argv`），而子进程
 * 里那份配置**没有本进程的缓存可借** —— 每次都是一次真加载：本机热检出实测
 * 3.5s、满载时 11s+，冷检出 40s+（`tests/helpers/a11y-effective-config.ts` 顶部）。
 * 也就是说它与本进程的暖机**买不到同一份便宜**，只能自己登记预算。
 *
 * 口径与 `tests/a11y-rules-gate.test.ts` 的 `CLI_BUDGET` 逐字同源（§11.13）：
 * 全局 30s 是**给真进程留的余量，不是给慢用例兜底** —— 这一条删不得也并发不得，
 * 所以按实测上限给足，而不是把它撞在默认档上等人来重跑。**不是**给慢用例兜底：
 * 它的钱包由「真加载一次」定价，与「这条用例写了多少断言」无关。
 */
const CLI_BUDGET = { timeout: 120_000 };

test("真加载：求值的是仓库根那份 `eslint.config.js`，且只求值一次", async () => {
  const { loadEslintConfig } = loadJudgeModule();

  const flat = (await loadEslintConfig()) as { rules?: unknown }[];

  // 第二次必须是「同一份」且是常数时间 —— 共进程的全部收益都在这一条上。
  const second = Date.now();
  const again = (await loadEslintConfig()) as { rules?: unknown }[];
  const secondMs = Date.now() - second;

  expect(Array.isArray(flat)).toBe(true);
  expect(flat.length).toBeGreaterThan(0);
  expect(again).toBe(flat);
  /* 第二次不许再走一遍求值：给它一个**很宽**的上限（100ms），只要不是「又一次
   * 真加载」就够。
   *
   * ⚠️ 这里**刻意不判第一次的耗时**（这条原本是 `expect(firstMs).toBeGreaterThan(0)`，
   * 本刀删掉）—— 首次求值的墙钟是**机器读数**，不是判据的性质：热检出 3.4s、
   * 冷检出 40s+、`.next/` 命中时 1.1–1.7s，而**暖机之后它恰好是 0ms**。
   * 也就是说那条断言读的不是「判据对不对」，而是「这台机器此刻什么状态」——
   * 机器一快（或暖机一加）就红，而判据本身一个字没错。这正是 §13.6.4 说的
   * 「时间型读数不是结论」，只是它长在一条**看起来在判缓存**的用例里。 */
  expect(secondMs, "第二次读配置不该再走一遍 import 求值").toBeLessThan(100);
});

test("真加载：那份配置里确实装着 jsx-a11y 插件（判据的四张表都从它读）", async () => {
  const { officialRuleMap, effectiveRules } = loadJudgeModule();
  const rules = await officialRuleMap();
  const effective = await effectiveRules();
  expect(rules.size).toBeGreaterThan(0);
  expect([...rules.keys()].every((n) => n.startsWith("jsx-a11y/"))).toBe(true);
  expect(Object.keys(effective).length).toBeGreaterThan(0);
});

test("导出面：每个导出都是可调用的（不是「导了没人用」的空壳）", () => {
  const mod = loadJudgeModule() as unknown as Record<string, unknown>;
  const { VERIFIED_SURFACES } = mod as {
    VERIFIED_SURFACES: Record<string, string>;
  };
  for (const key of Object.keys(VERIFIED_SURFACES)) {
    expect(typeof mod[key], `导出 \`${key}\` 应当是函数`).toBe("function");
  }
  /* 元数据自己不是函数 —— 它是「导出面 ⇄ 执行者」那份自查表。 */
  expect(typeof VERIFIED_SURFACES).toBe("object");
});

test("失败路径：真加载失败时带给原因冒出去，不吞（更不把半张表当结论）", () => {
  /* 这一格的**真站点**在 bin 形态里（`.next/` 陈旧、`@eslint/compat` 被删掉这
   * 类加载错误），但它在**共进程**里没有身份：`createRequire` / `import()` 都走
   * 该脚本的模块缓存，于是「在子进程必然失败、在缓存之后必然成功」的样本没法在
   * 同一个进程里两种形态各测一次。
   *
   * 所以这里钉的是**判据对本进程那份配置的态度**：`loadEslintConfig()` 要么给它
   * 一份真的扁平配置、要么抛 —— 不许回一个「空的/半张」配置让上层四向判据
   * 静默全绿（那正是 §11.23「判据在场 ≠ 判据在跑」的那一族失效）。 */
  const { loadEslintConfig } = loadJudgeModule();
  return loadEslintConfig().then(
    (flat) => {
      expect(Array.isArray(flat)).toBe(true);
      expect(flat).not.toHaveLength(0);
    },
    (error: unknown) => {
      // 抛是可以接受的那一支，但**必须**带原因（裸 throw 等于吞掉根因）。
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message).length).toBeGreaterThan(0);
    },
  );
});

test(
  "bin 形态：`--report` 走真子进程仍退 0，且摘要里点名生效条数",
  CLI_BUDGET,
  () => {
    /* 为什么这一条非要真子进程：它判的是**入口那一支**（`CLI_ARGS` 从
     * `process.argv` 取参 → `judge` → `process.exit(code)`），而进程内调用
     * 根本不经过 `process.argv`。覆盖面见
     * `tests/helpers/a11y-effective-config.coverage.test.ts`。
     *
     * ⚠️ 它要付**一次真加载**（这份配置在最外层进程里的首价），而那份成本
     * **借不到本进程的暖机**（子进程里有自己的模块缓存）—— 所以它是这一份文件里
     * 唯一需要 `CLI_BUDGET` 的用例。也因此，整个仓库里「起子进程跑本判据」只允许
     * 出现在这里与 `--ledger` 缺值那一档（后者在 `process.exit(2)` 上停住、
     * 不求值配置）。再加第三条之前先想清楚它付的是什么。 */
    const stdout = execFileSync(process.execPath, [SCRIPT, "--report"], {
      cwd: REAL_ROOT,
      encoding: "utf8",
    });
    expect(stdout).toContain("--report 模式");
    expect(stdout).toContain("[a11y-rules]");
  },
);

test("bin 形态的脚本头两块注释与事实同源（成本那一节的判据还在）", () => {
  /* 结构判据：文件头「成本」一节是这一支改造的**理由说明**，不是散文 ——
   * 判据的 `--ledger` 口子、`judge(ledger)` 的显式入参、CJS 这一条都必须能在源码里
   * 找到（口径与 §13.5.14「声明 ⇄ 读者」同族）。
   *
   * ⚠️ `judge()` 的入参形状是**合并了两侧**之后的产物：master 侧那笔把配置事实收成
   * 每进程一次（`configFacts()`），本笔把台账收成显式对象（`judge(ledger)`）。
   * 所以这里钉的是那条**组合起来的**形状：配置只从 `configFacts()` 来、台账只从入参来。 */
  const src = readFileSync(
    path.join(REAL_ROOT, "scripts", "check-a11y-rules.cjs"),
    "utf8",
  );
  expect(src).toContain("--ledger <path>");
  expect(src).toContain("async function judge(ledger)");
  expect(src).toContain("await configFacts()");
  /* 配置读面只留一个：四个读点不许再各自 `import()` 一遍（那正是成本被乘的地方）。 */
  expect(src.match(/function configFacts\(/g)).toHaveLength(1);
  expect(src).toContain("loadEslintConfig");
});
