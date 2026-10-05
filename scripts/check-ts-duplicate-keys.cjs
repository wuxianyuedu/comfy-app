#!/usr/bin/env node
// @ts-nocheck -- 同一属性指定两次的判定档（供 .githooks/pre-commit 的 D 组调用）
/**
 * 「同一属性被指定两次」的判定档 —— 规范见 docs/standards/13-提交与-code-review.md §13.5.12。
 *
 * 为什么不用 `tsc --noEmit` 兜：项目钉的 TypeScript（`typescript6` 别名）对「对象
 * 字面量里属性重复、后一个覆盖前一个」并不报，而编辑器用的 TS 服务会报
 * `多次指定了 "right"，因此将重写此用法`。同一处代码于是命令行全绿、编辑器标红
 * —— 只能按**语法形态**扫，不靠某个编译器的诊断。
 *
 * 排除：展开赋值（`...x`）、计算键、非字面量键、`__proto__`（重复合法）。
 * 测试文件默认不扫（它们的重复多半是刻意夹具），要扫加 `--with-tests`。
 *
 * 形态沿革（ISSUE #1451 要求 2）：它此前是报告型（`scripts/report-ts-duplicate-keys.mjs`，
 * 0 处 `process.exit`），**没有任何判定档** —— 而它判的是「命令行全绿、编辑器标红」
 * 那一族（判据只能落在源码形态上的场景），正是该有判定档的地方。收成判定档的
 * 前提是**实测量产为 0**（`node scripts/check-ts-duplicate-keys.cjs` 现为 0 处），
 * 所以按**硬闸**落（有命中即阻断），不走棘轮 —— 棘轮是给「有存量、逐批治理」用的。
 * `--with-tests` 不进判定档：测试里的重复多半是有意夹具，接进钩子会误伤一片。
 *
 * 用法：
 *   node scripts/check-ts-duplicate-keys.cjs              # 检查（有命中即退 1）
 *   node scripts/check-ts-duplicate-keys.cjs --json       # 机器可读（盘点用）
 *   node scripts/check-ts-duplicate-keys.cjs --report     # 只出清单，不判失败（盘点用）
 *   node scripts/check-ts-duplicate-keys.cjs --with-tests # 连测试一起扫（不进钩子）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const reportOnly = argv.includes("--report");
const withTests = argv.includes("--with-tests");
const explicit = argv.filter((a) => !a.startsWith("--"));

const ts = require("typescript");

/** 属性名的字面量形态；计算键 / 展开 / 非字面量返回 null（判不了就不算）。 */
function staticName(name) {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
    return name.text;
  return null;
}

/** 一个对象字面量 / JSX 属性表里，同名键出现了几次。 */
function duplicateKeys(members, lineOf) {
  const seen = new Map();
  const found = [];
  for (const member of members) {
    if (ts.isSpreadAssignment(member) || ts.isSpreadElement(member)) continue;
    if (!member.name) continue;
    const name = staticName(member.name);
    if (!name || name === "__proto__") continue;
    const line = lineOf(member);
    if (seen.has(name)) found.push({ name, first: seen.get(name), line });
    else seen.set(name, line);
  }
  return found;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (
      /\.tsx?$/.test(entry.name) &&
      (withTests || !/\.test\.tsx?$/.test(entry.name))
    ) {
      yield full;
    }
  }
}

const files =
  explicit.length > 0 ? explicit.map((f) => path.resolve(ROOT, f)) : [...walk(SRC)];
const findings = [];

for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const visit = (node) => {
    const members = ts.isObjectLiteralExpression(node)
      ? node.properties
      : ts.isJsxAttributes(node)
        ? node.properties
        : null;
    if (members) {
      const kind = ts.isObjectLiteralExpression(node) ? "对象字面量" : "JSX 属性";
      for (const hit of duplicateKeys(members, lineOf)) {
        findings.push({ file, line: hit.line, name: hit.name, first: hit.first, kind });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (asJson) {
  console.log(JSON.stringify(findings, null, 2));
  process.exit(0);
}

if (findings.length === 0) {
  console.log(`扫描 ${files.length} 个文件：没有「同一属性指定两次」的写法 ✓`);
  process.exit(0);
}

console.log(
  `扫描 ${files.length} 个文件 → ${findings.length} 处「同一属性指定两次」\n`,
);
for (const f of findings) {
  console.log(
    `  ${path.relative(ROOT, f.file)}:${f.line}  ${f.kind}「${f.name}」（首次在第 ${f.first} 行）`,
  );
}

if (reportOnly) process.exit(0);

console.log(
  `\n这几处会让编辑器报 ts(2783)、而项目钉的 typescript6 命令行不报 —— ` +
    `命令行全绿、编辑器标红。删掉后一个（或合并两处写法）。`,
);
process.exit(1);
