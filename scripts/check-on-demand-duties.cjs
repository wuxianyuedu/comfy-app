#!/usr/bin/env node
// @ts-nocheck -- 「不进钩子的按需档 ⇄ 执行者」的双向判据（供 .githooks/pre-commit 的 D 组调用）
/**
 * 「**不进钩子**」的那些档，逐条答出「那谁在什么时候跑它」—— 规范见
 * docs/standards/13-提交与-code-review.md §13.5.4（与 §13.5.12 同源）。
 *
 * ── 立案现场（ISSUE #1569）────────────────────────────────────────────
 *
 * §13.5.4 那张表此前有一条隐形的缝：判据「不进钩子」是**代价判据**（起 webServer /
 * 十分钟量级 / 网络请求），而它**不回答「那谁在什么时候跑它」**。缝里漏掉的正是
 * 代价最高的那几条 —— 它们曾经只有一句「按需手动跑」，而那句话没有任何东西在守。
 *
 * 那一轮把五条都补上了执行者（新鲜度账 / check:all 默认档 / 按需召唤台账），
 * 但**补的是散文**：写进文档的表格不会自己响。于是下一个洞的形状很明确 ——
 *
 *   · 新增一个新鲜度档（`FRESHNESS_TRACKS` 加一条）却忘了在 §13.5.4 登记
 *     ⇒ 那一档**谁都不判**（判据的覆盖面与它自称的不符，正是 §13.5.12 的立案现场）；
 *   · 反过来，表里留着一行指向已经删掉的档 / 已经接进钩子的档 ⇒ 它是一句过期的承诺。
 *
 * 本判据把这张表机器化，**双向**核对（与 §12.12 的台账型判据、`check-gate-executors`
 * 的台账同口径）：
 *
 *   ① **每一行点名的机器事实仍然存在** —— 四类事实各自找一个**已有出处**去核：
 *      · `freshness-track`  ⇒ `FRESHNESS_TRACKS` 里有没有这个键（`visual-baselines.mjs`）；
 *      · `gate-not-in-all`  ⇒ `quality-gate.mjs` 的 `GATES` 里这一项是不是 `run: false`；
 *      · `gate-in-all`      ⇒ 同一张表里有没有这一项（它确实在跑）；
 *      · `on-demand-ledger` ⇒ `scripts/.gate-executor-ledger.json` 的 `onDemand` 里有没有它。
 *      **事实从既有出处现算，不在这里抄第二份清单**（§12.14 / §12.18）。
 *   ② **每一个机器事实都被本索引登记** —— 新增一档却忘了登记就当场红。
 *      覆盖面 = `FRESHNESS_TRACKS` 的键 ∪ `quality-gate` 的 `run:false` 项
 *      ∪ 按需召唤台账的条目。
 *
 * ── 刻意不做（都写进 §13.5.4 了）──────────────────────────────────────
 *
 *   · **不判「这档该不该进钩子」**：那是代价判断（起浏览器 / 十分钟量级 / 网络），
 *     要实测，不是形态判据能答的。
 *   · **不复述各档的规则**：本索引只登记「事实在哪 + 执行者是谁」，规则归 §13.5.4。
 *   · **不判「文档那张表与索引逐行同源」**：表格是渲染，判据只核机器可判的那两半。
 *     手抄一份档名清单正是本判据要拦的病（§13.5.4 那句「判决面由 `FRESHNESS_TRACKS`
 *     现算」同味），所以索引用 id 而不是档名做键。
 *
 * 成本：纯文本 + 两次 `import` 求值，实测 < 0.2s（零网络、零子进程），照 §13.5.4
 * 的成本判据该进钩子。
 *
 * 用法：
 *   node scripts/check-on-demand-duties.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-on-demand-duties.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const LEDGER = path.join(__dirname, ".on-demand-duties.json");
const GATE_EXECUTOR_LEDGER = path.join(__dirname, ".gate-executor-ledger.json");
const QUALITY_GATE = path.join(__dirname, "quality-gate.mjs");

/** 索引行数的下限 —— 静默降级的地板（解析失灵时最容易退化成「0 行、全绿」）。 */
const MIN_DUTIES = 5;

const problems = [];
const report = [];

/* ── 读索引（判据自己不许静默降级） ─────────────────────────── */

function readLedger() {
  if (!fs.existsSync(LEDGER)) {
    problems.push(
      `索引不存在：${path.relative(ROOT, LEDGER)} —— 本判据的对象就是它（规范 §13.5.4）`,
    );
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch (err) {
    problems.push(`索引不是合法 JSON：${err.message}`);
    return null;
  }
  const duties = parsed?.duties;
  if (!Array.isArray(duties) || duties.length === 0) {
    problems.push(
      "索引里没有 duties（空索引 = 没有任何档要查，等于把门禁关掉）",
    );
    return null;
  }
  if (duties.length < MIN_DUTIES) {
    problems.push(
      `索引只有 ${duties.length} 行，低于下限 ${MIN_DUTIES} —— 解析规则可能坏了（不许静默降级）`,
    );
    return null;
  }
  for (const [i, d] of duties.entries()) {
    if (!d?.id || !d?.name || !d?.fact?.kind || !d?.executor) {
      problems.push(
        `第 ${i + 1} 行缺字段（id / name / fact.kind / executor 都要有）`,
      );
    }
  }
  return duties;
}

/* ── 四类机器事实，各自从**已有出处**现算 ───────────────────── */

/** 新鲜度档的键（`FRESHNESS_TRACKS`）。 */
async function freshnessKeys() {
  const mod = await import("../scripts/visual-baselines.mjs");
  return Object.keys(mod.FRESHNESS_TRACKS ?? {});
}

/**
 * `quality-gate.mjs` 的门禁项 —— 分两档：`run:false`（不进 `all`）与在跑的。
 *
 * **不 import** 那个模块（它顶层就要解析 pnpm / 落 DOM 之外的东西，import 有副作用）；
 * 用文本读它的 `GATES` 表：`<name>: { … }` 的块，块内看有没有 `run: false`。
 */
function qualityGateModes() {
  const text = fs.readFileSync(QUALITY_GATE, "utf8");
  const notInAll = new Set();
  const all = new Set();
  const lines = text.split("\n");
  let current = null;
  for (const line of lines) {
    const m = line.match(/^\s{2}([a-zA-Z][\w]*):\s*\{/);
    if (m) {
      current = m[1];
      all.add(current);
      continue;
    }
    if (current && /^\s{2}\},?\s*$/.test(line)) {
      current = null;
      continue;
    }
    if (current && /run:\s*false/.test(line)) notInAll.add(current);
  }
  /* `display: false` 那一类不在 `--mode` 单选里，但这里不判它 —— 只判「进不进 all」。 */
  return { notInAll, all };
}

/** 判据执行者台账的「按需召唤」条目（`scripts/.gate-executor-ledger.json`）。 */
function onDemandLedgerKeys() {
  if (!fs.existsSync(GATE_EXECUTOR_LEDGER)) return [];
  const parsed = JSON.parse(fs.readFileSync(GATE_EXECUTOR_LEDGER, "utf8"));
  return Object.keys(parsed?.onDemand ?? {});
}

/* ── 判 ──────────────────────────────────────────────────────── */

async function main() {
  const duties = readLedger();
  if (!duties) return finish();

  const [tracks, gates] = [await freshnessKeys(), qualityGateModes()];
  const onDemand = onDemandLedgerKeys();

  /** 每类事实 → 「它还在不在」的判据。 */
  const factExists = (fact) => {
    switch (fact?.kind) {
      case "freshness-track":
        return tracks.includes(fact.key);
      case "gate-not-in-all":
        return gates.notInAll.has(fact.gate);
      case "gate-in-all":
        return gates.all.has(fact.gate);
      case "on-demand-ledger":
        return onDemand.includes(fact.script);
      case "base-check-chained":
        /* 事实从 `scripts/base-check/chained-steps.mjs` 的 `CHAINED_STEPS` 现算
         * （成员写成 `{ script: "…" }`）—— 不在这里抄第二份清单（同 `qualityGateModes`）。 */
        return [
          ...fs
            .readFileSync(
              path.join(__dirname, "base-check", "chained-steps.mjs"),
              "utf8",
            )
            .matchAll(/\{ script: "([^"]+)" \}/g),
        ]
          .map((m) => m[1])
          .includes(fact.script);
      default:
        return false;
    }
  };

  /* ① 每一行点名的事实仍然存在。 */
  const declared = new Set();
  for (const d of duties) {
    const key = factKey(d.fact);
    declared.add(key);
    if (!factExists(d.fact)) {
      problems.push(
        `「${d.name}」点名的机器事实不存在（${key}）——` +
          `档被删了 / 改名了 / 已经接进 all 了？索引是一句过期的承诺，删掉这一行或改对`,
      );
    }
    report.push(`${d.id}\t${d.name}\t${key}\t${d.executor}`);
  }

  /* ② 每一个机器事实都被登记（新增一档却忘了登记 ⇒ 那一档谁都不判）。 */
  const expected = [
    ...tracks.map((k) => `freshness-track:${k}`),
    ...[...gates.notInAll].map((g) => `gate-not-in-all:${g}`),
    ...onDemand.map((s) => `on-demand-ledger:${s}`),
  ];
  for (const key of expected) {
    if (!declared.has(key)) {
      problems.push(
        `机器事实「${key}」没有被本索引登记 —— 它是一条「不进钩子」的档，` +
          `而 §13.5.4 的缝就是「代价判据不回答『谁在什么时候跑它』」（同 §13.5.12）：` +
          `在 scripts/.on-demand-duties.json 加一行，答出执行者`,
      );
    }
  }

  return finish();
}

/** 「事实键」的规范写法（`kind` + 标识），用于双向集合比较。 */
function factKey(fact) {
  switch (fact?.kind) {
    case "freshness-track":
      return `freshness-track:${fact.key}`;
    case "gate-not-in-all":
      return `gate-not-in-all:${fact.gate}`;
    case "gate-in-all":
      return `gate-in-all:${fact.gate}`;
    case "on-demand-ledger":
      return `on-demand-ledger:${fact.script}`;
    case "base-check-chained":
      return `base-check-chained:${fact.script}`;
    default:
      return `unknown:${JSON.stringify(fact)}`;
  }
}

function finish() {
  if (problems.length === 0) {
    process.stdout.write(
      `[on-demand-duties] ✓ 按需档 ⇄ 执行者索引在场（${report.length} 行，双向核对通过）\n`,
    );
    if (REPORT_ONLY) {
      process.stdout.write(`${report.map((l) => `  ${l}`).join("\n")}\n`);
    }
    return 0;
  }
  process.stdout.write(
    `[on-demand-duties] 按需档索引有 ${problems.length} 处问题（规范 §13.5.4）：\n`,
  );
  for (const p of problems) process.stdout.write(`  · ${p}\n`);
  if (REPORT_ONLY) return 0;
  return 1;
}

main().then((code) => process.exit(code));
