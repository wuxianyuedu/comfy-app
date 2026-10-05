#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:用例的环境档与「环境早退」形态(供 .githooks/pre-commit 调用)
/**
 * 用例跑在哪个环境，不许靠**猜** —— 规范见 docs/standards/11-测试与可观测性.md §11.17。
 *
 * 现场（ISSUE #1485）：`vitest.config.ts` 是一条全局 `environment: "node"`，
 * 要 DOM 的用例各自在文件头写 `// @vitest-environment jsdom`。两件都对，
 * 但**第二件从来没人判过**：少写一行不报错，只是让用例留在 node 档下跑。
 * 表现分两种，而坏的那种是静默的：
 *
 *   · **响的**：真碰 `document` / `window`，当场 `ReferenceError`。这种会被人修掉。
 *   · **静默的**：用例自己写着 `if (typeof window !== "undefined") return;`
 *     这类**环境早退**——在 node 档下它已经「过了」，于是换个默认档（或本文件
 *     被挪进另一个 project）之后，它照样报绿，**而一条断言都没跑**。
 *     绿有两种含义，这一条恰好是坏的那种（同 §11.13.1 的「判据在场 ≠ 判据在跑」）。
 *
 * 本脚本判两件事，都不需要跑用例（纯文本，零网络，实测 < 1s）：
 *
 *   ① **环境早退**：用例体内出现「按环境决定跑不跑」的裸 return —— 一律阻断。
 *      正解是**把条件造出来**（`vi.stubGlobal("window", undefined)`，仓里
 *      `src/lib/app-events.test.ts` 已是这个形状），而不是把结论挂在环境的
 *      一个**全局默认值**上。判据故意**不认**「这个文件有 jsdom 文件头」：
 *      文件头只说明此刻跑在哪一档，管不住「以后谁改了默认档 / 谁把它挪进
 *      另一个 project」—— 那正是这条用例要防的事。
 *
 *   ② **文件头与目录档的一致性**：`vitest.config.ts` 的 `projects` 按目录声明了
 *      默认档，本脚本核「目录档说 jsdom / 用例头说 node」这类**互相矛盾**的组合。
 *      它守的是「挪目录 / 改档」这类改动的可见性，不替用例决定该跑在哪。
 *
 * 用法：
 *   node scripts/check-test-environment.cjs            # 检查
 *   node scripts/check-test-environment.cjs --report   # 只出清单不判失败（盘点用）
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

/**
 * 「环境早退」的形状 —— 两种写法都认，因为它们都能让一条用例**不跑也绿**：
 *
 *   · `if (typeof window !== "undefined") return;` —— 在 node 档下早退；
 *   · `if (typeof window === "undefined") return;` —— 在 jsdom 档下早退。
 *
 * ⚠️ **`typeof` 后面只认环境全局那几个名字**，不是任意标识符。首版写成
 * `typeof \w+` 时，`UseWorkshopPipelinePersistence.test.tsx` 的
 * `function requestUrl(input) { if (typeof input === "string") return input; }`
 * 被当场误报 —— 那是**类型收窄**，与环境档毫无关系。一个会误报的判据接下来
 * 的下场就是被整条放宽（§12.13 的原话：「清单变噪音，没人会照它排期」），
 * 所以这里的白名单是**判据能立住的前提**，不是优化。
 *
 * 名单的出处是「一个全局在 node 档下不存在、在 jsdom 档下存在」这件事本身：
 * `window` / `document` / `navigator` / `localStorage` / `sessionStorage` 是
 * jsdom 提供的（`navigator` 在 Node 24 也**存在**，所以它单独列出来是给
 * 「按浏览器语义用它」的用例留的；真要判它请配 `vi.stubGlobal`）。
 */
const ENV_GLOBALS = "window|document|navigator|localStorage|sessionStorage|self|HTMLCanvasElement|MutationObserver|ResizeObserver";

/**
 * ⚠️ 只认「守卫紧跟着裸 `return`」这一形态。**带了断言的守卫不算**
 * （`if (typeof window === "undefined") { expect(x).toBeNull(); return; }` 是
 * 正确的「两个分支各判各的」写法），所以正则要求 `)` 与 `return` 之间只有空白与分号。
 *
 * ⚠️ 平台早退（`if (process.platform !== "win32") return;`）**刻意不在这一档**：
 * 它另有登记机制（`tests/conditional-skip-registry.test.ts` 管
 * `describe.runIf` / `it.skipIf`），而这里管的是「绕开机制、用裸 return 让用例
 * 悄悄不跑」那条**没有登记要求**的路。两条判据各自有执行者，不重叠也不留缝。
 */
const EARLY_RETURN_RES = [
  new RegExp(
    String.raw`if\s*\(\s*typeof\s+(?:` + ENV_GLOBALS +
      String.raw`)\s*[!=]==?\s*""\s*\)\s*\{?\s*return\s*;?`,
  ),
];

/**
 * 剥掉注释后再判 —— 否则「说明这条写法的注释」自己会被判违规（仓里已经有几处
 * 注释在讲这个反模式），而判据一旦开始误报就会被人整条放宽。
 *
 * ⚠️ **字符串只换成占位符，不删掉**：本判据要判的那一行里恰恰有个字符串
 * （`typeof window !== "undefined"`）—— 早期版本把字符串内容**删空**，
 * 于是剥完变成 `typeof window !== ) return;`，正则连同它的哨兵一起失配，
 * **变异测试当场证明它认不出自己最想认的那个形状**。换成 `""` 占位既挡住
 * 「注释里的示例代码」，又保住这一行的可匹配性。
 */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let state = "code"; // code | line | block | str | tpl
  let open = ""; // 当前字符串用的引号（`"` / `'` / `` ` ``）
  while (i < n) {
    const c = src[i];
    const c2 = src.slice(i, i + 2);
    if (state === "code") {
      if (c2 === "//") { state = "line"; i += 2; continue; }
      if (c2 === "/*") { state = "block"; i += 2; continue; }
      if (c === '"' || c === "'") { state = "str"; open = c; i += 1; continue; }
      if (c === "`") { state = "tpl"; open = c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { state = "code"; out += c; }
      i += 1; continue;
    }
    if (state === "block") {
      if (c2 === "*/") { state = "code"; i += 2; continue; }
      if (c === "\n") out += c;
      i += 1; continue;
    }
    if (state === "str" || state === "tpl") {
      /* 转义序列整体吃掉（含 `\\"` 与 `\\\n`），不让它提前闭合。 */
      if (c === "\\") { i += 2; continue; }
      const closer = state === "str" ? (open === '"' ? '"' : "'") : "`";
      if (c === closer) {
        state = "code";
        /* 占位符：保住「这里原本有一个非空字符串字面量」这个事实，
         * 但抹掉它的内容 —— 判据要的是形状，不是那个词写的是什么。 */
        out += '""';
        i += 1;
        continue;
      }
      if (c === "\n") out += c; /* 模板串里的换行要留着，行号才对得上 */
      i += 1; continue;
    }
  }
  return out;
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(path.join(dir, e.name), out);
    } else if (TEST_FILE_RE.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

/** 用例文件里声明的环境（文件头 `// @vitest-environment <name>`）。 */
function declaredEnv(text) {
  const m = /^\/\/\s*@vitest-environment\s+(\S+)\s*$/m.exec(text);
  return m ? m[1] : null;
}

/**
 * `vitest.config.ts` 的 `projects` 里按目录声明的档。
 *
 * 解析的是**源码文本**而不是 import 它 —— 那份配置顶层 import 了 `vitest/config`
 * 与 `node:path`，在判据里加载它会把 vitest 一起拉起来（判据要能独立跑、要快）。
 *
 * ⚠️ 解析器**只管一种形状**：`projects` 里两个对象，各自 `name: "<档名>"`，
 * 同对象内有 `include` / `exclude` 数组字面量。首版用一条「从 name 抓到下一个
 * 对象开头」的正则 + 一个拼出来的取数组正则，实测**两个都拿不到东西却仍然退 0**
 * （`include: []`）—— 于是判据②变成「永远没有目录档」＝静默消失，而它照样报 OK。
 * 这正是本仓库反复踩的那一族（§11.13.1「判据在场 ≠ 判据在跑」），所以现在：
 *   ① 解析按**括号配对**走（不是「找下一个 `{`」），形状不认识就 `found` 不增；
 *   ② `found < 2` **判失败**，不许退回「没有目录档」；
 *   ③ 数组里的条目必须都是字符串字面量，否则同样判失败。
 */
function parseProjectGlobs() {
  const text = fs.readFileSync(path.join(ROOT, "vitest.config.ts"), "utf8");
  const globs = { jsdomInclude: [], jsdomExclude: [], nodeInclude: [], nodeExclude: [] };
  const marker = "projects:";
  const at = text.indexOf(marker);
  if (at < 0) return { globs, found: 0 };
  /* 从 `projects:` 后的 `[` 开始，按括号配对切出这个数组的**顶层元素**。 */
  const bracket = text.indexOf("[", at);
  if (bracket < 0) return { globs, found: 0 };
  const items = splitTopLevel(text.slice(bracket + 1));
  let found = 0;
  for (const item of items) {
    const nameM = /name:\s*"([^"]+)"/.exec(item);
    if (!nameM) continue;
    const name = nameM[1];
    if (name !== "node" && name !== "jsdom") continue;
    const inc = literalArray(item, "include", text);
    const exc = literalArray(item, "exclude", text);
    if (inc === null) continue; // 形状不认识 —— 不计入 found，由 found<2 兜住
    found += 1;
    globs[name + "Include"] = inc;
    globs[name + "Exclude"] = exc ?? [];
  }
  return { globs, found };
}

/** 按括号配对把数组体切成顶层元素（不处理嵌套对象里的逗号）。 */
function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let cur = "";
  let state = "code";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (state === "str") {
      cur += ch;
      if (ch === "\\") { cur += body[i + 1] ?? ""; i += 1; continue; }
      if (ch === '"' || ch === "'") state = "code";
      continue;
    }
    if (ch === '"' || ch === "'") { state = "str"; cur += ch; continue; }
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
      /* 回到 0 就是 `projects: [...]` 那一层的收尾，后面的内容不属于它。 */
      if (depth < 0) break;
    }
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * 取对象字面量里 `key: [ "…", … ]` 的字符串条目。
 *
 * 支持两种写法，因为它们各自都好用、且**都必须被认出来**：
 *   · `include: [<字符串字面量>, …]` —— 直接写在一行里；
 *   · `include: JSDOM_TEST_GLOBS`    —— 顶层 `const` 数组（列出 26 个目录用的就是它，
 *     写成字面量会把两个 project 挤成一坨）。
 * 认不出标识符时**返回 `null`**（判失败），不静默按空数组处理 —— 那正是首版
 * 「`include: []` 却退 0」那个静默消失的形状。
 *
 * @returns {string[] | null} 形状不认识时 `null`
 */
function literalArray(objText, key, configText) {
  const at = objText.indexOf(key + ":");
  if (at < 0) return null;
  /* 标识符写法：`key: SOME_CONST` —— 去顶层找 `const SOME_CONST = [...]`。 */
  const ident = new RegExp(key + String.raw`:\s*([A-Za-z_$][\w$]*)\s*[,}\n]`).exec(objText);
  if (ident && configText) {
    const decl = new RegExp(String.raw`const\s+` + ident[1] + String.raw`\s*=\s*\[`).exec(configText);
    if (!decl) return null;
    return collectStringLiterals(configText.slice(decl.index + decl[0].length - 1));
  }
  const open = objText.indexOf("[", at);
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < objText.length; i += 1) {
    if (objText[i] === "[") depth += 1;
    else if (objText[i] === "]") {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;
  return collectStringLiterals(objText.slice(open));
}

/** 从一个 `[…]` 字面量（含方括号）里取出所有字符串条目名。 */
function collectStringLiterals(arrayText) {
  let depth = 0;
  let close = -1;
  for (let i = 0; i < arrayText.length; i += 1) {
    if (arrayText[i] === "[") depth += 1;
    else if (arrayText[i] === "]") {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;
  const inner = arrayText.slice(1, close);
  return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

/** 正则里需要转义的字面量字符。 */
const ESCAPE_RE = /[.+^${}()|[\]\\?]/g;

/**
 * 极简 glob → 正则。支持 `**`、`*`、`{a,b}` 三种（本仓 `include` 里实际出现的全部）。
 *
 * ⚠️ 「双星号 + 斜杠」必须翻成 `(?:[^/]+/)*`（**零层或多层**目录），
 * 不能翻成「任意字符 + 斜杠」：后者要求**至少一层**目录，于是 `src/config/<星号><星号>/x.test.ts` 匹配不到
 * `src/config/custom-nodes.test.ts`（实测：目录档整条失效、判据②静默空转）。
 * `*` 翻 `[^/]*`（不跨目录），字面量段先转义 —— 顺序不能反。
 */
function globToRe(g) {
  let out = "";
  for (let i = 0; i < g.length; i += 1) {
    const ch = g[i];
    if (ch === "*") {
      if (g[i + 1] === "*") {
        /* 「双星号 + 斜杠」→ 零层或多层目录；结尾的裸双星号 → 任意 */
        if (g[i + 2] === "/") { out += "(?:[^/]+/)*"; i += 2; }
        else { out += ".*"; i += 1; }
      } else out += "[^/]*";
      continue;
    }
    if (ch === "{") {
      const close = g.indexOf("}", i);
      if (close > 0) {
        out += "(?:" + g.slice(i + 1, close).split(",").map(escapeRe).join("|") + ")";
        i = close;
        continue;
      }
    }
    out += escapeRe(ch);
  }
  return new RegExp("^" + out + "$");
}

function escapeRe(s) { return s.replace(ESCAPE_RE, String.fromCharCode(92) + "$&"); }

function matchesAny(rel, globs) {
  return globs.some((g) => globToRe(g).test(rel));
}

function toPosix(p) { return p.split(path.sep).join("/"); }

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .map((abs) => ({ abs, rel: toPosix(path.relative(ROOT, abs)) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));

  const problems = [];

  /* ① 环境早退 —— 判据本体。 */
  for (const { abs, rel } of files) {
    const raw = fs.readFileSync(abs, "utf8");
    /* 判据跑在**剥过注释**的文本上，但**报错回原文那一行** —— 否则
     * `typeof window !== "undefined"` 会被打成 `typeof window !== ""`
     * （字符串换成占位符的代价），读报错的人得先猜一遍自己的代码长什么样。 */
    const strippedLines = stripCommentsAndStrings(raw).split("\n");
    const rawLines = raw.split("\n");
    for (let i = 0; i < strippedLines.length; i += 1) {
      for (const re of EARLY_RETURN_RES) {
        if (re.test(strippedLines[i])) {
          problems.push({
            rel,
            line: i + 1,
            kind: "环境早退",
            detail: (rawLines[i] ?? strippedLines[i]).trim(),
          });
          break;
        }
      }
    }
  }

  /* ② 目录档与文件头互相矛盾 —— 守「挪目录 / 改档」的可见性。 */
  const { globs, found } = parseProjectGlobs();
  if (found < 2) {
    console.error(
      "[ERROR] 解析 `vitest.config.ts` 的 `projects` 失败（拿到 " + found + " 个档，期望 2）。\n" +
      "        本判据依赖那两个 project 的 `include` / `exclude` glob；\n" +
      "        配置形状改了就要同批改这里 —— 静默退回「没有目录档」等于这条判据消失。",
    );
    return 1;
  }
  /* ② 目录档与文件头**互相矛盾**。
   *
   * ⚠️ 判据的口径是「**这一档声明了它会跑在 X，而文件头说 X 是错的**」，
   * 不是「文件头与所属 project 不同名」—— 后者会误报一整片：
   * `projects` 只决定**没写文件头**时跑在哪，所以「node project 里放一份写了
   * `jsdom` 头的用例」是完全正当的写法（文件头优先级更高，它照样跑在 jsdom）。
   * 实测：按后一种口径装上去，当场报 37 处「矛盾」，全是混合目录里那些**本来
   * 就该靠文件头指定 jsdom** 的 `.test.ts`（`src/lib/project-canvas/canvas-store`
   * 那些）—— 一条会误报 37 处的判据活不过一次评审。
   *
   * 真正该拦的是这两种：
   *   a. **jsdom 档里的用例**声明 `node` —— 那说明它不该在这个档（或文件头过时），
   *      而 jsdom 档下跑一份 node 用例的后果是「它以为自己在 node 上」；
   *   b. **node 档 **且** 该目录是「整目录一致」的 jsdom 目录**里的用例声明 `node`
   *      —— 与 a 同一件事的另一侧（目录里其他人都靠目录档、只有它反着写）。
   * 判据不去猜「这份用例究竟该跑在哪」，只保证**声明之间不自相矛盾**；
   * 「该跑在哪」由 `include` 的归属回答，不归这里判。 */
  const conflicts = [];
  for (const { abs, rel } of files) {
    const inJsdom = matchesAny(rel, globs.jsdomInclude) && !matchesAny(rel, globs.jsdomExclude);
    if (!inJsdom) continue;
    const env = declaredEnv(fs.readFileSync(abs, "utf8"));
    if (!env) continue;
    if (env !== "jsdom") {
      conflicts.push({
        rel,
        kind: "目录档与文件头矛盾",
        detail: `该用例落在 jsdom 档的 include 里，文件头却写着 ${env}`,
      });
    }
  }

  const all = [...problems, ...conflicts];

  if (all.length === 0) {
    if (!REPORT_ONLY) console.log(`[test-env] OK —— ${files.length} 份用例：无环境早退，目录档与文件头一致。`);
    else console.log(`[test-env] 盘点：${files.length} 份用例，无问题。`);
    return 0;
  }

  console.error(`[ERROR] 用例的环境档有 ${all.length} 处问题：\n`);
  for (const p of all) {
    console.error(`  · ${p.rel}${p.line ? ":" + p.line : ""}  [${p.kind}]`);
    console.error(`      ${p.detail}`);
  }
  console.error(
    "\n修法：" +
    "\n  · 「环境早退」：别把结论挂在环境的一个全局默认值上。要覆盖 SSR / 无 window 分支，\n" +
    "    就**把条件造出来**：`vi.stubGlobal(\"window\", undefined)` + 断言（配 `afterEach(vi.unstubAllGlobals)`）。\n" +
    "    仓里现成样板：src/lib/app-events.test.ts 的「无 `window` 时订阅给一个空操作…」那条。\n" +
    "  · 「目录档与文件头矛盾」：两者必有一处过时 —— 要么用例挪错了目录，要么文件头该改。\n" +
    "    别只改一边凑绿：那正是这条判据要照出来的改动。\n" +
    "  口径见 docs/standards/11-测试与可观测性.md §11.17。",
  );
  return REPORT_ONLY ? 0 : 1;
}

process.exit(main());
