#!/usr/bin/env node
// @ts-nocheck -- 主题色扫描（供 .githooks/pre-commit 与 CI 调用）
/**
 * 主题色扫描 —— 规范见 docs/standards/03-样式与-tailwind.md §3.6 / §3.6.1。
 *
 * 背景（ISSUE #75「取消暗色优先，全应用浅色主题彻底铺开」）：
 * 专项推进过程中反复出现同一件事 —— **每轮扫描都要重新判定一次「哪些写死色值
 * 是有意保留、哪些是漏改」**。判定口径虽然写在规范 §3.6.1 里，但规范是人读的、
 * 扫描是机器跑的：没有机器可读的豁免清单，同一批「类型色」（端口类型色 /
 * 节点类别色 / 参数分组色，约 320 处）每轮都被当成漏网再报一遍，白耗一轮。
 *
 * 本脚本把这件事机器化，分三层：
 *   ① **豁免层**（`EXEMPT_TABLES` / `EXEMPT_FIXED_DARK`）：按 §3.6.1 的两类
 *      例外**逐条显式**放行 —— 「类型色例外」（成组集中的端口类型色 / 节点类别色 /
 *      参数分组色常量表）与「固定暗色清单」（画布极小面积叠层）。豁免项从此
 *      不再进入报告；
 *   ② **判定层**（**硬闸**）：豁免后剩下的未 token 化写死色值须为 **0**
 *      （命中即退 1，无基线、无 `--update`）。翻转前它是棘轮
 *      （`scripts/.theme-color-baseline.json`，基线 `total: 0`）；存量清零后棘轮
 *      只剩一条「手改那份 JSON 就能把新色值登记成已知存量」的通道 ——
 *      而硬闸类**本来没有**这个中间态。真正的出口仍是豁免层（逐条写理由），
 *      不是放宽基线；
 *   ③ **反向四层**（同为硬闸）：
 *      · **死豁免**：登记在表上却一处都不命中的条目 = 负债，会把该文件今后的
 *        写死色值静默放行，出现即阻断（口径按文件、不按条目，见下方注释）；
 *      · **幽灵 token**：字面 `var(--color-…)` 引用了从未定义的 token —— 不报错、只是
 *        颜色消失（`fill` 退黑、`stroke` 退 none），出现即阻断；**带兜底值的同样阻断**
 *        （那种渲染结果确定，但等于用硬编码值冒充 token，叫「装饰性 indirection」）；
 *      · **拼接 token 名**：`--color-${x}` / `"--color-" + x` —— 前一条比对不到它，
 *        而 Tailwind v4 按源码里的**字面名**决定保留哪颗 `@theme` 变量，拼出来的名字
 *        看不见 → 那颗 token 连产物都进不去（实测无人引用的声明在产物里出现 0 次）。
 *        实测存量 0，出现即阻断；
 *      · **跨面相等主张**：注释或**本脚本自己的豁免理由**里写「与 `--color-primary` /
 *        `--color-accent` 同值 / 1:1」给一颗裸色值背书 —— 这是第二份账，token 改了
 *        句子不会红（品牌紫深化那批就是四处这样的主张同时过期而门禁全绿）。
 *        改法只有两条：该行归品牌管就写 `var(...)`，是独立内容色就把句子删掉；
 *   ④ **报告层**（`--report`）：只出清单不判失败，供盘点/排批次用。
 *
 * ⚠️ 豁免必须**显式**：清单里逐条列出「文件 + 该文件里被豁免的顶层标识符 + 理由」，
 * 不做「按目录/按关键字通配」的模糊放行 —— 模糊放行会让真正的漏改混在豁免里
 * 悄悄溜过。新增豁免一律在本脚本 `EXEMPT_TABLES` 里写清理由，并在 PR 描述里
 * 说明；与 `globals.css` 的「固定暗色清单」及规范 §3.6.1 保持同源。
 *
 * 判定口径：
 *   检查  = 遍历 `src/**`，统计每个文件的写死色值，减去显式豁免；
 *   通过  = 未豁免计数为 0，
 *           且「无死豁免」「无幽灵 token」「无拼接 token 名」「无跨面相等主张」四条硬闸都过；
 *   失败  = 出现未豁免的写死色值 / 死豁免 / 幽灵 token / 拼接 token 名
 *           / 跨面相等主张（退出码 1），并列出行号。
 *
 * 用法：
 *   node scripts/check-theme-colors.cjs            # 检查（硬闸：命中即退 1）
 *   node scripts/check-theme-colors.cjs --report   # 只出报告，不判失败（盘点用）
 */

// 豁免声明层拆在同目录的 theme-color-exemptions.cjs(ISSUE #1811):
// EXEMPT_TABLES 一张表就 232 行,与判定逻辑混在一份 901 行的文件里。
const { EXEMPT_TABLES, EXEMPT_FIXED_DARK } = require("./theme-color-exemptions.cjs");

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");

/* ── 扫描范围 ────────────────────────────────────────────── */

/** 只扫应用源码：src/**（含 .ts/.tsx），排除测试与快照。 */
const SCAN_DIR = "src";
const SOURCE_EXT = /\.(ts|tsx)$/;
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) ||
  /\.snap$/.test(rel) ||
  rel.includes("/__tests__/");

/* ── 写死色值的识别 ──────────────────────────────────────── */

/** `#rrggbb` / `#rgb` / `#rrggbbaa`（8 位），以及 `rgba(...)` / `rgb(...)`。 */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
/** 函数色**不加 `\b`**：候选名用 `_` 代替空格，`_rgba(` 前是单词字符会整条漏扫（口径见 03 §3.6.2）。 */
const FUNC_COLOR_RE = /rgba?\s*\(/g;
/**
 * `#346` / `#262` 这类 **ISSUE 引用**会被 `HEX_RE` 误当 3 位色值：
 * 3~4 位短写法只接受「整行里没有别的数字型引用迹象」的情形。判据用
 * 「短 hex 后面紧跟引号/空格/分号/括号等值终止符」——`#fff"`、`#abc)`
 * 是真色值，`#346 ` 后面跟中文/数字则是 ISSUE 号。为稳妥起见，短写法
 * 只在**去注释后的代码**里判定（注释里的 `#fff` 本来就该忽略）。
 */
const SHORT_HEX_RE = /#[0-9a-fA-F]{3,4}(?=["';)\s]|$)/g;
const SHORT_HEX_CONTEXT_RE =
  /(?:bg|text|border|fill|stroke|color|background|COLOR)[^#]*$/i;

/**
 * 去掉 `//` 行注释与 `/* … *\/` 块注释（保留行数，便于报行号）。
 *
 * 注释里写色值（如「Card #16161C / border #26262E」的设计稿说明）**不是代码**，
 * 计入扫描只会产生噪声；且注释里的 `#346` 是 ISSUE 号，误报概率最高。
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let inBlock = false;
  let inLine = false;
  let inStr = null;
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      } else out += " ";
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && nx === "/") {
        inBlock = false;
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        out += ch + (nx ?? "");
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && nx === "/") {
      inLine = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && nx === "*") {
      inBlock = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 该行是否「像」一个颜色字面量行（**先去过注释**）。
 *
 * 判据是**值本身**，不是所在目录 —— 与规范 §3.6.1 的边界一致：
 * 「这行色值是『内容自己的颜色』还是『某个表面的颜色』？」
 * 这一层只负责「这行有没有写死色值」，分堆交给 `EXEMPT_*` 清单。
 */
function colorHitsInLine(line) {
  const hits = [];
  for (const m of line.matchAll(HEX_RE)) {
    const v = m[0];
    // 3~4 位短写法只在「有颜色语境」时才算色值（避开 ISSUE #346 这类引用）。
    if (v.length <= 5 && !SHORT_HEX_CONTEXT_RE.test(line.slice(0, m.index)))
      continue;
    hits.push(v);
  }
  for (const m of line.matchAll(FUNC_COLOR_RE))
    hits.push(m[0].replace(/\s*\($/, "("));
  return hits;
}


/** 全部豁免落点索引：rel → [entry…]。 */
const EXEMPT_INDEX = new Map();
for (const entry of [...EXEMPT_TABLES, ...EXEMPT_FIXED_DARK]) {
  const list = EXEMPT_INDEX.get(entry.file) ?? [];
  list.push(entry);
  EXEMPT_INDEX.set(entry.file, list);
}

/* ── 豁免判定 ────────────────────────────────────────────── */

/**
 * 计算「每行身处哪个顶层声明」：从文件头往下扫，记录当前最近的顶层声明名。
 *
 * 顶层声明有四种豁免粒度（见 `EXEMPT_TABLES` 条目的字段）：
 *   · `exports: ["X"]`  只豁免声明 `X` 的作用域；
 *   · `exports: []`     整文件豁免（仅限「整个文件就是一张类型色常量表」）；
 *   · `lines: [164]`    只豁免指定行（表外内联、比整函数豁免更精确）；
 *   · 都不给 = 整文件豁免（同 `exports: []`）。
 */
function scopeResolver(text) {
  const lines = text.split("\n");
  const scopeAtLine = new Array(lines.length).fill(null);
  let current = null;
  let depth = 0;
  /* 顶层声明名：`export const NODE_META: Record<` 这类**跨行声明**必须能认出来 ——
   * 名字后面紧跟 `:` / `=` / `(` / `{` 即视为声明开始，随后逐行按括号配对跟踪，
   * 直到配平（回到 depth 0）才关闭作用域。若在 depth 0 时又遇到新声明，直接切换。 */
  const DECL_RE =
    /^\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\s*[:=({<]/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const decl = line.match(DECL_RE);
    if (depth === 0 && decl) current = decl[1];
    scopeAtLine[i] = current;
    let opened = false;
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") {
        depth++;
        opened = true;
      } else if (ch === "}" || ch === ")" || ch === "]")
        depth = Math.max(0, depth - 1);
    }
    /* 只有「开过括号并配平」才算这次声明结束；`export const X = 1;` 这种
     * 单行声明由下一个声明的出现自然切换，不必在这里清空。 */
    if (depth === 0 && opened) current = null;
  }
  return scopeAtLine;
}

/** 命中集合：rel → { wholeFile | exports[], lines[] }。 */
function classifyFile(rel) {
  const entries = EXEMPT_INDEX.get(rel) ?? [];
  if (entries.length === 0) return null;
  const wholeFile = entries.some(
    (e) => (e.exports ?? []).length === 0 && !e.lines,
  );
  const names = new Set(entries.flatMap((e) => e.exports ?? []));
  const lines = new Set(entries.flatMap((e) => e.lines ?? []));
  return { wholeFile, names, lines };
}

/* ── 幽灵 token：引用了从未定义的 --color-* ─────────────────── */

/**
 * 字面写 `var(--color-x)`，而 `--color-x` 全仓没人定义时**什么错都不报**：
 * 属性退成初值 —— SVG 的 `fill` 变黑、`stroke` 变 `none`，图标变黑块、描边类图形
 * 整条消失。这比留一处写死色值更糟：写死至少还是设计稿里那个颜色。
 *
 * 实测来历：`ui/seed-mode-button.tsx` 的 5 颗 `--color-seed-*` 是在一次目录归并
 * 里从写死色值改成 `var()` 引用的，`globals.css` 却没补上定义，四个 seed 图标
 * 从此静默失效。同一件事的另一面是「该文件的主题色豁免不再命中任何东西」——
 * 死豁免把它暴露了出来，所以两条判据同批补。
 *
 * **为什么判据从「属性形态」泛化成「任何字面引用」**：第一版只认 `fill=` / `stroke=`
 * 这类属性，于是 `--color-canvas-grid-line`（从未定义，靠 `<Background color=…>` 的
 * 兜底值活着）本来就抓不到；更讽刺的是，把三处网格线收进一个出口函数之后，引用变成
 * 了出口里的模板串（`color-mix(… var(--color-canvas-grid-line) X% …)`），**连属性形态
 * 都不是了** —— 集中化这个动作本身会把引用搬出判据的视野。所以判据只认两个条件：
 * **字面量**、**带 `--color-` 前缀**，不再关心它挂在哪个语法位置上。
 *
 * **判据边界**（说清不覆盖什么，别以为这条能抓所有未定义变量）：
 *   · 覆盖**任何字面量** `var(--color-…)` 引用 —— 不限于呈现属性：SVG 的
 *     `fill=` / `stroke=` / `stopColor=`、React Flow `<Background color= bgColor=>`、
 *     `style={{}}`、Tailwind 的 `[var(--color-x)]`，以及**收在出口函数里的模板串**
 *     （`gridLineColor()` 就是这种 —— 只按属性形态判的话，集中化本身就会把引用
 *     搬出判据视野，这个洞是本次改动实测踩出来的）；
 *   · **带不带兜底都判**（④）：`var(--color-x, #fff)` 里 x 从未声明时渲染结果确实
 *     确定（永远走兜底），所以它不是「看不见」那类失效，而是**装饰性 indirection** ——
 *     读代码的人以为这行随主题，实际是一个硬编码值冒充 token，把 §3.6.1 的
 *     「单一事实来源」悄悄换成局部常量。上一版把带兜底列为「明确不覆盖」，
 *     而 `--color-canvas-grid-line` 正是靠那条豁免活了好几轮，故本次收回该豁免；
 *   · **运行期注入的变量不判**：`--transform-origin` / `--available-height` /
 *     `--sidebar-width` 这些由 base-ui 与宿主代码写入的名字不带 `--color-` 前缀，
 *     天然落在本判据之外；实测 Tailwind 裸变量写法 310 处里 43 处「CSS 查无此名」
 *     全是这一类 —— 静态硬判会误报一片，那部分交给 review。
 *     （`--color-*` 命名空间内**没有**运行期注入的正当用法：实测全仓 `setProperty`
 *     与 style 对象键里都不出现 `--color-` 名字，所以带前缀就足以排除噪声。）
 *   · **拼接出来的名字判不到**，交给下面第 ③ 条。
 *
 * 实测口径：非测试代码里字面 `var(--color-…)` **175 处，查无定义 0 处**；
 * 带兜底的 **0 处**（唯一那处就是刚被收掉的网格线）。早先只认属性形态时是 28 处 ——
 * 泛化把覆盖率放大到 6 倍而不引入任何误报。
 */
const COLOR_VAR_REF_RE = /var\(\s*(--color-[\w-]+)\s*([),])/g;
const CSS_VAR_DECL_RE = /^\s*(--color-[\w-]+)\s*:/gm;

/**
 * ③ **拼接出来的 token 名** —— 上面那条幽灵判据唯一看不见的引用形态。
 *
 * `var(--color-node-${kind})` / `"--color-" + name` 这类名字不是字面量，
 * 「引用了但没定义」根本无从比对；更糟的是 Tailwind v4 会 **tree-shake 未被引用的
 * `@theme` 变量**，而它判断「有没有被引用」靠的是**源码里出现过这个字面名** ——
 * 拼出来的名字它同样看不见，于是那颗 token 连产物都进不去（实测：往 `@theme` 塞一颗
 * 谁都不引用的 `--color-zprobe-unused`，编译产物里出现 **0 次**；而 globals.css 声明的
 * 111 颗里有 24 颗被 shake 掉，这 24 颗在 `src/**` 里连名字都没出现过）。
 *
 * 所以规定的写法是**整名写全**：JS 里要按当前主题取色就走
 * `useCssColorToken("--color-node-mix-base", "#ffffff")` —— 该地基出口内部
 * `getPropertyValue(name)` 是本仓库唯一合法的间接层（它是出口，不是绕开），
 * 两个调用点传的都是完整字面名，因此 token 名在源码里可见、既过幽灵判据也不被 shake。
 *
 * **只判两种形态**：模板插值出现在 token 名里、或字符串相加拼 token 名。
 * 实测存量 **0**。刻意**不判**「反引号里出现 `--color-` 前缀」这类宽形态 ——
 * 那种正则会在 `globals.css` 的说明注释里命中 103 处散文引用，
 * 全是「这个名字被 shake 是因为没人用」的正确形态（同 §12.18 别造误报机）。
 */
const COMPOSED_NAME_RES = [
  /--color-[a-z0-9-]*\$\{/,
  /["'`]--color-[a-z0-9-]*["'`]\s*\+/,
];

/**
 * ⑤ **跨面相等主张** —— 用「与 `--color-primary` / `--color-accent` 同值」这类句子
 * 去正当化一颗裸色值（写在注释里，或写在**本脚本自己的豁免理由**里）。
 *
 * 为什么这条必须存在：token 改了，句子不会跟着红。实测事故 —— 品牌紫深化把
 * `--color-primary` 从 `#7C5CFC` 改成 `#8557de`，而四处「与品牌 token 同值 / 1:1」
 * 的说法（三条豁免登记理由 + 一处代码注释）**当场变成假话**，`pnpm theme:check` 那一路
 * 全绿：它只数「有没有未登记的品牌裸值」，**不读理由里的主张**。
 *
 * 口径是**禁止这种写法**，不是「校验主张是否成立」：后者要在每次改 token 后重算一次，
 * 长出来就是 §12.18 明写不要的那种「扫豁免理由的启发式」。正确的写法只有两条 ——
 * 要么直接取 `var(--color-primary)`（那就不需要主张，跟着走是机制），
 * 要么写明它是**独立的内容色**（类型色表、装饰表），那就不必再跟品牌比大小。
 *
 * 判据形状（收窄到品牌家族的名字，别当宽形态用）：
 *   · 只认「与/跟 + `--color-primary*` / `--color-accent*` + 同值|相等|1:1|同一个值|逐字节同」；
 *   · 只认 `与 globals.css token 1:1` 这一条真实发生过的变体；
 *   · **不判**泛指 token 的散文（`与 --color-subtle 在浅色主题下是同一个值`、
 *     `--color-muted … 与 --color-ink-muted 逐字节同值`）—— 那些是 token 之间的关系说明，
 *     不承载「这行裸值归品牌管」的错误预期；宽形态实测会在 globals.css 的注释里命中一片，
 *     与上面第 ③ 条留下的教训同形（别造误报机）。
 */
const EQUALITY_CLAIM_RES = [
  /(?:与|跟)\s*[`'"]?--color-(?:primary|accent)[\w-]*[`'"]?[^。\n）)]{0,16}(?:同值|相等|1:1|同一个值|逐字节同)/,
  /(?:与|跟)\s+globals\.css\s+token[^。\n）)]{0,12}(?:同值|相等|1:1)/,
];


function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const rel = (p) =>
  p
    .split(path.sep)
    .join("/")
    .replace(ROOT.split(path.sep).join("/") + "/", "");

const violations = [];
const exempted = [];
const ghosts = [];
const composed = [];
const equalityClaims = [];

/**
 * 全仓 CSS 里**真实声明过**的 `--color-*`（`@theme` 与 `.dark` 覆盖都算）。
 * 先去注释再取：被注释掉的那行声明不算定义 —— 幽灵 token 的形态恰恰是
 * 「引用还在、定义没了」。
 */
const declaredColorVars = new Set();
for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  if (!/\.css$/.test(abs)) continue;
  const css = stripComments(fs.readFileSync(abs, "utf8"));
  for (const m of css.matchAll(CSS_VAR_DECL_RE)) declaredColorVars.add(m[1]);
}

for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const r = rel(abs);
  if (!SOURCE_EXT.test(r) || isTestFile(r)) continue;
  const text = fs.readFileSync(abs, "utf8");
  if (!colorHitsInLine(text).length && !/[^\x00-\x7F]/.test(text)) {
    /* 没有色值就没得报；中文只用于豁免清单命中时的说明，跳过纯 ASCII 快路。 */
  }
  const lines = text.split("\n");
  /** 去注释后的行（保留行号），色值只在代码里判 —— 注释里的色值与 ISSUE 号都不是代码。 */
  const codeLines = stripComments(text).split("\n");
  const cl = classifyFile(r);
  const scopes = cl ? scopeResolver(text) : null;

  for (let i = 0; i < lines.length; i++) {
    const hits = colorHitsInLine(codeLines[i]);
    if (!hits.length) continue;
    const lineNo = i + 1;
    if (
      cl &&
      (cl.wholeFile ||
        cl.lines.has(lineNo) ||
        (scopes[i] && cl.names.has(scopes[i])))
    ) {
      exempted.push({
        file: r,
        line: lineNo,
        hits: hits.length,
        scope: scopes[i],
      });
      continue;
    }
    violations.push({
      file: r,
      line: lineNo,
      hits: hits.join(" "),
      text: lines[i].trim(),
    });
  }

  /* 幽灵 token：同一个文件循环里顺手扫，避免第二次遍历 src。
   * `m[2] === ","` 表示这行带兜底值 —— 渲染确定，但那是「装饰性 indirection」（④）。 */
  for (let i = 0; i < codeLines.length; i++) {
    for (const m of codeLines[i].matchAll(COLOR_VAR_REF_RE)) {
      if (declaredColorVars.has(m[1])) continue;
      ghosts.push({
        file: r,
        line: i + 1,
        name: m[1],
        fallback: m[2] === ",",
        text: lines[i].trim(),
      });
    }
    /* ③ 拼接 token 名：上面那条判据看不见引用，Tailwind 也看不见 → 会被 shake。
     * 只看代码行（`codeLines` 已去注释），所以 globals.css 那 103 处散文提及不会命中。 */
    if (COMPOSED_NAME_RES.some((re) => re.test(codeLines[i]))) {
      composed.push({ file: r, line: i + 1, text: lines[i].trim() });
    }
    /* ⑤ 跨面相等主张：判据要读**注释**，所以这里用未去注释的原文行。 */
    if (EQUALITY_CLAIM_RES.some((re) => re.test(lines[i]))) {
      equalityClaims.push({ file: r, line: i + 1, text: lines[i].trim() });
    }
  }
}

/* ⑤ 的另一半：本脚本自己的豁免登记理由。这次四处过期主张里有三处就长在这里，
 * 而 src/** 的遍历看不见它 —— 不扫自己这条判据就只覆盖了一半。 */
for (const entry of [...EXEMPT_TABLES, ...EXEMPT_FIXED_DARK]) {
  if (EQUALITY_CLAIM_RES.some((re) => re.test(entry.reason ?? ""))) {
    equalityClaims.push({
      file: "scripts/check-theme-colors.cjs（豁免理由）",
      line: 0,
      text: `${entry.file} —— ${entry.reason}`,
    });
  }
}

/* ── 报告 / 棘轮 ────────────────────────────────────────── */

const byFile = new Map();
for (const v of violations) {
  const list = byFile.get(v.file) ?? [];
  list.push(v);
  byFile.set(v.file, list);
}

/** 未豁免计数（按文件）：rel -> 处数。 */
const counted = Object.fromEntries(
  [...byFile].map(([f, list]) => [f, list.length]),
);

const exemptByFile = new Map();
for (const e of exempted) {
  exemptByFile.set(e.file, (exemptByFile.get(e.file) ?? 0) + e.hits);
}
const totalExemptHits = exempted.reduce((n, e) => n + e.hits, 0);

/**
 * 「整份文件一处可豁免的色值都没有」的豁免项 = 负债，不是保险。
 *
 * 这种条目不会报错，只会把该文件**未来的**新增写死色值一并静默放行（整文件豁免的
 * 粒度尤其危险）。本轮实测清掉 4 条：三个文件的色值只剩在注释里（判据本来就不数
 * 注释），一个早已 token 化。
 *
 * 口径是**按文件**而不是按条目：同一份文件可以有多条豁免（整文件 + 按声明 + 按行），
 * 命中归到谁头上取决于数组顺序，按条目判会把「被前一条遮蔽」误报成死条目。
 * 真正危险的是整份文件都没东西可豁免 —— 那个判定与顺序无关。
 * 文件根本不在扫描面（临时夹具仓库、或路径写错）是另一件事，
 * 由 `tests/gate-hint-targets-exist.test.ts` 盯着。
 */
const filesWithExemptHits = new Set(exempted.map((e) => e.file));
const unusedExempts = [...EXEMPT_TABLES, ...EXEMPT_FIXED_DARK].filter(
  (e) =>
    fs.existsSync(path.join(ROOT, e.file)) && !filesWithExemptHits.has(e.file),
);
for (const e of unusedExempts) {
  console.warn(
    `[theme-colors] ⚠️ 豁免一处都没命中（负债，删掉它）：${e.file} —— ${e.reason}`,
  );
}
if (unusedExempts.length > 0 && !REPORT_ONLY) {
  console.error(
    `[theme-colors] ${unusedExempts.length} 条豁免不再命中任何东西。` +
      "留着 = 那个文件今后写死色值会被静默放行。请把这几条从 EXEMPT_TABLES /\n" +
      "  EXEMPT_FIXED_DARK 删掉；色值确实回来了就按 §3.6.1 重新登记并写清新理由。",
  );
  process.exit(1);
}

/* ── 幽灵 token（硬闸，不进基线）──────────────────────────── */

function printGhosts() {
  if (!ghosts.length) return;
  console.log(
    "[theme-colors] 引用了从未定义的 --color-*（字面 var() 查无此名）：",
  );
  for (const g of ghosts) {
    console.log(
      `  ✗ ${g.file}:${g.line} — ${g.name}${g.fallback ? "（带兜底 = 装饰性 indirection：兜底永远生效，这行其实不随主题）" : "（无兜底 = 静默退成初值）"}｜${g.text}`,
    );
  }
}

function printComposed() {
  if (!composed.length) return;
  console.log(
    "[theme-colors] token 名是拼出来的（幽灵判据看不见、Tailwind 会 shake 掉它）：",
  );
  for (const c of composed) {
    console.log(`  ✗ ${c.file}:${c.line} ｜${c.text}`);
  }
}

/** 打印跨面相等主张（⑤）：注释与本脚本豁免理由里的「与品牌 token 同值」类句子。 */
function printEqualityClaims() {
  if (!equalityClaims.length) return;
  console.log(
    "[theme-colors] 用「与品牌 token 同值」这类主张给裸色值背书（改了 token 它不会红）：",
  );
  for (const c of equalityClaims) {
    console.log(`  ✗ ${c.file}${c.line ? `:${c.line}` : ""} ｜${c.text}`);
  }
}

/** 打印豁免清单（让人一眼看出「哪些是被有意放行的」）。 */
function printExemptions() {
  if (!exemptByFile.size) return;
  console.log("[theme-colors] 已显式豁免（规范 §3.6.1 例外，不再进入报告）：");
  for (const [f, n] of [...exemptByFile].sort((a, b) => b[1] - a[1])) {
    const entry = EXEMPT_INDEX.get(f)[0];
    console.log(`  · ${f} — ${n} 处 — ${entry.reason}`);
  }
}

/** 打印未豁免命中（按处数降序）。 */
function printViolations() {
  if (!byFile.size) return;
  console.log("[theme-colors] 未豁免命中（按规范 §3.6.1 须 token 化）：");
  for (const [f, list] of [...byFile].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`  ✗ ${f}（${list.length} 处）`);
    for (const v of list.slice(0, 5)) {
      console.log(`      L${v.line}: ${v.hits}  ${v.text.slice(0, 90)}`);
    }
    if (list.length > 5) console.log(`      … 另 ${list.length - 5} 处`);
  }
}

const totalCounted = Object.values(counted).reduce((a, b) => a + b, 0);

console.log(
  `[theme-colors] 扫描 ${SCAN_DIR}/**：未豁免写死色值 ${totalCounted} 处 / ${byFile.size} 文件；` +
    `显式豁免 ${totalExemptHits} 处 / ${exemptByFile.size} 文件`,
);

/* 幽灵 token 是「引用还在、定义没了」——与写死色值多少处无关，所以单独一条
 * 硬闸、不进基线；--update 也不许带着它重写基线。 */
if (ghosts.length > 0 && !REPORT_ONLY) {
  printGhosts();
  console.error(
    `[theme-colors] ${ghosts.length} 处幽灵 token：var(--color-…) 查无定义。` +
      "无兜底时 SVG 的 fill 退成黑色、stroke 退成 none（不报错，只是看不见）；\n" +
      "  带兜底时渲染结果确定，但那行其实不随主题 —— 是硬编码值冒充 token（§3.6.1 的反面）。\n" +
      "  二选一：在 src/app/globals.css 的 @theme 里补上定义（需要两态就补两档），\n" +
      "  或把这一行改回写死色值（后者要按 §3.6.1 登记豁免）。\n" +
      "  边界与不覆盖的形态见 §3.6.1.1「幽灵 token / 装饰性 indirection」一节。",
  );
  process.exit(1);
}

/* ③ 拼接 token 名：同幽灵 token，条数与写死色值无关，硬闸不进基线。 */
if (composed.length > 0 && !REPORT_ONLY) {
  printComposed();
  console.error(
    `[theme-colors] ${composed.length} 处把 --color-* 的名字拼了出来。` +
      "两条判据同时失效：幽灵 token 判据比对不到「引用了哪个名字」，\n" +
      "  而 Tailwind v4 靠源码里出现过的**字面名**决定保留哪颗 @theme 变量 ——\n" +
      "  拼出来的名字它也看不见，那颗 token 连编译产物都进不去（实测：无人引用的\n" +
      "  声明在产物里出现 0 次）。改法：把整名写全，JS 取色走\n" +
      '  useCssColorToken("--color-完整字面名", 兜底)。见 §3.6.1.1。',
  );
  process.exit(1);
}

/* ⑤ 跨面相等主张：也是一条独立的硬闸 —— 它判的是「说的话还成不成立」这一面，
 * 与写死色值几处、豁免命中几条都无关，所以不进基线、--update 也不许带着它重写。 */
if (equalityClaims.length > 0 && !REPORT_ONLY) {
  printEqualityClaims();
  console.error(
    `[theme-colors] ${equalityClaims.length} 处用「与品牌 token 同值」给裸色值背书。` +
      "这类句子是**第二份账**：token 一改它不会红（实测事故 —— 品牌紫从 #7C5CFC\n" +
      "  深化成 #8557de 之后，四处这样的主张同时过期，而本门禁全程绿）。\n" +
      "  改法二选一：① 该行确实归品牌管 → 直接写 var(--color-primary)/var(--color-accent)，\n" +
      "     跟着走是机制，不需要主张；② 它是独立的内容色（类型色表、装饰表）→\n" +
      "     把那句「与谁同值」删掉，改写成「语义来源是类型/装饰」，别再跟品牌比大小。",
  );
  process.exit(1);
}

/* ── 模式一：只出报告（盘点） ── */
if (REPORT_ONLY) {
  printExemptions();
  printViolations();
  printGhosts();
  printComposed();
  printEqualityClaims();
  console.log("[theme-colors] --report 模式：只出清单，不判失败 ✓");
  process.exit(0);
}

/* ── 模式二：检查（未豁免须为 0，其余四条硬闸已在上方短路） ── */
printExemptions();

if (totalCounted > 0) {
  console.error("[theme-colors] 存在未豁免的写死色值：");
  for (const [f, list] of byFile) {
    console.error(`  ✗ ${f}：${list.length} 处`);
    for (const v of list) {
      console.error(`      L${v.line}: ${v.hits}  ${v.text.slice(0, 90)}`);
    }
  }
  console.error(
    "\n[theme-colors] 失败：出现了未经豁免的写死色值。\n" +
      "  判据（规范 03 §3.6.1）：能写成类名的必须是类名 —— 表面/文字语义的 #hex /\n" +
      "  rgba(...) 一律改语义 token。仅「类型色例外」（成组集中的端口类型色 / 节点\n" +
      "  类别色 / 参数分组色常量表）与「固定暗色清单」（画布极小面积叠层）可豁免；\n" +
      "  新增豁免须在 scripts/check-theme-colors.cjs 的 EXEMPT_TABLES / EXEMPT_FIXED_DARK\n" +
      "  里逐条写明理由，并与 globals.css 清单、规范 §3.6.1 同步。\n" +
      "  本判据是硬闸（无基线、无 --update）：存量已清零，新增一处即阻断。",
  );
  process.exit(1);
}

printViolations();
console.log(
  `[theme-colors] 通过 ✓（未豁免 0 处；豁免 ${totalExemptHits} 处不参与判定）`,
);
