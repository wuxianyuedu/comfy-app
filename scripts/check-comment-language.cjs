#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:注释语言棘轮(供 .githooks/pre-commit 与 CI 调用)
/**
 * 注释语言棘轮 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.4.6。
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
 * ## 为什么按「比例」记账、按文件记棘轮
 *
 * 这条规则的整改面是**整个仓库的注释**(实测 419 个文件 / 5971 行),不是某个文件。
 * 一刀切("一个英文注释都不许有")会让所有存量提交当场变红,而"一次性全改"的 diff
 * 谁都不会读 —— 这正是 §13.5.2 那条「格式化提交与行为改动分离」要防的形态。
 *
 * 所以口径与其它棘轮(重复块 / 函数长度 / 文件行数 / 格式)一致:每个文件记一个
 * 「疑似英文注释行」计数,只许降不许升 ——
 *   ① 新增文件带英文注释 → 阻断;
 *   ② 存量文件的英文注释**变多** → 阻断;
 *   ③ 中文化有进展 → 提示 `--update` 收紧;`--strict` 下未收紧即失败。
 *
 * ## 判定口径(两条,都写在代码里,不靠人记得)
 *
 * 1. **只统计注释行**。字符串字面量、URL、代码标识符一律不看 —— 它们里的英文
 *    是**内容**不是**文字**,改成中文会改行为(与 §12.11 的「判据写成形状等于把
 *    门禁挂在实现细节上」相反:这里的形状正是判据本身)。
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
 *   node scripts/check-comment-language.cjs             # 检查(棘轮)
 *   node scripts/check-comment-language.cjs --strict    # 基线未收紧也失败
 *   node scripts/check-comment-language.cjs --update    # 重写基线(须伴随下降)
 *   node scripts/check-comment-language.cjs --report    # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const BASELINE = path.join(__dirname, ".comment-language-baseline.json");
/** 判据版本:只有判据本身变了(例如换了「疑似英文句子」的阈值)才允许一次性重记,
 *  其余情况数字只许下降 —— 否则 `--update` 就成了「这条先放宽一下」的后门
 *  (与 §12.13 / §12.16 同款口径)。 */
const RULE_VERSION = 1;
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
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
 *   - `eslint-disable*` —— eslint 指令;
 *   - `@jsx*` / `@jsxRuntime` —— 编译指示;
 *   - `turbopackIgnore: <bool>` —— Turbopack 的静态分析豁免指令,
 *     按字面量解析「这一处不要被静态追踪」(见 src/lib/comfyui/trace.ts 等 62 处)。
 * 判据只认**行首就是该指令**的行(允许前面有 `*` 与空白),
 * 以免把「说明某个指令」的正常中文注释一起放行。
 */
const TOOL_DIRECTIVE_RE =
  /^\s*\*?\s*@?(vitest-environment|ts-ignore|ts-expect-error|ts-nocheck|ts-check|jsx|jsxRuntime|jsxImportSource|ts-expectError)\b|^\s*\*?\s*eslint-(disable|enable)|^\s*\*?\s*turbopackIgnore\s*:/;

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), out);
    } else if (SCAN_EXT.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
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
function looksEnglish(text) {
  return (text.match(ENGLISH_WORD_RE) || []).length >= ENGLISH_WORDS_THRESHOLD;
}

function hasCJK(text) {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/.test(
    text,
  );
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
  let count = 0;
  for (const raw of lines) {
    const line = raw.trim();
    let text = null;
    if (inBlock) {
      text = line.replace(/^\*+/, "").trim();
      if (line.includes("*/")) inBlock = false;
    } else if (line.startsWith("/*")) {
      text = line.replace(/^\/\*+/, "").replace(/\*\/$/, "").trim();
      if (!line.includes("*/")) inBlock = true;
    } else if (line.startsWith("//")) {
      text = line.slice(2).trim();
    }
    if (text === null || !text) continue;
    if (TOOL_DIRECTIVE_RE.test(text)) continue;
    if (hasCJK(text)) continue;
    if (looksEnglish(text)) count += 1;
  }
  return count;
}

function collect(asciiOnly) {
  const counts = {};
  let scanned = 0;
  let total = 0;
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = toPosix(path.relative(ROOT, file));
      // 白名单文件整文件豁免:它们在名单里的原因就是「必须英文 + 纯 ASCII」。
      if (asciiOnly.has(rel)) continue;
      scanned += 1;
      const n = countEnglishCommentLines(fs.readFileSync(file, "utf8"));
      if (n > 0) {
        counts[rel] = n;
        total += n;
      }
    }
  }
  return { counts, scanned, total };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return { ruleVersion: RULE_VERSION, files: {} };
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

async function main() {
  const asciiOnly = await asciiOnlyModules();
  const { counts, scanned, total } = collect(asciiOnly);

  if (REPORT_ONLY) {
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    console.log(
      `扫描 ${scanned} 个代码文件:疑似英文注释 ${total} 行,分布在 ${rows.length} 个文件`,
    );
    for (const [rel, n] of rows) console.log(`  ${String(n).padStart(5)}  ${rel}`);
    return;
  }

  const baseline = readBaseline();

  if (UPDATE) {
    fs.writeFileSync(
      BASELINE,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString().slice(0, 10),
          ruleVersion: RULE_VERSION,
          note:
            "疑似英文注释行计数棘轮(规范 12.4.6,判据版本 1);只许降不许升。" +
            "白名单见 docs/reference-facts.md 的 comment.language.asciiOnly。",
          total,
          files: counts,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`✓ 已写入基线:${total} 行 / ${Object.keys(counts).length} 个文件`);
    return;
  }

  // 判据版本不一致时直接阻断:旧数字与新计数不是同一个量,比对没有意义。
  if (baseline.ruleVersion !== RULE_VERSION) {
    console.error(
      `✗ 基线判据版本 ${baseline.ruleVersion} 与当前 ${RULE_VERSION} 不一致,` +
        `\n  旧数字与新口径不是同一个量。请执行:node scripts/check-comment-language.cjs --update`,
    );
    process.exit(1);
  }

  const baseFiles = baseline.files || {};
  const added = [];
  const grown = [];
  for (const [rel, n] of Object.entries(counts)) {
    const base = baseFiles[rel];
    if (base === undefined) added.push(`${rel}（${n} 行）`);
    else if (n > base) grown.push(`${rel}（${base} → ${n} 行）`);
  }
  const shrunk = Object.entries(baseFiles).filter(
    ([rel, n]) => (counts[rel] ?? 0) < n,
  );

  let failed = false;
  if (added.length) {
    console.error(
      `✗ 新增 ${added.length} 个带英文注释的文件（规范 §12.4.6:注释一律中文）:`,
    );
    for (const a of added) console.error(`    ${a}`);
    failed = true;
  }
  if (grown.length) {
    console.error(`✗ ${grown.length} 个文件的英文注释变多（棘轮只许降不许升）:`);
    for (const g of grown) console.error(`    ${g}`);
    failed = true;
  }
  if (failed) {
    console.error(
      "\n修法:把注释改成中文（专有名词 / 命令 / 路径 / 错误原文保留英文）。" +
        "\n  确实必须写英文的构建期模块 → 登记进 docs/reference-facts.md 的" +
        "\n  `comment.language.asciiOnly` 一行（规范 launch-and-build §9.6）。",
    );
    process.exit(1);
  }
  if (STRICT && shrunk.length) {
    console.error(
      `✗ 基线里 ${shrunk.length} 个文件的英文注释已减少,请收紧基线:` +
        `\n    node scripts/check-comment-language.cjs --update`,
    );
    process.exit(1);
  } else if (shrunk.length) {
    console.log(
      `提示:${shrunk.length} 个文件的英文注释已减少,可执行 node scripts/check-comment-language.cjs --update 收紧基线`,
    );
  }

  console.log(
    `✓ 无新增英文注释（§12.4.6;基线 ${baseline.total ?? 0} 行,当前 ${total} 行,扫描 ${scanned} 个文件）`,
  );
}

main().catch((err) => {
  console.error(`✗ 注释语言棘轮执行失败:${err?.message ?? err}`);
  process.exit(1);
});
