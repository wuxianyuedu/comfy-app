#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:软断言(expect.soft)的使用面(供 .githooks/pre-commit 调用)
/**
 * `expect.soft` 用在**哪里**才算对 —— 规范见 docs/standards/11-测试与可观测性.md §11.18。
 *
 * 它唯一的用途是「一张清单逐项判、一项失败不影响下一项」：报错从「第一个坏的
 * 是哪个」变成「坏的都有哪些」。硬断言在第一条失败上停，一张 30 条的清单要修
 * 30 轮才看得全 —— `theme-token-single-source` 的别名表、`ps1-consistency` 的
 * 双侧门禁名、`sqlite-pragma-sites` 的三站点 × 四判据都是这个形状。
 *
 * 但它**不是**「不早停」的通用开关。用在顺序依赖的语句上时，它比硬断言更坏 ——
 * 实测（vitest 5.0.3）：
 *
 *     const arr = [];
 *     expect.soft(arr.length, "应为空（真正的原因）").toBe(0);
 *     expect.soft(arr[0].toFixed(2), "第一个元素").toBe("0.00");
 *
 * 软断言失败后**下一行照跑**，当场抛 `TypeError: Cannot read properties of
 * undefined` —— 报告里**只剩这条 TypeError**，「应为空」那句一个字都没留下。
 * 也就是说：**用在依赖链上，软断言把真正的原因吞掉了**（硬断言至少报得出它）。
 *
 * 判据因此是一条**形状判据**：`expect.soft` 必须落在**循环体里**（`for` /
 * `for...of` / `while` / `.forEach` / `.map` / `.flatMap` / `.filter` / `.reduce`
 * 的块体，含嵌套）。落在循环外的软断言一律阻断：它要么本来就该是硬断言
 * （顺序依赖），要么缺一个「把清单写成循环」的结构。
 *
 * ── 为什么用**缩进**而不是解析花括号 ──────────────────────────────────────
 *
 * 第一版按花括号配对算，连踩三个坑才明白这不是本判据该干的事：
 *   · JSX 的自闭合标签 `data-x={v} />` 里的 `/` 被当正则开头，后面整段挖空；
 *   · 箭头函数体直接给正则（`.filter((f) => /from\s+["']pino["']/.test(...))`）
 *     漏检时正则里的引号被当字符串开头，同样错位；
 *   · 正则里的 `[\\/]` 字符类会因为「先遇 `\` 后遇 `/`」把正则提前收尾。
 * 每修一个都要再加一层词法分析 —— 而这件事**与判据要回答的问题无关**。
 *
 * 缩进是**仓库里已经由 prettier 保证的事实**（`tabWidth: 2` / `useTabs: false`），
 * 判据只问一句「包着我的那一帧是不是循环」：从站点向上走，遇到第一个缩进更小的
 * 行就是一帧 —— 它（连同它的续行）里有循环关键字就是批量体，否则把它当下一个
 * 起点继续向上。没有词法分析，没有「解析失败」这个状态。
 *
 * 覆盖面的边界（都是**漏报**方向，可接受）：单行写 `for (…) { expect.soft(…) }`
 * 时站点与循环同一行 —— 这里按「帧」判定，同一行上的循环关键字会被认出来；
 * 而 `if (x) for (…) expect.soft(…)` 这类无块体的连续语句不在本判据的面上。
 *
 * 用法：
 *   node scripts/check-soft-assertions.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-soft-assertions.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = new Set(process.argv.slice(2)).has("--report");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径。 */
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (TEST_FILE_RE.test(e.name)) out.push(abs);
  }
  return out;
}

/**
 * 把**不是代码**的区间挖掉（换成等长空格，保持偏移）：行注释、块注释、
 * 单/双引号字符串、模板串。模板串里的 `${…}` 是**真代码**（表达式），
 * 递归回代码态处理，遇配对的花括号再回模板态 —— 用一个模板栈处理嵌套。
 *
 * 为什么要这一步：本判据自己的自测（`tests/soft-assertion-gate.test.ts`）
 * 里写着**夹具字符串**，里面就有 `expect.soft(…)` —— 不挖字符串的话，
 * 判据会去判自己的夹具（同族的先例：`tests/comment-language.test.ts` 里那份
 * `"// @vitest-environment jsdom"` 夹具字符串，把 ISSUE #1485 那轮的文件计数
 * 从 183 数成了 185）。判据只该看**代码**。
 *
 * ⚠️ **刻意不处理正则字面量**。第一版按花括号配对算的时候试过，连踩三个坑
 * （JSX 自闭合 `/>`、箭头函数体直接给正则、正则字符类里的 `[\/]`），
 * 每修一个都要再加一层词法分析。而这里**不需要**认正则：走的是缩进判据，
 * 正则里即使有花括号或引号也不会影响缩进 —— 少挖一段的代价只是判定更宽松
 * （漏报），那正是可接受的方向（§11.17.4 同一条教训）。
 */
function maskNonCode(src) {
  const out = src.split("");
  const tmplStack = [];
  let i = 0;
  let mode = "code"; // code | line | block | sq | dq | tmpl

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (mode === "line") {
      if (ch === "\n") mode = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "block") {
      if (ch === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        mode = "code";
      } else {
        if (ch !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (mode === "sq" || mode === "dq") {
      const quote = mode === "sq" ? "'" : '"';
      if (ch === "\\") {
        out[i] = " ";
        if (i + 1 < out.length) out[i + 1] = " ";
        i += 2;
        continue;
      }
      /* 单/双引号字符串不跨行 —— 换行说明解析错位，回到代码态，
         别把后面整段代码跟着挖空（错位时宁可少挖）。 */
      if (ch === "\n") {
        mode = "code";
        continue;
      }
      if (ch === quote) {
        out[i] = " ";
        i += 1;
        mode = "code";
        continue;
      }
      out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      if (ch === "\\") {
        out[i] = " ";
        if (i + 1 < out.length) out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === "`") {
        out[i] = " ";
        i += 1;
        mode = tmplStack.pop() ?? "code";
        continue;
      }
      if (ch === "$" && next === "{") {
        /* 模板里的表达式是**真代码**：扫到与它配对的 `}`，这一段保持原样。
           它内部可能再嵌模板串，所以记下「回模板态」这件事。 */
        i += 2;
        let depth = 1;
        while (i < src.length && depth > 0) {
          if (src[i] === "`") {
            /* 嵌套模板串：整段按模板串挖（内部 `${}` 不再细分 ——
               这里只为了把 `}` 数对）。 */
            i += 1;
            while (i < src.length && src[i] !== "`") {
              if (src[i] === "\\") i += 1;
              out[i] = " ";
              i += 1;
            }
            out[i] = " ";
            i += 1;
            continue;
          }
          if (src[i] === "{") depth += 1;
          else if (src[i] === "}") depth -= 1;
          if (depth === 0) break;
          i += 1;
        }
        i += 1; // 收尾的 }
        continue;
      }
      if (ch !== "\n") out[i] = " ";
      i += 1;
      continue;
    }

    /* ── mode === "code" ───────────────────────────────────────────── */
    if (ch === "/" && next === "/") {
      mode = "line";
      continue;
    }
    if (ch === "/" && next === "*") {
      mode = "block";
      continue;
    }
    if (ch === "'") {
      mode = "sq";
      out[i] = " ";
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = "dq";
      out[i] = " ";
      i += 1;
      continue;
    }
    if (ch === "`") {
      mode = "tmpl";
      out[i] = " ";
      i += 1;
      continue;
    }
    i += 1;
  }

  return out.join("");
}

/**
 * 循环关键字。`for` / `while` 后面必须跟 `(`（挡住 `for (const x of …)` 与
 * `while (…)` 两种），`forEach` 这类是方法调用形态。
 */
const BATCH_KEYWORD_RE =
  /(?:^|[^\w.$])(?:for|while)\s*\(|\.(?:forEach|map|flatMap|filter|reduce)\s*\(/;

/** 第几行（1 起）：数到某个字符偏移为止的换行数。 */
function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") n += 1;
  return n;
}

/** 缩进宽度（空格数；tab 按 prettier 的口径不该出现在这些文件里）。 */
function indentOf(line) {
  const m = /^[ \t]*/.exec(line)[0];
  return m.length;
}

/**
 * 判断某个 `expect.soft` 站点是否落在循环体里。
 *
 * 从站点行向上走：
 *   · 记住当前「被包的缩进」`innerIndent`（起始 = 站点行缩进）；
 *   · 找第一行缩进 **小于** `innerIndent` 的非空行 —— 那就是包着它的一帧；
 *   · 该帧**连同它的续行**（缩进大于它的、紧跟在后面的行）里出现循环关键字
 *     就返回 true；
 *   · 否则把 `innerIndent` 降到该帧的缩进，继续向上。
 *
 * 「连同续行」是必须的：`for (const n of [\n  1,\n  2,\n]) {` 这类折行里，
 * 关键字与 `{` 隔着几行，只看那一行会漏判（漏判 = 漏报，可接受；
 * 但如果连正常折行也漏判，判据就成了噪声）。
 */
function isInLoop(lines, siteIndex) {
  const siteIndent = indentOf(lines[siteIndex] ?? "");
  let innerIndent = siteIndent;

  for (let i = siteIndex - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const ind = indentOf(line);
    if (ind >= innerIndent) continue;

    /* 折行语句的**收尾行**（`]) {` / `) {` / `});` / `,\n  ；` 这类以闭合符
       开头的行）不是新的一帧，它是上面那条语句的一部分 —— 遇到它时别把
       `innerIndent` 降下来，否则同缩进的那一行语句头（`for (const n of [` 与
       `]) {` 同为 2 格缩进）会被「缩进不小于 innerIndent」跳过，
       于是折行的循环头整条漏判（首版实测就是这条）。 */
    const stripped = line.trimStart();
    if (/^[)\]}]/.test(stripped)) continue;

    /* 这一行是「包着我的帧」的开头。它的**表头**可能折行（
       `for (const n of [\n  1,\n  2,\n]) {` 里关键字与 `{` 隔了三行），
       所以把续行一起看 —— 但**只看到块体的 `{` 为止**：
       再往后就是块体内容了，把它算进表头会让「循环之后」的语句被误判成
       在循环里（that 正是首版的一个误报：`for (…) { … }` 之后那条
       `expect.soft` 因为帧的表头吞掉了整个循环体而漏报）。

       `{` 的判据取「行尾是 `{`」：prettier 把块开头写成 `) {` / `() => {`，
       行尾必是 `{`。判错的后果见文件头「覆盖面的边界」一节。 */
    const continuation = [line];
    if (!/\{\s*$/.test(line.trimEnd())) {
      for (let j = i + 1; j < siteIndex; j++) {
        const l = lines[j];
        if (l.trim() === "") continue;
        if (indentOf(l) <= ind) break;
        continuation.push(l);
        if (/\{\s*$/.test(l.trimEnd())) break;
      }
    }
    if (BATCH_KEYWORD_RE.test(continuation.join("\n"))) return true;

    innerIndent = ind;
  }
  return false;
}

/**
 * 站点形状：`expect.soft(` **或** `expect` 与 `.soft(` 之间只有空白 / 换行。
 *
 * ⚠️ 折行的那半必须认 —— prettier 会把长行折成
 * `expect\n  .soft(preset.command, …)`，只认字面量 `expect.soft` 时
 * **这一处会整片漏出扫描面**（本判据第一版就是这样：`console-catalog.test.ts`
 * 被 prettier 折行之后，扫描计数从 27 掉到 26，而判据照样报 OK）。
 * 那是「判据在场 ≠ 判据在跑」那一族 —— 比红更坏。
 */
const SOFT_SITE_RE = /expect\s*\.\s*soft\s*\(/g;

function scanFile(abs) {
  const masked = maskNonCode(fs.readFileSync(abs, "utf8"));
  const lines = masked.split("\n");
  const sites = [];
  for (const m of masked.matchAll(SOFT_SITE_RE)) {
    const start = m.index;
    const lineNo = lineOf(masked, start);
    /* **同行**的循环头先判：`for (const n of [1, 2]) { expect.soft(n)…; }`
       里循环与站点在同一行，向上走永远看不到那个 `for`（它是本行的前缀）。
       截到站点之前，避免把站点之后（同一行的后续语句）的循环关键字算进来。 */
    const lineText = lines[lineNo - 1] ?? "";
    const col = start - (masked.lastIndexOf("\n", start - 1) + 1);
    const sameLine = BATCH_KEYWORD_RE.test(lineText.slice(0, col));
    sites.push({ line: lineNo, inBatch: sameLine || isInLoop(lines, lineNo - 1) });
  }
  return sites;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const offenders = [];
  let total = 0;

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    for (const site of scanFile(abs)) {
      total += 1;
      if (!site.inBatch) offenders.push({ rel, line: site.line });
    }
  }

  if (offenders.length === 0) {
    console.log(`[soft] OK —— ${total} 处 expect.soft 全在循环体里。`);
    return 0;
  }

  console.error(
    (REPORT_ONLY
      ? `[soft] 盘点：${offenders.length} 处待办（--report 不判失败）`
      : `[ERROR] 有 ${offenders.length} 处 expect.soft 落在循环体之外`) +
      "：\n",
  );
  for (const o of offenders) console.error(`  · ${o.rel}:${o.line}`);
  console.error(
    "\n`expect.soft` 唯一的用途是「一张清单逐项判、一项失败不影响下一项」。" +
      "\n落在循环体之外的软断言，实测会把真正的原因吞掉：" +
      "\n  软断言失败 → 下一行照跑 → 依赖前提的语句抛 TypeError，" +
      "\n  报告里只剩那条 TypeError，软断言那句「真正的原因」一个字都不留。" +
      "\n修法二选一：" +
      "\n  · 顺序依赖 → 改回硬断言 `expect(...)`（它至少报得出真正的原因）；" +
      "\n  · 本来就是一张清单 → 写成 `for (const x of LIST) expect.soft(...)`。" +
      "\n列清单：`node scripts/check-soft-assertions.cjs --report`" +
      "\n口径见 docs/standards/11-测试与可观测性.md §11.18。",
  );
  return REPORT_ONLY ? 0 : 1;
}

process.exit(main());
