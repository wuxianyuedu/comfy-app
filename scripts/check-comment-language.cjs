#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:注释语言棘轮(供 .githooks/pre-commit 的 D 组调用)
/**
 * 注释语言判据（**硬闸**）—— 规范见 docs/standards/12-代码组织与文件结构.md §12.4.6。
 *
 * 背景(ISSUE #678「代码中的注释尽量改成中文」):
 * 本仓库的文档、报错文案、Issue、评审结论全是中文,但源码里的注释大量是英文 ——
 * 同一个仓库里同一件事有两种写法,新人照最近的邻居抄,漂移面积只会自己变大
 * (与 §12.8.0 的 `@/` 同一类问题:能编译、能跑、类型也对,所以没有任何反馈)。
 *
 * 判据:注释**一律中文**;唯一例外是「会被 `next-code-frame` 渲染到」的构建期模块
 * (Next 的 code frame 按**字节**切串,高亮区间端点落在多字节字符内部时 Rust 侧
 * 直接 panic,整个 `next build` 被一个与业务无关的错误带走 —— launch-and-build §5)。
 * 那几个文件必须保持纯 ASCII、注释写英文,名单登记在 docs/reference-facts.md 的
 * `comment.language.asciiOnly` 一行(**权威定义只有这一份**,本脚本反向解析它,
 * 与规范正文共读同一份清单)。
 *
 * ## 从「按比例记账的棘轮」到硬闸
 *
 * 这条规则的整改面是**整个仓库的注释**(实测 419 个文件 / 5971 行),不是某个文件。
 * 一刀切("一个英文注释都不许有")会让所有存量提交当场变红,而"一次性全改"的 diff
 * 谁都不会读 —— 这正是 §13.5.2 那条「格式化提交与行为改动分离」要防的形态。
 *
 * 所以它**曾经**是与其它棘轮(重复块 / 函数长度 / 文件行数 / 格式)同款的**棘轮**:
 * 每个文件记一个「疑似英文注释行」计数、只许降不许升。存量清零后棘轮的两个动作
 * (`--update` 收紧 / `--strict` 要求下降)都无事可做,留下的却是一条「手改那份
 * JSON 就能把新违规登记成已知存量」的通道 —— 硬闸类本来没有这个中间态
 * (§13.6.2 的两类对照)。ISSUE #1811 因此删基线、删 `--update` / `--strict`:
 * **现在任何一处疑似英文注释都阻断**(判定口径与扫描面一字未动)。
 *
 * ## 判定口径(两条,都写在代码里,不靠人记得)
 *
 * 1. **只统计注释行**。字符串字面量、URL、代码标识符一律不看 —— 它们里的英文
 *    是**内容**不是**文字**,改成中文会改行为(与 §12.11 的「判据写成形状等于把
 *    门禁挂在实现细节上」相反:这里的形状正是判据本身)。
 *    **`.tsx` 里的 JSX 注释(`{/* … *\/}`)同样是注释**,按块注释同判 —— 早期版本
 *    只认行首 `/*` / `//`,JSX 注释**从未被扫描**(判据盲区:那些英文注释既不会被
 *    统计、也不会被拦下,棘轮数字还一直显示「很干净」)。
 * 2. **行内必须含「疑似英文句子」才计入**。判据是**连续英文单词(≥2 个字母)≥ 3 个**
 *    —— `// TODO: check` 这类两词以内的行、`// --- 分隔线 ---`、`// [ERROR] foo`
 *    一律不计入。理由:计数里混进分隔线与标签会让数字失去意义(它要回答的是
 *    「这段注释是不是英文写的」,而不是「这段注释里有没有英文字母」)。
 *
 * ## 已知边界(刻意不判,不假装覆盖)
 *
 * 中英**混排**(中文句子里夹一个英文术语)不计入 —— 「注释是不是英文」机器判不出
 * 精确边界,而把阈值收紧到「只要含英文即违规」会把 `Zustand` / `IPC` / `PR` 这类
 * 必须保留的专有名词一起判违规,门禁当场变成噪音源(§12.13「降到 200 会让 40 个
 * 函数一起亮,清单变噪音,没人会照它排期」的同款教训)。混排由 §13.1 自查清单与
 * Review 兜。
 *
 * 用法:
 *   node scripts/check-comment-language.cjs             # 检查(硬闸:命中即退 1)
 *   node scripts/check-comment-language.cjs --report    # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");
const { readForScan, walkForScan, vanishedNote } = require("./gate-scan-read.cjs");

const ROOT = process.cwd();
/* 这里**没有** RULE_VERSION：它是棘轮「判据变了才允许一次性重记」的配套常数，
 * 而本判据已翻硬闸（无基线可重记、无 `--update`），那个常数一并消失了。
 * 口径沿革（`looksEnglish()` 的版本 3 补过第 ② 条「剩余部分须含虚词/动词」）记在
 * 规范 §12.4.6 与 `tests/comment-language.test.ts`，不再靠源码里的常数承载。 */
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围:应用源码、门槛脚本、测试、e2e。 */
const SCAN_DIRS = ["src", "scripts", "tests", "e2e"];
/** 扫描的扩展名:仓库里所有会写注释的代码形态。 */
const SCAN_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/;
/** 不扫的目录:产物、依赖、运行时输出。 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
  "log",
  "run",
  "temp",
  "python-venv",
  "__pycache__",
  "generated",
]);

/** 连续英文单词(≥2 个字母)达到这个数量,即判该注释行是「英文写的」。 */
const ENGLISH_WORDS_THRESHOLD = 3;
const ENGLISH_WORD_RE = /[A-Za-z]{2,}/g;

/**
 * 保持原文形态的「工具指示注释」：这些**不是给人读的注释**,而是工具按字面量
 * 解析的指令,改成中文即静默失效(不是报错,是行为悄悄变回默认)。
 *   - `@vitest-environment jsdom` —— vitest 按这一行决定用例跑在什么环境;
 *   - `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` —— TypeScript 指令;
 *   - `eslint-disable*` / `oxlint-disable*` —— lint 指令（PR-B 起以 oxlint 为主）;
 *   - `@jsx*` / `@jsxRuntime` —— 编译指示;
 *   - `turbopackIgnore: <bool>` —— Turbopack 的静态分析豁免指令,
 *     按字面量解析「这一处不要被静态追踪」(见 src/lib/comfyui/trace.ts 等 62 处)。
 * 判据只认**行首就是该指令**的行(允许前面有 `*` 与空白),
 * 以免把「说明某个指令」的正常中文注释一起放行。
 */
const TOOL_DIRECTIVE_RE =
  /^\s*\*?\s*@?(vitest-environment|ts-ignore|ts-expect-error|ts-nocheck|ts-check|jsx|jsxRuntime|jsxImportSource|ts-expectError)\b|^\s*\*?\s*(eslint|oxlint)-(disable|enable)|^\s*\*?\s*turbopackIgnore\s*:/;

/**
 * JSDoc **结构行**豁免：`@param {T}` / `@returns {T}` / `@typedef {…}` /
 * `@type {…}` / `@property {T}` / `@template` 这类行**只含类型语法
 * 与标识符**，不含散文 —— 它们是类型声明，不是「用英文写的注释」。
 *
 * 为什么必须豁免：这些行的内容由 TS/JSDoc 语法决定（`{string | null}`、
 * `NodeJS.Platform`、`Record<string, string>`…），逐行塞中文说明会破坏
 * 语法（编辑器解析变红）或让 `@typedef` 的续行失去意义。而「把类型写成英文」
 * 不是本规则要治的病 —— 它治的是**人读的说明文字**用英文写。
 *
 * 判据刻意要求**去掉类型花括号后的剩余部分不含「疑似英文句子」**：
 * 带说明的 `@param {string} name 用户名` 不受影响（它有中文，本就不计入），
 * 而 `@param {string} candidate 待探测的命令` 里若只剩类型 + 标识符则豁免。
 * 于是「给类型行补中文说明」仍然是推荐写法（更好读），但**不再被门禁逼着写**。
 */
const JSDOC_STRUCTURAL_RE =
  /^\s*\*?\s*@(param|arg|argument|returns?|typedef|type|property|prop|template|generic|satisfies|satisfies|extends|implements|readonly|internal|private|public|protected|package|enum|this|typeParam)\b/;
/**
 * 去掉「@tag + 可选类型块 + 可选参数名」后，是否还剩**散文**。
 *
 * 只剥这三段，不再剥第三个及其后的标识符 —— 否则
 * `@param {string} candidate the command to probe` 里的说明句会被当成
 * 标识符逐词删掉，把「写了英文说明」误判成「只有类型语法」。
 */
/** 去掉类型语法与 @tag 后，是否出现「英文虚词 / 动词」（那就是说明句）。 */
const JSDOC_PROSE_WORDS_RE =
  /\b(the|a|an|is|are|was|were|be|been|being|to|of|for|with|and|or|not|no|when|which|that|this|these|those|it|its|so|than|then|via|from|by|as|at|in|on|into|onto|over|under|use|used|uses|using|call|calls|called|must|should|can|could|may|might|will|would|have|has|had|do|does|did|only|also|both|each|every|any|all|some|one|two|three|first|second|last|next|before|after|while|until|because|since|if|else|but|however|note|means|become|becomes|instead|still|just|never|always|default|whether|same|other|another|happen|happens|appear|appears|remain|remains|keep|keeps|stay|stays|make|makes|made|give|gives|given|take|takes|taken|get|gets|point|points|points?|hold|holds|held|return|returns|returning)\b/i;

/** 剥掉类型块、`[...]` 名字、`@tag`，剩下的就是标识符与标点。 */
function stripJsdocTypeSyntax(text) {
  let rest = text.replaceAll(/\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, " ").replaceAll(/\[[^\]]*\]/g, " ");
  if (rest.includes("{")) {
    rest = rest.slice(0, rest.indexOf("{"));
  }
  return rest.replaceAll(/@\w+/g, " ").replaceAll(/[{}]/g, " ");
}

/**
 * `@param` / `@property` 类行的**名字**位置：`@param {T} name` / `@property {T} name`
 * 里紧跟类型块的那个标识符。它必须是**单个**词，且不是 `{T}` 形式的类型块本身。
 *
 * ⚠️ `@property` 与 `@param` 同一个道理（原来只列了前三者，于是
 * `@property {string} note` 被判成英文散文 —— `note` 在虚词表里，而那一行
 * 一个英文说明字都没有；现场是 `scripts/ci-probe-lock-readout.mjs` 的 `Reading`
 * typedef，ISSUE #2589 批 6 撞上）。可选字段写成 `@property {T} [name]` 时，
 * 方括号那一段已被 `stripJsdocTypeSyntax` 剥掉，这里不需要特判。
 */
const PARAM_TAG_RE = /@(param|arg|argument|property|prop)\s+(?:\{[^{}]*\}\s+)?([A-Za-z_$][\w$]*)/;

/**
 * 一行是否**本身就是** JSDoc 结构行（带 `@param` / `@typedef` 等 tag）。
 * 判据：剥掉类型语法后不含英文虚词，且剩余英文词 < 3 个。
 *
 * ⚠️ 参数名要**先剥掉再判虚词**：`@param {string} from` / `to` / `at` 这类
 * 参数名恰好是英文虚词（`from` 在 `JSDOC_PROSE_WORDS_RE` 里），不剥掉就会被
 * 判成「英文说明句」—— 实测全仓 3 处误报（`scripts/launcher-core/run.mjs` 的
 * `@param {Date} at` / `@param {string} from` / `@param {string} to`），
 * 而这三行是**纯类型语法行**、一个英文说明字都没有。
 * 剥掉名字之后剩下的若真是说明句（`@param {T} x the timeout to use`），
 * 虚词照旧命中 —— 判据的拦截面没有被放宽。
 */
function jsdocStructuralOnly(text) {
  if (hasCJK(text)) {
    return false;
  } // 有中文说明 → 本就不计入
  let rest = stripJsdocTypeSyntax(text);
  const param = PARAM_TAG_RE.exec(text);
  if (param?.[2]) {
    // 剥掉参数名那一处（整词），余下才是说明部分。
    rest = rest.replace(new RegExp(`(^|\\s)${param[2].replaceAll(/[$]/g, String.raw`\$`)}(?=\\s|$)`), " ");
  }
  if (JSDOC_PROSE_WORDS_RE.test(rest)) {
    return false;
  }
  const words = rest.match(/[A-Za-z]{2,}/g) ?? [];
  return words.length < 3;
}

/**
 * 一行是否是 JSDoc **结构块的续行**（只在块由结构行开头时调用）。
 * 判据比结构行更宽：续行里全是类型语法时，标识符个数不受 3 个的限制
 *（`version: string | null }} ProbeResult` 有 4 个词，但都是标识符）。
 * 仍以「不含英文虚词」为准 —— 说明句一定含虚词。
 */
function jsdocStructuralContinuation(text) {
  if (hasCJK(text)) {
    return false;
  }
  if (text.startsWith("//")) {
    return false;
  }
  const rest = stripJsdocTypeSyntax(text);
  if (JSDOC_PROSE_WORDS_RE.test(rest)) {
    return false;
  }
  // 出现句末标点（`.`/`!`/`?`）说明是句子，不是类型
  return !/[.!?]\s*$/.test(rest.replaceAll(/[\w)]\.(?=\w)/g, ""));
}

/**
 * 一行是否是「JSDoc 结构行」—— `@param` / `@returns` / `@typedef` / `@type` /
 * `@property` / `@template` 等带类型语法的行。
 * 续行（块由结构行开头，本行仍是类型语法）由调用方另行判定。
 */
function isJsdocStructuralLine(text) {
  return JSDOC_STRUCTURAL_RE.test(text) && jsdocStructuralOnly(text);
}

function walk(dir) {
  /* 点开头的**目录**不进去（`.next` / `.git` 之类），但点开头的**文件**照收 ——
   * 并发探针（`tests/.setup-cleanup-probe-*.test.tsx`）正是后者，跳掉它等于在最该
   * 看着的那一刻不看。消失容错的口径见 `gate-scan-read.cjs`。 */
  return walkForScan(dir, SCAN_EXT, {
    skipDirs: SKIP_DIRS,
    skipHiddenDirs: true,
  });
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/**
 * 「纯 ASCII 模块」白名单 —— 名单的**权威定义**在 docs/reference-facts.md 的
 * `comment.language.asciiOnly` 一行,由 scripts/doc-facts.cjs 解析。
 * 这里不另写一份:两份清单必然各自漂移,表现是「文档说允许、判据说违规」。
 */
async function asciiOnlyModules() {
  const { extractAsciiOnlyModules } = await import("./doc-facts.cjs");
  return new Set(extractAsciiOnlyModules());
}

/**
 * 该注释文本是否「疑似英文句子」。
 *
 * 纯符号行(分隔线 / 标签 / 标点)不含连续英文单词,自然不计入;
 * `// TODO: check` 只有 2 个单词,同样不计入 —— 见头注的判定口径第 2 条。
 */
/**
 * 一行注释是否「用英文写的说明句」。两条同时成立才算：
 *   ① **剥掉引用形态**之后还剩 ≥ `ENGLISH_WORDS_THRESHOLD` 个英文词。剥三类：
 *      反引号内联代码、成对引号里的字面量、**连字符拼接的标识符整体**
 *      （`open-in-browser` / `use-reentrancy-lock` / `proc-detect`…）——
 *      第三类不能省：连字符在 `\b` 眼里就是词边界，模块名里的
 *      `in` / `on` / `as` / `it` 会被当成虚词，把一整串纯路径清单误判成英文句子；
 *   ② 剩余部分**含英文虚词/动词**（`JSDOC_PROSE_WORDS_RE`，与 JSDoc 结构行
 *      豁免同源的那张表）—— 也就是它构成一句英文。
 *
 * 为什么要加第 ② 条：本规则治的是「**人读的说明文字用英文写**」，而不是
 * 「注释里出现了英文」。中文段落里把一批标识符 / 路径 / 类名 / ARIA 属性
 * 折到下一行，是极常见的写法，旧口径（只看词数）会把它们整片判成违规 ——
 * 实测 21 行里 20 行是这一类，于是基线只能靠「垫一句中文」或「放宽基线」
 * 去消红，两者都把门禁推向噪音（噪音判据的终局是没人再看它）。
 *
 * 代价要说清：**不含虚词的纯实词英文短句不再被拦**（例如
 * `// probe launch path timeout`）。这张表本身覆盖 100+ 个高频虚词与常用
 * 动词，真正的英文散文几乎必然命中；漏的那一类由 review 兜，不靠这里加码。
 * 第 ① 条的词数下限因此只作「有没有英文书写痕迹」的粗筛，不再是充分条件。
 */
function looksEnglish(text) {
  const bare = text
    .replaceAll(/`[^`]*`/g, " ")
    .replaceAll(/"[^"]*"|'[^']*'|“[^”]*”/g, " ")
    .replaceAll(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g, " ");
  if ((bare.match(ENGLISH_WORD_RE) ?? []).length < ENGLISH_WORDS_THRESHOLD) {
    return false;
  }
  return JSDOC_PROSE_WORDS_RE.test(bare);
}

function hasCJK(text) {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/.test(text);
}

/**
 * 统计一个文件的「疑似英文注释行」数。
 *
 * 只认整行注释(`//` / `/* … *\/` 的每一行),**不解析行尾注释之前的代码** ——
 * 这样字符串字面量里的英文天然不进统计,而代价是「代码 + 行尾注释同行」时把该
 * 行的注释一起算进来。后者是**保守**方向(宁可多算,即会拦住自己),不会漏放。
 */
function countEnglishCommentLines(src) {
  const lines = src.split("\n");
  let inBlock = false;
  /** 当前是否处在「由结构 tag 开头的 JSDoc 块」里（用于豁免续行）。 */
  let inJsdocStruct = false;
  let count = 0;
  for (const raw of lines) {
    const line = raw.trim();
    let text = null;
    if (inBlock) {
      text = line.replace(/^\*+/, "").trim();
      if (line.includes("*/")) {
        inBlock = false;
      }
    } else if (line.startsWith("/*")) {
      text = line
        .replace(/^\/\*+/, "")
        .replace(/\*\/$/, "")
        .trim();
      if (!line.includes("*/")) {
        inBlock = true;
      }
    } else if (line.startsWith("//")) {
      text = line.slice(2).trim();
    } else if (line.startsWith("{/*")) {
      // JSX 里的注释：两种形态同判 ——
      //   ① 独占注释容器 `{/* … */}`（收口是 `*/}`）；
      //   ② 表达式容器前导注释 `{/* SAFETY: … */ (expr)…}`（anti-slop 的 SAFETY
      //      形态，`*/` 后面跟着的是代码不是 `}`）。这里若只认 `*/}` 收口，
      //      形态② 会把整份文件误判成「块注释内」，其后代码行被当成英文注释
      //      （现场：renderWithProviders.integration.test.tsx，SAFETY 批撞上）。
      // 收口判 `*/`；`*/` 之后的代码残段留在 text 里，属保守方向（宁可多算）。
      text = line
        .replace(/^\{\/\*+/, "")
        .replace(/\*\/\}$/, "")
        .replace(/(?<=\S)\*\/.*$/, "")
        .replace(/\*\/$/, "")
        .trim();
      if (!line.includes("*/")) {
        inBlock = true;
      }
    }
    if (text === null || !text) {
      continue;
    }
    if (TOOL_DIRECTIVE_RE.test(text)) {
      continue;
    }
    if (isJsdocStructuralLine(text)) {
      // 整个 JSDoc 块按结构块处理：其续行也只含类型语法时同样豁免
      inJsdocStruct = true;
      continue;
    }
    // 续行：块由结构 tag 开头，且本行剥掉类型语法后无英文成句 → 豁免
    if (inJsdocStruct && jsdocStructuralContinuation(text)) {
      continue;
    }
    inJsdocStruct = false;
    if (hasCJK(text)) {
      continue;
    }
    if (looksEnglish(text)) {
      count += 1;
    }
  }
  return count;
}

function collect(asciiOnly) {
  const counts = {};
  let scanned = 0;
  let total = 0;
  let vanished = 0;
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const file of walk(abs)) {
      const rel = toPosix(path.relative(ROOT, file));
      // 白名单文件整文件豁免:它们在名单里的原因就是「必须英文 + 纯 ASCII」。
      if (asciiOnly.has(rel)) {
        continue;
      }
      const raw = readForScan(file);
      /* 消失的那一份**不计进 `scanned`**：这条是棘轮，把「没读到」算成「读到且干净」
       * 会让下一轮的基线比这一轮的覆盖面更宽 —— 那是判据在自己没去过的地方报绿。 */
      if (raw === null) {
        vanished += 1;
        continue;
      }
      scanned += 1;
      const n = countEnglishCommentLines(raw);
      if (n > 0) {
        counts[rel] = n;
        total += n;
      }
    }
  }
  return { counts, scanned, total, vanished };
}

async function main() {
  const asciiOnly = await asciiOnlyModules();
  const { counts, scanned, total, vanished } = collect(asciiOnly);
  /* 消失数必须进结论：它等于「这几份文件这一轮没被读过」，而 `total` / `scanned`
     都会因此偏小（口径见 `gate-scan-read.cjs`：只降级 ENOENT、不许静默）。 */
  const note = vanishedNote(vanished);

  if (REPORT_ONLY) {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    console.log(
      `扫描 ${scanned} 个代码文件:疑似英文注释 ${total} 行,分布在 ${rows.length} 个文件${note}`,
    );
    for (const [rel, n] of rows) {
      console.log(`  ${String(n).padStart(5)}  ${rel}`);
    }
    return;
  }

  /* 存量已清零 ⇒ 这是硬闸：**任何一处疑似英文注释都阻断**，没有基线、没有
   * `--update`、没有 `--strict`。此前它是棘轮（`scripts/.comment-language-baseline.json`），
   * 而清零后的棘轮只剩两个无事可做的动作 + 一条「手改 JSON 就能把新违规登记成
   * 已知存量」的通道 —— 硬闸类本来没有那个中间态（§13.6.2 的两类对照）。 */
  if (total === 0) {
    console.log(`✓ 无英文注释（§12.4.6;扫描 ${scanned} 个文件）${note}`);
    return;
  }

  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.error(
    `✗ ${rows.length} 个文件里共 ${total} 行疑似英文注释（规范 §12.4.6:注释一律中文）:`,
  );
  for (const [rel, n] of rows) {
    console.error(`    ${String(n).padStart(5)}  ${rel}`);
  }
  console.error(
    `\n修法:把注释改成中文（专有名词 / 命令 / 路径 / 错误原文保留英文）。` +
      `\n  确实必须写英文的构建期模块 → 登记进 docs/reference-facts.md 的` +
      `\n  \`comment.language.asciiOnly\` 一行（规范 launch-and-build §9.6）。` +
      `\n  本判据是硬闸（无基线、无 --update）：存量已清零，新增即阻断。${
      note}`,
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(`✗ 注释语言棘轮执行失败:${error?.message ?? error}`);
  process.exit(1);
});
