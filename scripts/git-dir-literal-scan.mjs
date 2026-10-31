#!/usr/bin/env node
/**
 * git-dir-literal-scan.mjs — 守「检出目录在哪」只有 `scripts/git-dir.mjs` 一处知道
 * （ISSUE #2072）。
 *
 * 为什么要有这个脚本：本仓曾经在四处各自 `path.join(root, 检出子目录, …)` 硬拼检出
 * 位置（`shell-gate` / `ci-workspace-probe` / `launcher-core/run` /
 * `check-deps-freshness`），而链接工作树里 `.git` 是个**文件**，硬拼指向它 ——
 * MERGE_HEAD / HEAD / FETCH_HEAD 永远查不到。修复把它们统一收口到 `git-dir.mjs` 的
 * `resolveGitDir`；这条判据防止下一次有人又顺手拼一个回去。
 *
 * ── 两点形状（ISSUE #2785 把它们补上）──────────────────────────────────────
 *
 * 1. **面收 `.mjs` 与 `.cjs`**。原来只收 `.mjs` ⇒ `scripts/**` 里那 86 份 CJS 全在面外，
 *    而 #2785 那一处（`check-reformat-only.cjs` 硬拼 `<根>/.git/MERGE_HEAD`，于是
 *    「合并提交豁免」在链接工作树里永不点火）**正是 CJS** —— 防这一族的判据恰好漏掉了
 *    这一族第二次发生的文件形态。这不是猜测：那处违规今天能被这台机器上的任何人一眼看到，
 *    而账面一条红都没有。
 * 2. **谓词判的是语法，不是字面量**。直接把面扩到 `.cjs` 会立刻报出 4 处，其中 **3 处是
 *    正当写法** —— `check-comment-language.cjs` / `check-cp936-glyphs.cjs` /
 *    `check-dead-exports.cjs` 里的 `[".git"]` 是**目录遍历的跳过名单**，不是"检出目录在哪"。
 *    把它们塞进白名单等于把这三份文件永久豁免掉这条判据（下一次它们真拼一个检出路径，
 *    没人会红）。所以改成：解析成 AST，只认 **`join(...)` / `resolve(...)` 的实参里那个
 *    字符串字面量等于 `.git`** 的形状。AST 顺带解决另一半噪声：注释与被当话术用的字符串
 *    （`console.error("请删掉 .git/MERGE_HEAD")` 那一类）天然不在判点里 —— 这正是 §13.5.x
 *    与 ISSUE #2660 反复付过学费的那条「整档搜字面量没有语义作用域」。
 *
 * 已知盲区（写出来，不假装没有）：只认 `join` / `resolve` 的**字符串字面量**实参。
 * 拼接与模板形态（`root + "/.git/MERGE_HEAD"`、`` `${root}/.git` ``）**不判** ——
 * 要判它就得同时判"这个字符串是不是被当话术用的"，那是语义而不是形状。
 * 历史四例全是 `path.join` 形态，所以这一格的量程与它付过的学费是对得上的。
 *
 * 用法：
 *   node scripts/git-dir-literal-scan.mjs            # 人读报告，有违例即非零退出
 *   node scripts/git-dir-literal-scan.mjs --json     # 机器读（供契约测试）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = path.join(ROOT, "scripts");
// 白名单只放 git-dir.mjs 自己（规范 §13.5.x）。用正斜杠，跨平台与 rel 归一一致。
const WHITELIST = new Set(["scripts/git-dir.mjs"]);
// needle 用拼接构造：本脚本自己的源码里也不该出现一个能被自己判成的字面量。
const NEEDLE = "." + "git";
/** 这一版扩面收的两种脚本宿主（ISSUE #2785：原来只有 `.mjs`，CJS 全在面外）。 */
const SCAN_EXTENSIONS = [".mjs", ".cjs"];

/**
 * 递归收集 `scripts/**` 下的 `.mjs` / `.cjs`（跳过 `node_modules`）。
 * @param {string} dir 起点目录（绝对路径）
 * @param {string[]} [out] 累加用的收集器 —— 递归各层共用**同一个数组**，
 *   所以返回值就是最初那次调用传进来的那一份（不写类型时默认值是 `never[]`，
 *   下面 `out.push(full)` 会报「推不进去」）
 * @returns {string[]} 收集到的文件绝对路径
 */
function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") {
        continue;
      }
      collect(full, out);
      continue;
    }
    if (SCAN_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 一份源码里的违例行（**纯函数**：文件名 + 原文进，违例清单出）。
 *
 * 导出它而不是只测整脚本：谓词是这一格的全部风险所在，而"真实仓库现在 0 命中"
 * 那种断言证不了任何一形（正例进不来、反例赶不走）。所以用例直接喂夹具 ——
 * 三种正当写法（遍历跳过名单 / 注释 / 话术字符串）必须不报，两种违规写法
 * （`.mjs` 与 `.cjs` 里的 `path.join(根, ".git", …)`）必须报。
 *
 * @param {string} rel 相对路径（只用于报告）
 * @param {string} src 文件原文
 * @returns {string[]} `相对路径:行号: 那一行的原文`
 */
export function scanSource(rel, src) {
  // 便宜的前置过滤：整份文件里连引号包住的 needle 都没有 ⇒ 不必解析（这格在固定清单里，
  // 每次提交都跑，不能为它付一遍 scripts/** 的解析钱）。
  if (!src.includes(`"${NEEDLE}"`) && !src.includes(`'${NEEDLE}'`) && !src.includes("`.git`")) {
    return [];
  }
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  /** @type {string[]} */
  const out = [];
  /** @param {ts.Node} node */
  const hit = (node) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const text = (src.split("\n")[line - 1] ?? "").trim();
    out.push(`${rel}:${line}: ${text}`);
  };
  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : "";
      if (name === "join" || name === "resolve") {
        for (const arg of node.arguments) {
          if (
            (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
            arg.text === NEEDLE
          ) {
            hit(arg);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * 扫一批文件（目录入口用；导出给用例喂显式清单）。
 * @param {string[]} files 绝对路径清单
 * @returns {string[]}
 */
export function scanFiles(files) {
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (WHITELIST.has(rel)) {
      continue;
    }
    offenders.push(...scanSource(rel, fs.readFileSync(file, "utf8")));
  }
  return offenders;
}

/* 只在**被直接执行**时判与退码 —— 导出给用例时不能顺手 process.exit(1)
 * （同款守卫与理由见 `scripts/generate-api-docs.mjs` 与 `tests/script-main-guard.test.ts`）。
 * `entry` 先落一个局部量：`process.argv[1]` 的类型是 `string | undefined`，
 * 隔着一个函数调用 TS 追不到那个非空收窄（`node --check` 不判它，脚本档 tsc 判）。 */
const entry = process.argv[1] ?? "";
if (entry !== "" && path.resolve(entry) === path.resolve(import.meta.filename)) {
  const offenders = scanFiles(collect(SCRIPTS));
  if (offenders.length) {
    process.stderr.write(
      `[git-dir-literal-scan] scripts/**（.mjs + .cjs）出现硬编码的 "${NEEDLE}" 路径拼接，` +
        "除 scripts/git-dir.mjs 外不允许：\n",
    );
    offenders.forEach((o) => process.stderr.write(`  ${o}\n`));
    process.exit(1);
  }
  const msg =
    "[git-dir-literal-scan] OK：检出子目录的路径拼接只存在于 scripts/git-dir.mjs（面含 .mjs + .cjs）";
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: true, offenders: [] }));
  } else {
    process.stdout.write(msg + "\n");
  }
}
