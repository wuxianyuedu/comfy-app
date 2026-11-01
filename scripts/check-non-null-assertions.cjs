#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:非空断言 `!` 硬闸(供 .githooks/pre-commit 与聚合档调用)
/**
 * src 生产代码非空断言 `!` **硬闸**（须为 0）—— 类型安全审查 src/lib 报告 Low 段的**扩展**。
 *
 * 背景:lib 侧的 filter/map 不 narrow 病灶 13 处已在本轮 6 个 PR 消化完
 * (PR-1 secrets / PR-2 filter+withPort / PR-5 trainer 归一化 / PR-8
 * script-parser 模板 / PR-12 canvas-api / param-mapping / model-mode-contract);
 * 剩下的是 `arr[i]!` / `match[N]!` 一类 `noUncheckedIndexedAccess` 合法惯用法的
 * 存量。lib 单独收口之后,components / app / server 同样有一批 `!`(热区如
 * `use-settings-page.ts` 尤其多),若**只挡 lib**、病灶就会往视图层漂移,基线
 * 棘轮的防护就漏一半。合理路径是把扫描范围**扩到整个 src**。
 *
 * 直接开 `@typescript-eslint/no-non-null-assertion` 一次会报几百处、评审全是
 * 噪声。所以本仓走了**两步**：先以基线棘轮把存量清干净（160 处分布 69 个文件，
 * 见 ISSUE #1811），存量归零之后**翻成硬闸** —— 棘轮在 0 上只剩坏处：
 * `--update` / `--strict` 两个动作都无事可做，留下的却是一条「手改那份 JSON
 * 就能把新违规登记成已知存量」的通道（硬闸类本来没有的中间态，规范 §13.6.2）。
 *
 * **合法例外走另一条已经存在的车道**：`LEGIT_SITES` 逐条登记「这个下标/返回值
 * 在结构上必然存在」（正则捕获组、drizzle 判据构造），不是「跑起来没出过问题」。
 *
 * 判据走 TypeScript AST (`ts.isNonNullExpression`),不用正则——正则会把
 * `!==` / `!x` / 注释里的裸 `!` 误伤,而 AST 只认 `<expr>!` 这一形状。
 *
 * 扫描范围:src 下的 .ts/.tsx 非测试文件(测试文件里 `expect(x!.field)` 是
 * 常见形态、`.d.ts` 是类型声明,一并豁免)。
 *
 * 用法:
 *   node scripts/check-non-null-assertions.cjs           # 检查(硬闸:命中即退 1)
 *   node scripts/check-non-null-assertions.cjs --report  # 只出清单不判失败
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");

/** 扫描根。**必须在 `--staged` 短路之前**（见下），所以提到这里。 */
const SCAN_DIR = "src";

/* `--staged`（钩子用）＝ **输入面跳过**：暂存里没有一个文件落在扫描面内时短路，
 * 打印理由后 exit 0（见 §13.5.8.2、`scripts/gate-scan-read.cjs`）。
 * 短路点放在 `require("typescript")` **之前** —— 那一步模块加载实测约 180ms，
 * 放在后面的话「跳过」档也照样付这笔钱，省下的那一步就白省了。 */
if (STAGED && !REPORT_ONLY) {
  require("./gate-scan-read.cjs").skipUnlessStagedTouches({ roots: [SCAN_DIR], tag: "[non-null]" });
}

const ts = require("typescript");

const isTestFile = (rel) => /\.test\.[cm]?[jt]sx?$/.test(rel) || rel.includes("/__tests__/");

/* ── 已登记的合法形态（正则捕获组 / drizzle 判据构造）────────────────────
 *
 * 为什么需要它:`arr[N]!` 一族里**有两种**东西。一种是「本来该用判据或兜底」
 * 的病灶(本轮清了 148 处,160 → 12);另一种是 `RegExpExecArray` 的捕获组
 * —— `exec()` 成功返回的数组**结构上必有**这些下标,`!` 在这里不是省略判据,
 * 而是**唯一准确的表达**(写 `?? ""` 会把「匹配到了但组是空」也一起吞掉)。
 *
 * 规范 §13.5.6 自己也写着「`arr[i]!` / `match[N]!` 是 `noUncheckedIndexedAccess`
 * 打开后的**合法惯用法**」。所以这一族不走「改造代码」,走**逐站点登记**:
 * 键是「文件 + 变量名 + 组下标」,值写明它为什么必然存在。**不用行号做键**
 * —— 行号会随无关改动漂移,漂了就等于没登记。
 *
 * `repository-skill.ts` 那条是同一族里的另一成员:drizzle 的 `or(...)` 在
 * 传入了判据时必有返回,而它的类型是 `SQL | undefined`。
 *
 * 新登记一条的门槛:必须能指着代码说出「这个下标/返回值在**结构上**必然存在」
 * (正则组的定义、被调方的返回契约),而不是「跑起来没出过问题」。 */
const LEGIT_SITES = new Map([
  /* PROGRESS::(scan|hash)|(.*) —— 第 2 组就是 `|` 之后的整段。 */
  ["src/app/api/custom-nodes/route.ts|m|2", "exec 第 2 组"],
  /* /\|?msg=([^|]*)/ —— 第 1 组必有（可以为空串）。 */
  ["src/app/api/custom-nodes/route.ts|msgM|1", "exec 第 1 组"],
  /* /\|?(discovered|done|total)=(\d+)/g —— 第 1/2 组都在模式里。 */
  ["src/app/api/custom-nodes/route.ts|kv|1", "exec 第 1 组"],
  ["src/app/api/custom-nodes/route.ts|kv|2", "exec 第 2 组"],
  /* /^#{1,3}\s+(.+?)\s*$/ —— 第 1 组是标题文本。 */
  ["src/components/studio/workflow-utils.ts|match|1", "exec 第 1 组"],
  /* /frame-ancestors([^;]*)/i —— 第 1 组是指令值。 */
  ["src/lib/comfy/comfy-embed.ts|directive|1", "exec 第 1 组"],
  /* /\s*\(([^)]+)\)\s*$/ —— 第 1 组是括号里的库名。 */
  ["src/lib/comfyui/node-titles.ts|parenMatch|1", "exec 第 1 组"],
  /* /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/ —— 第 2 组是值（可以为空串）。 */
  ["src/lib/envfile.ts|match|2", "exec 第 2 组"],
  /* /```(?:json)?\s*([\s\S]*?)```/i —— 第 1 组是围栏内容。 */
  ["src/lib/llm/parse.ts|fence|1", "exec 第 1 组"],
  /* 地点 / 时间词表 —— 第 1 组就是命中的词。 */
  ["src/lib/workshop/script-parser.ts|locMatch|1", "exec 第 1 组"],
  ["src/lib/workshop/script-parser.ts|timeMatch|1", "exec 第 1 组"],
  /* drizzle `or(...)`：传了判据必有返回（类型上是 `SQL | undefined`）。 */
  ["src/lib/core/repository-skill.ts|call:or|", "drizzle or() 传入判据时必有返回"],
]);

/**
 * 这条 `!` 是不是已登记的合法形态（见 {@link LEGIT_SITES}）?
 *
 * 判据只看**形状**，不看行号：`<ident>!` / `<ident>[<idx>]!` / `or(...)!`。
 *
 * @param {string} rel 仓库根相对路径
 * @param {import("typescript").NonNullExpression} node
 * @returns {boolean}
 */
function isLegitSite(rel, node) {
  const expr = node.expression;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return LEGIT_SITES.has(`${rel}|call:${expr.expression.text}|`);
  }
  if (!ts.isElementAccessExpression(expr)) {
    return false;
  }
  const target = expr.expression;
  if (!ts.isIdentifier(target)) {
    return false;
  }
  const index = expr.argumentExpression ? expr.argumentExpression.getText() : "";
  return LEGIT_SITES.has(`${rel}|${target.text}|${index}`);
}

/** 递归收集 .ts/.tsx 文件(跳过测试与 .d.ts)。 */
function collectFiles(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) {
    return out;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).split(path.sep).join("/");
    if (entry.isDirectory()) {
      collectFiles(rel, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) {
      continue;
    }
    if (entry.name.endsWith(".d.ts")) {
      continue;
    }
    if (isTestFile(rel)) {
      continue;
    }
    out.push(rel);
  }
  return out;
}

/**
 * 规则本体:数一份**已解析**源码里 `NonNullExpression` 节点的出现次数。
 *
 * **只吃已解析的 `SourceFile`**，不自己解析 —— 这是「共享颗粒度」的落点
 * （§13.5.8.2「第四笔账」）:解析全量 ≈550ms,由 `gate-ast-read.cjs` /
 * `run-ast-gates.cjs` 做一次,规则只遍历、只判定。
 *
 * @param {import("typescript").SourceFile} sf
 * @returns {number}
 */
function countTree(sf, rel = "") {
  let count = 0;
  const visit = (node) => {
    if (ts.isNonNullExpression(node) && !isLegitSite(rel, node)) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return count;
}

/**
 * 单条脚本自己的入口:解析一份文件再数。
 *
 * @param {string} rel 仓库根相对路径
 * @param {Map<string, import("typescript").SourceFile>} [parsed]
 *   聚合档 `run-ast-gates.cjs` 注入的**共享解析结果**（键 = 该 `rel`）。
 *   传了就复用，不再逐文件 `createSourceFile` —— 只共享解析产物，不共享遍历/判定。
 *   不传 = 老路径，行为一字不变。
 */
function countFor(rel, parsed) {
  const shared = parsed && parsed.get(rel);
  if (shared) {
    return countTree(shared, rel);
  }
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, "utf8");
  return countTree(
    ts.createSourceFile(
      rel,
      src,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
    rel,
  );
}

function main(parsed) {
  const files = collectFiles(SCAN_DIR).sort();
  const current = {};
  let total = 0;
  for (const rel of files) {
    const n = countFor(rel, parsed);
    if (n > 0) {
      current[rel] = n;
      total += n;
    }
  }

  if (REPORT_ONLY) {
    console.log(
      `[non-null] src 生产代码 ${total} 处 \`!\` 分布 ${Object.keys(current).length} 个文件`,
    );
    for (const [rel, n] of Object.entries(current).sort((a, b) => b[1] - a[1])) {
      console.log(`  · ${n} 处  ${rel}`);
    }
    return;
  }

  if (Object.keys(current).length > 0) {
    console.error(
      `[non-null] src 里出现非空断言 \`!\`(§18 lib 规范 + 类型安全审查 src/lib 报告 Low 段的扩展):\n${
        Object.entries(current)
          .sort((a, b) => b[1] - a[1])
          .map(([rel, n]) => `  · ${rel}: ${n} 处`)
          .join("\n")
        }\n  修法:改用 type predicate(如 (x): x is T => 判据)/ ?? 兜底 / 显式空值守卫 / \`for...of\`,\n` +
        `  让**判据与用法**同一处落地,而不是把「同一件事用两次」写进类型系统。\n` +
        `  若确属「下标/返回值在结构上必然存在」的合法用法(如正则捕获组),\n` +
        `  在脚本的 \`LEGIT_SITES\` 里逐条登记理由 —— 那是这条判据唯一的例外车道。`,
    );
    process.exit(1);
  }

  console.log("[non-null] src 生产代码 0 处 `!`");
  console.log("[non-null] OK");
}

/* 规则本体导出给聚合档 `run-ast-gates.cjs`（单条脚本行为不变）。 */
module.exports = { countTree, countFor, collectFiles, main, SCAN_DIR, isTestFile, LEGIT_SITES };

if (require.main === module) {
  main();
}
