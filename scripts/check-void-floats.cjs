#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:`void someFn(...)` 语句计数棘轮(供 .githooks/pre-commit 与 CI 调用)
/**
 * src/lib 里 `void someAsyncFn(...)` 语句形式的**计数棘轮** —— 类型安全审查 src/lib 报告
 * H-6 条目的机器化收口。
 *
 * 背景:PR-4b 加了 `fireAndForget(task, onError)` 作为「刻意不 await、失败必须
 * 落到一个显式 onError」的地基;PR-10 逐个审了 lib 里 30+ 处 `void fn()`,把
 * 10 处真漏改走 fireAndForget。但**人工审计会漂**——下一个开发者写下
 * `void persistLogs(taskId)`(被调方若没有内部 catch)就是一颗**未来的
 * unhandledRejection**,pre-commit 不会响。
 *
 * 直接开 eslint `@typescript-eslint/no-floating-promises` 会一次报几百处
 * (`void fetch(...)`, `void someFn().catch(...)`, 未 await 但没 `void` 前缀
 * 的裸 Promise.all 之类),评审看下来全是"这里合理"的噪声。合理机制是**基线
 * 棘轮**、只挡新增形态:
 *   · 判据走 TypeScript AST —— 只认「ExpressionStatement 的 expression 是
 *     UnaryExpression(operator=`void`, argument=`CallExpression`)」这一形状;
 *   · 扫描范围 src/lib 下的 .ts/.tsx 非测试文件;
 *   · 每文件当前计数落进 `scripts/.void-floats-baseline.json`,只挡**新增**、
 *     允许下降(--update 需伴随下降)。
 *
 * 与 `check-non-null-assertions.cjs`(PR-17/18)、`check-function-length.cjs`
 * (§12.13)、`check-code-duplication.cjs`(§12.12)同构。
 *
 * **不做什么**:
 *   · 不去解析「被调 async 函数体内是否有 try/catch」——那需要跨模块的
 *     数据流分析,是 no-floating-promises 完整版的活。本判据只是**强制显式**:
 *     写下 `void someFn()` 这个形态本身就该走一次评审(要么改用 fireAndForget、
 *     要么在评审里说明「被调方内部 catch,这里是刻意悬空」),不能悄悄写下去。
 *   · 不看 `someFn().catch(...)` / `await someFn()` / 裸 `someFn()`——那些形态
 *     要么显式接管了 Promise、要么 eslint `no-floating-promises` 完整版会管,
 *     不在本判据的边界内。
 *   · 视图层(src/components / src/app)不扫——React 组件里的 `void someFn()`
 *     多为「事件处理器里 fire-and-forget」的常见形态,是**表现层职责**。
 *     本判据只覆盖地基 lib 侧。
 *
 * 用法:
 *   node scripts/check-void-floats.cjs           # 检查(棘轮)
 *   node scripts/check-void-floats.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-void-floats.cjs --report  # 只出清单不判失败
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".void-floats-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const REPORT_ONLY = ARGS.has("--report");
const STRICT = ARGS.has("--strict");

/**
 * 判据版本:`UnaryExpression(void) 包 CallExpression 作为整条语句` 是唯一形态。
 * 将来若把 `someFn()` 无 `void` 前缀的裸 Promise 悬空也计进来,必须同步改
 * 这个常数;旧基线数字与新计数不是同一个量。
 */
const RULE_VERSION = 1;

const SCAN_DIR = "src/lib";
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) || rel.includes("/__tests__/");

function collectFiles(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).split(path.sep).join("/");
    const full = path.join(ROOT, rel);
    if (entry.isDirectory()) {
      collectFiles(rel, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    if (isTestFile(rel)) continue;
    out.push(rel);
  }
  return out;
}

function countFor(rel) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(
    rel,
    src,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node) => {
    if (
      ts.isExpressionStatement(node) &&
      node.expression.kind === ts.SyntaxKind.VoidExpression &&
      ts.isCallExpression(node.expression.expression)
    ) {
      const call = node.expression.expression;
      // `void someFn().catch(...)`：链尾 `.catch` 是**显式**接管 rejection 的形态,
      // 不属于「悄悄悬空」的病灶;跳过。`void someFn().finally(...)` 不接住
      // rejection（`.finally` 只是"无论成败都跑"）,仍然计入。
      const isCatchChain =
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "catch";
      if (!isCatchChain) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch (e) {
    console.error(`[void-floats] 基线文件损坏: ${e.message}`);
    process.exit(1);
  }
}

function writeBaseline(files, total) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ruleVersion: RULE_VERSION,
    note: "src/lib 生产代码里 `void someFn(...)` 语句形式的数量(棘轮,只许降不许升)。判据:TypeScript AST 的 ExpressionStatement > UnaryExpression(void) > CallExpression。规则版本变了必须同步改脚本常数。",
    total,
    files,
  };
  fs.writeFileSync(BASELINE, JSON.stringify(payload, null, 2) + "\n");
}

function main() {
  const files = collectFiles(SCAN_DIR).sort();
  const current = {};
  let total = 0;
  for (const rel of files) {
    const n = countFor(rel);
    if (n > 0) {
      current[rel] = n;
      total += n;
    }
  }

  if (REPORT_ONLY) {
    console.log(
      `[void-floats] src/lib \`void someFn(...)\` 共 ${total} 处,分布 ${Object.keys(current).length} 个文件`,
    );
    for (const [rel, n] of Object.entries(current).sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  · ${n} 处  ${rel}`);
    }
    return;
  }

  const baseline = readBaseline();

  if (UPDATE) {
    if (
      baseline &&
      baseline.ruleVersion === RULE_VERSION &&
      total > baseline.total
    ) {
      console.error(
        `[void-floats] 拒绝 --update: 当前 ${total} > 基线 ${baseline.total}。棘轮只许降不许升,\n` +
          `  新增的先改用 fireAndForget(p, onError),或在评审里说明「被调方内部已 catch、\n` +
          `  这里是刻意悬空」再 --update。若确属判据变更(现为 RULE_VERSION=${RULE_VERSION}),\n` +
          `  须先改脚本里的常数再 --update。`,
      );
      process.exit(1);
    }
    writeBaseline(current, total);
    console.log(
      `[void-floats] 基线已重写: 总 ${total} 处 / ${Object.keys(current).length} 文件`,
    );
    return;
  }

  if (!baseline) {
    console.log(
      `[void-floats] 基线未建立: 当前 ${total} 处 \`void someFn(...)\`。\n` +
        `  先跑 node scripts/check-void-floats.cjs --update 建立基线,再进棘轮模式。`,
    );
    return;
  }

  if (baseline.ruleVersion !== RULE_VERSION) {
    console.error(
      `[void-floats] 基线判据版本不一致(基线 v${baseline.ruleVersion} → 脚本 v${RULE_VERSION}):\n` +
        `  判据变了,旧基线数字不再是同一个量。请执行 node scripts/check-void-floats.cjs --update\n` +
        `  (前提:新的 \`void fn()\` 数已按当前判据人工审过)。`,
    );
    process.exit(1);
  }

  const problems = [];
  for (const [rel, n] of Object.entries(current)) {
    const base = baseline.files[rel] ?? 0;
    if (n > base) {
      problems.push(
        `  · ${rel}: 基线 ${base} → 当前 ${n}(新增 ${n - base} 处 \`void someFn(...)\`)`,
      );
    }
  }
  if (problems.length > 0) {
    console.error(
      "[void-floats] src/lib 里新增 `void someFn(...)` 语句(§18 lib 规范 + 类型安全审查 src/lib H-6):\n" +
        problems.join("\n") +
        "\n  默认修法:改用 `fireAndForget(someFn(), (e) => { /* 明确失败通道 */ })` ——\n" +
        "  见 src/lib/async-action.ts。若被调函数**内部已经 catch**、这里就是刻意悬空,\n" +
        "  也请在评审里说明这一点再 `--update` 收紧基线,不要悄悄写下。\n" +
        "  `void fetch(...)` / `void someFn().catch(...)` 这类形态不在本判据内,\n" +
        "  但同样是 fire-and-forget —— 优先迁到 fireAndForget。",
    );
    process.exit(1);
  }

  const dropped = Object.entries(baseline.files)
    .map(([rel, base]) => [rel, current[rel] ?? 0, base])
    .filter(([, cur, base]) => cur < base);
  if (dropped.length > 0) {
    const msg =
      `[void-floats] 检测到 ${dropped.length} 个文件下降,请收紧基线:\n  ` +
      dropped
        .map(([rel, cur, base]) => `${rel}: ${base} → ${cur}`)
        .join("\n  ") +
      "\n  执行 node scripts/check-void-floats.cjs --update";
    if (STRICT) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg + " (当前非 --strict,仅提示)");
  }
  console.log(
    `[void-floats] src/lib \`void someFn()\` 总数 ${total}(基线 ${baseline.total})`,
  );
  console.log("[void-floats] OK");
}

main();
