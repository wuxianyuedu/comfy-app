#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:非空断言 `!` 计数棘轮(供 .githooks/pre-commit 与 CI 调用)
/**
 * src/lib 生产代码非空断言 `!` 计数棘轮 —— 类型安全审查 src/lib 报告的低段收尾。
 *
 * 背景:项目审计时 src/lib 生产代码里有 ~102 处 `!`(35 个文件),分布两类:
 *   · **filter/map 不 narrow 的病灶** — 13 处,已在本轮 6 个 PR 里消掉
 *     (PR-1 secrets / PR-2 filter+withPort / PR-5 trainer 归一化 / PR-8
 *     script-parser 模板 / PR-12 canvas-api / param-mapping / model-mode-contract);
 *   · **`arr[i]!` / `match[N]!`** — 打开 `noUncheckedIndexedAccess` 后的
 *     合法惯用法,~89 处,不属病灶但也不该无约束地继续长出。
 *
 * 直接开 `@typescript-eslint/no-non-null-assertion` 会一次报 100+ 处、远超类型
 * 审计边界。合理路径是**棘轮基线**:把当前 102 记成基线,只挡**新增**、允许
 * 逐步下降。这与 `check-function-length.cjs`(§12.13)与 `check-code-duplication.cjs`
 * (§12.12)的机制同构。
 *
 * 判据走 TypeScript AST (`ts.isNonNullExpression`),不用正则——正则会把
 * `!==` / `!x` / `! /* 注释` 之类误伤,而 AST 只认 `<expr>!` 这一形状。
 *
 * 扫描范围:只 src/lib 下的 .ts/.tsx 非测试文件。lib 是被 components / app / server
 * 共同依赖的地基(§18),这一层收紧即可,视图与路由侧的 `!` 不在本次审计边界。
 *
 * 用法:
 *   node scripts/check-non-null-assertions.cjs           # 检查(棘轮)
 *   node scripts/check-non-null-assertions.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-non-null-assertions.cjs --report  # 只出清单不判失败
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".non-null-assertions-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const REPORT_ONLY = ARGS.has("--report");

/** 判据版本:`ts.isNonNullExpression` 语义固定,不会漂;留号便于将来
 *  把 `x?.y!` / `<T>x!` 之类扩展形态纳入时区分。 */
const RULE_VERSION = 1;

const SCAN_DIR = "src/lib";
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) || rel.includes("/__tests__/");

/** 递归收集 .ts/.tsx 文件(跳过测试与 .d.ts)。 */
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

/** 用 TS AST 数一个文件里 `NonNullExpression` 节点的出现次数。 */
function countFor(rel) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(
    rel,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  let count = 0;
  const visit = (node) => {
    if (ts.isNonNullExpression(node)) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/** 读基线;返回 { files: { 相对路径 → 计数 }, total }。缺文件视为首次运行。 */
function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  } catch (e) {
    console.error(`[non-null] 基线文件损坏：${e.message}`);
    process.exit(1);
  }
}

/** 写基线文件(带 generatedAt / ruleVersion / note)。 */
function writeBaseline(files, total) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ruleVersion: RULE_VERSION,
    note: "src/lib 生产代码里 `!` 非空断言的数量(棘轮,只许降不许升)。判据:TypeScript AST 的 NonNullExpression。规则版本变了必须同步改脚本常数。",
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
      `[non-null] src/lib 生产代码 ${total} 处 \`!\` 分布 ${Object.keys(current).length} 个文件`,
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
        `[non-null] 拒绝 --update:当前 ${total} > 基线 ${baseline.total}。棘轮只许降不许升,\n` +
          `  新增的先按判据改写(type predicate / ?? 兜底 / 显式 narrow),再 --update。\n` +
          `  若确属判据变更(现为 RULE_VERSION=${RULE_VERSION}),须先改脚本里的常数再 --update。`,
      );
      process.exit(1);
    }
    writeBaseline(current, total);
    console.log(
      `[non-null] 基线已重写:总 ${total} 处 / ${Object.keys(current).length} 文件`,
    );
    return;
  }

  if (!baseline) {
    console.log(
      `[non-null] 基线未建立:当前 ${total} 处 \`!\`。\n` +
        `  先跑 node scripts/check-non-null-assertions.cjs --update 建立基线,再进棘轮模式。`,
    );
    return;
  }

  if (baseline.ruleVersion !== RULE_VERSION) {
    console.error(
      `[non-null] 基线判据版本不一致(基线 v${baseline.ruleVersion} → 脚本 v${RULE_VERSION}):\n` +
        `  判据变了,旧基线数字不再是同一个量。请执行 node scripts/check-non-null-assertions.cjs --update\n` +
        `  (前提:新的 \`!\` 数已按当前判据人工审过)。`,
    );
    process.exit(1);
  }

  const problems = [];
  for (const [rel, n] of Object.entries(current)) {
    const base = baseline.files[rel] ?? 0;
    if (n > base) {
      problems.push(
        `  · ${rel}: 基线 ${base} → 当前 ${n}(新增 ${n - base} 处 \`!\`)`,
      );
    }
  }
  if (problems.length > 0) {
    console.error(
      "[non-null] src/lib 里新增非空断言(§18 lib 规范 + 类型安全审查 src/lib 报告 Low 段):\n" +
        problems.join("\n") +
        "\n  修法:改用 type predicate(如 (x): x is T => 判据)/ ?? 兜底 / 显式空值守卫,\n" +
        "  让**判据与用法**同一处落地,而不是把「同一件事用两次」写进类型系统。\n" +
        "  若确属合理用法(罕见),先 `node scripts/check-non-null-assertions.cjs --update` 之外,须给评审说明。",
    );
    process.exit(1);
  }

  const reduced =
    total < baseline.total
      ? ` (较基线 ${baseline.total} 降 ${baseline.total - total},可 --update 收紧)`
      : "";
  console.log(
    `[non-null] src/lib \`!\` 总数 ${total}(基线 ${baseline.total})${reduced}`,
  );
  console.log("[non-null] OK");
}

main();
