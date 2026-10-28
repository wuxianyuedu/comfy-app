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
 *   --staged（钩子用）仅当暂存改动落在扫描面（`src/**`）内才扫，口径见 §13.5.8.2
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const reportOnly = argv.includes("--report");
const withTests = argv.includes("--with-tests");
const explicit = argv.filter((a) => !a.startsWith("--"));
const staged = argv.includes("--staged");

/* `--staged`（钩子用）＝ 输入面跳过（§13.5.8.2）。短路点在 `require("typescript")`
 * 之前 —— 那一步 ≈180ms；人的动作（`--json` / `--report` / `--with-tests`）与显式
 * 文件入参照旧全扫。 */
if (staged && !asJson && !reportOnly && !withTests && explicit.length === 0) {
  require("./gate-scan-read.cjs").skipUnlessStagedTouches({ roots: ["src"], tag: "[ts-duplicate-keys]" });
}

const { parseSources, tsOrNull, vanishedNote, visitEach } = require("./gate-ast-read.cjs");

/* 惰性：本层的 `tsOrNull()` 不在模块顶层加载 typescript —— 「跳过」那条路径
 * 一次模块加载都不该发生（`--staged` 短路点在上面，§13.5.8.2 第一个坑）。 */
const ts = tsOrNull();
if (!ts) {
  console.warn("[ts-duplicate-keys] 未找到 typescript（node_modules 未安装），跳过（tsc 步骤同样需要它）");
  process.exit(0);
}

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

/**
 * 规则本体：一份**已解析**源码里「同一属性指定两次」的站点。
 *
 * **只吃已解析的 `SourceFile`**，不自己解析 —— 这是「共享颗粒度」的落点
 * （§13.5.8.2「第四笔账」）：解析由 `gate-ast-read.cjs` / `run-ast-gates.cjs`
 * 做一次，规则只遍历、只判定。
 *
 * @param {import("typescript").SourceFile} source
 * @param {string} absPath 展示用路径（与单条脚本的历史输出一致，仍是绝对路径）
 * @returns {{file:string,line:number,name:string,first:number,kind:string}[]}
 */
function scanTree(source, absPath) {
  const out = [];
  const lineOf = (node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  visitEach(source, (node) => {
    const members = ts.isObjectLiteralExpression(node)
      ? node.properties
      : ts.isJsxAttributes(node)
        ? node.properties
        : null;
    if (members) {
      const kind = ts.isObjectLiteralExpression(node) ? "对象字面量" : "JSX 属性";
      for (const hit of duplicateKeys(members, lineOf)) {
        out.push({ file: absPath, line: hit.line, name: hit.name, first: hit.first, kind });
      }
    }
  });
  return out;
}

function main(parsed) {
const findings = [];
let scanned = 0;

/** 一份文件一遍：解析由共享层给，规则（对象字面量 / JSX 属性表的重复键）在这里。 */
function scanOne(source, absPath) {
  findings.push(...scanTree(source, absPath));
}

if (explicit.length > 0) {
  /* 显式文件入参是「人的动作」（盘点某一批文件），与 `--report` / `--with-tests`
   * 同档：仍然全量解析这些文件，不走 `--staged` 的输入面跳过。 */
  for (const file of explicit.map((f) => path.resolve(ROOT, f))) {
    const text = fs.readFileSync(file, "utf8");
    const display = path.relative(ROOT, file).split(path.sep).join("/");
    scanOne(
      ts.createSourceFile(
        display,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
      display,
    );
    scanned += 1;
  }
} else if (parsed) {
  /* 聚合档注入的共享解析结果（键 = 绝对路径）：一次解析、这里只遍历。
   * 文件清单也**不重新走** `parseSources` 的解析路径（那会让这一条把全库再解析
   * 一遍，正是本档要消灭的那件事）—— 只按同一枚举口径取名字，再查注入的 map。 */
  const skip = withTests ? null : /\.test\.tsx?$/;
  /* map 每份文件存了两个键（相对 + 绝对），按**绝对路径键**取一次即可 ——
   * 用「键是不是绝对路径」去重，不靠 `sourceFile.fileName` 与键相等
   * （那在两种键形态下都成立，判起来反而绕）。 */
  const seen = new Set();
  for (const [key, sourceFile] of parsed) {
    if (!path.isAbsolute(key)) continue;
    if (seen.has(sourceFile)) continue;
    seen.add(sourceFile);
    if (!/\.tsx?$/.test(key)) continue;
    if (path.basename(key).endsWith(".d.ts")) continue;
    if (skip && skip.test(path.basename(key))) continue;
    scanOne(sourceFile, key);
    scanned += 1;
  }
} else {
  const result = parseSources({
    roots: ["src"],
    root: ROOT,
    skipFileRe: withTests ? null : /\.test\.tsx?$/,
    perSource: ({ abs, sourceFile }) => {
      scanOne(sourceFile, abs);
      scanned += 1;
    },
    deps: { ts },
  });
  if (result.missing > 0) {
    console.log(`[ts-duplicate-keys]${vanishedNote(result.missing)}`);
  }
}

if (asJson) {
  console.log(JSON.stringify(findings, null, 2));
  process.exit(0);
}

if (findings.length === 0) {
  console.log(`扫描 ${scanned} 个文件：没有「同一属性指定两次」的写法 ✓`);
  process.exit(0);
}

console.log(
  `扫描 ${scanned} 个文件 → ${findings.length} 处「同一属性指定两次」\n`,
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
}

/* 规则本体导出给聚合档 `run-ast-gates.cjs`（单条脚本行为不变）。 */
module.exports = { scanTree, main };

if (require.main === module) main();
