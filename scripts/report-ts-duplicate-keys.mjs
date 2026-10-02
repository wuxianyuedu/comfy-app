#!/usr/bin/env node
/**
 * 汇总「同一属性被指定两次」的写法（编辑器报 `ts(2783)` 的那一类）。
 *
 * 为什么不用 `tsc --noEmit` 兜：项目钉的 TypeScript（`typescript6` 别名）对「对象
 * 字面量里属性重复、后一个覆盖前一个」并不报，而编辑器用的 TS 服务会报
 * `多次指定了 "right"，因此将重写此用法」。同一处代码于是命令行全绿、编辑器标红
 * —— 只能按**语法形态**扫，不靠某个编译器的诊断。
 *
 * 排除：展开赋值（`...x`）、计算键、非字面量键、`__proto__`（重复合法）。
 * 测试文件默认不扫（它们的重复多半是刻意夹具），要扫加 `--with-tests`。
 *
 * 用法：node scripts/report-ts-duplicate-keys.mjs [文件…] [--json] [--with-tests]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const withTests = argv.includes("--with-tests");
const explicit = argv.filter((a) => !a.startsWith("--"));
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
  explicit.length > 0
    ? explicit.map((f) => path.resolve(ROOT, f))
    : [...walk(SRC)];
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
      const kind = ts.isObjectLiteralExpression(node)
        ? "对象字面量"
        : "JSX 属性";
      for (const hit of duplicateKeys(members, lineOf)) {
        findings.push({
          file,
          line: hit.line,
          name: hit.name,
          first: hit.first,
          kind,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (asJson) {
  console.log(JSON.stringify(findings, null, 2));
} else if (findings.length === 0) {
  console.log(`扫描 ${files.length} 个文件：没有「同一属性指定两次」的写法 ✓`);
} else {
  console.log(
    `扫描 ${files.length} 个文件 → ${findings.length} 处「同一属性指定两次」\n`,
  );
  for (const f of findings) {
    console.log(
      `  ${path.relative(ROOT, f.file)}:${f.line}  ${f.kind}「${f.name}」（首次在第 ${f.first} 行）`,
    );
  }
}
