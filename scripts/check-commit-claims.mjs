#!/usr/bin/env node
/**
 * check-commit-claims.mjs — 「提交信息里的机械可核声明 ⇄ 这次提交的树事实」的执行者
 * （规范 §11.23.5 / ISSUE #1605）。
 *
 * ── 立案现场 ──────────────────────────────────────────────────────────
 *
 * `ad81a912`（PR #1580 的 squash）的提交信息原文写着：
 *
 *   > master 新增的 §13.5.13 / §13.6.3 两节与各处插记照旧保留。
 *
 * 而它那次提交的树里，**这两节一次都不出现**（实测两份文档里 `grep -c` 都是 0）。
 * 这是一句**反事实的陈述**，而它从写下到进 master，经过的每一道关都不看它 ——
 * 平台侧是 squash 合并、不跑本地钩子，ISSUE #623 之后也无 CI 兜底。
 *
 * ── 为什么只核这一格（窄到零歧义）──────────────────────────────────────
 *
 * 不是「核提交信息全文」—— 那是自然语言理解，代价高、误报一片，且会把
 * 「写清楚发生了什么事」变成**一个要绕过的东西**（§12.18 的反面）。本条只核
 * **可机械核对**的那一种句式，且只认一种：
 *
 *   **`§<章节号> … 照旧保留 / 原样保留 / 照原文保留`** —— 该章节号必须是本次提交
 *   的树里某份规范文档的一个**标题**（`^#+ <章节号>[ .]`）。纯 grep、零歧义。
 *
 * 为什么不顺手把「N 处收到 0」「X 文件没动」一起收进来：那两种句式在真历史里
 * **没有一次**以可机械核对的形态出现（实测：散文里的「归零」带一堆限定语）。
 * 收进来只会造出一条靠白名单活着的判据 —— **先有真现场、再有句式**。
 *
 * ── 两条避免误报的口径（都是实测撞出来的）────────────────────────────
 *
 * 1. **引号内的复述不算声明。** `1f629434` 的信息里有一句
 *    `「master 新增的 §13.5.13 / §13.6.3 两节照旧保留」—— 实测那两节一次都不出现`
 *    —— 那是**引用 `ad81a912` 说过的话**并当场反驳它。把复述读成声明，判据会在
 *    「指出别人说反话」这个动作上报红，而那个动作恰恰是本机制想要的。
 *    所以：落在成对引号内的短语一律不认。
 * 2. **只认「照旧 / 原样 / 照原文」这类明示前缀。** 光有「保留」二字太泛 ——
 *    实测「保留共有段落」「保留本分支的 check-click-keyboard.cjs」都是**正常叙述**
 *    （在说解冲突时取了哪一侧），不是「我保留了某个既有章节」的承诺。
 *    要求前缀 = 要求「这句自称在维持既有状态不变」，那才是能被 diff 证伪的形态。
 * 3. **「保留」的宾语必须是那一节。** `23bc80da` 的
 *    `§3.6.1 的 p71-allow 例外块照原文保留` 说的是「迁移时那个 lint 例外块照原样
 *    抄过去了」，与「§3.6.1 这一节还在」无关。所以 §号 与「保留」之间只许出现
 *    章节量词与并列连词，出现别的实词即不认。
 *
 * ── 它跑在哪（为什么不进钩子）─────────────────────────────────────────
 *
 * **不进 `pre-commit`**：本地钩子天然看不到平台侧 squash（§11.23.5 的「不做什么」），
 * 硬塞进钩子只会让人学会绕开它。它按 §13.5.4 的**按需召唤**那一层跑 ——
 * 事后盘点某次合并、复核一条 PR 的提交信息时，人点一次：
 *
 *   node scripts/check-commit-claims.mjs             # 体检 HEAD
 *   node scripts/check-commit-claims.mjs ad81a912    # 体检指定提交
 *   node scripts/check-commit-claims.mjs --report    # 只列命中、不判失败（盘点）
 *
 * 退出码：`0` = 没有反事实声明（或 `--report`）；`1` = 有声明与树事实相反；
 * `2` = **复算过程本身失败**（不在 git 检出 / 取不到提交）—— 与「判据红了」分开，
 * 后者是本脚本要**报告**的事实（同 `base-check.mjs` 的口径）。
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 规范文档在树里的位置（章节标题只可能写在这里）。 */
const DOCS_DIR = "docs/standards";

/** 明示「维持既有状态不变」的保留句式（理由见文件头口径 2）。 */
const KEEP_CLAIM_RE = /(?:照旧|原样|照原文|按原文|按原样)保留/;

/**
 * §号 与「保留」之间**允许出现的东西** —— 只允许「章节量词 + 并列连词 + 空白」。
 *
 * 这是第三条避免误报的口径，也是实测撞出来的：`23bc80da` 的
 * `§3.6.1 的 p71-allow 例外块照原文保留` 里，**保留的宾语是「例外块」而不是那一节**
 * —— 它的意思是「迁移时那个 lint 例外块照原样抄过去了」，与「§3.6.1 这一节还在」
 * 毫无关系。把这类读成声明，判据会在「正常叙述迁移动作」上报红。
 *
 * 反过来，立案现场那句是 `§13.6.3 两节与各处插记照旧保留` —— 中间只有
 * 「两节」「与」「各处插记」（同句并列的另一个保留对象）。所以规则是：
 * **中间段里除章节量词与并列连词外，不许出现别的实词**；出现即不认。
 */
const BETWEEN_ALLOW_RE =
  /^(?:\s|节|章|程|两|三|四|五|六|七|八|九|十|各|处|插|记|与|、|和|及|，|,|／|\/|§\s?\d+(?:\.\d+)+)*$/;

/** 章节号：`13.6.3` / `2.7.1`。段数 ≥ 2，避免把「§3 章」这类粗引用收进来。 */
const SECTION_RE = /(?:§|第\s?)(\d+(?:\.\d+)+)\s?节?/g;

/**
 * 成对引号 —— 落在其中任何一对内部的文本「是被人引用的」，不构成声明。
 *
 * 刻意**逐对配平**、而不是「出现过引号就整行跳过」：实测的反例句是
 * `「…照旧保留」—— 实测那两节一次都不出现`，同一行里引号外还有正文；
 * 整行跳过会把「同一行的真声明」一起漏掉，而漏得静默（§11.23.1 的病）。
 *
 * @type {Array<[string, string]>}
 */
const QUOTE_PAIRS = [
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ['"', '"'],
];

/** 只对 git 动作做包装：失败一律返回 `""`，由调用点判「取不到」。 */
function git(args, cwd = process.cwd()) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/**
 * 算出「哪些字符下标落在成对引号内部」。
 *
 * 引号可以跨行（实测：提交信息里的长引用折行写），所以输入是整个消息体、
 * 不是逐行。同一对引号出现嵌套时按「先开后闭」配对 —— 提交信息不是程序，
 * 够用且不会把配平算乱。
 *
 * @param {string} text
 * @returns {boolean[]} 与 text 等长，`true` = 该下标在引号内
 */
export function quotedMask(text) {
  const mask = new Array(text.length).fill(false);
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0;
    for (;;) {
      const a = text.indexOf(open, from);
      if (a < 0) break;
      const b = text.indexOf(close, a + open.length);
      if (b < 0) break;
      const end = Math.min(b + close.length - 1, text.length - 1);
      for (let i = a; i <= end; i++) mask[i] = true;
      from = b + close.length;
    }
  }
  return mask;
}

/**
 * 一句话里所有「§x.y …照旧保留」形态的声明。
 *
 * @param {string} text 整条提交信息
 * @returns {Array<{section: string, snippet: string}>}
 */
export function extractKeepClaims(text) {
  const mask = quotedMask(text);
  /** 句界：句末标点 + 换行。声明不会跨句（跨句那是两件事）。 */
  const claims = [];
  for (const sentence of splitSentences(text)) {
    if (!KEEP_CLAIM_RE.test(sentence.body)) continue;
    /** 「照旧保留」只能在**未被引用**的位置上 —— 引号里的是复述（口径 1）。 */
    const keepAt = findUnquoted(sentence.body, KEEP_CLAIM_RE, sentence.start, mask);
    if (keepAt < 0) continue;
    for (const m of sentence.body.matchAll(SECTION_RE)) {
      /* 章节号也必须在引号外（`「§13.6.3 …」` 整段都是复述）。 */
      if (mask[sentence.start + m.index] === true) continue;
      /* 章节号必须出现在「保留」之前，且不跨句 —— 同句后半句的 § 号不是它的宾语。 */
      if (m.index > keepAt) continue;
      /* 中间只许有章节量词与并列连词（口径 3：保留的宾语要是那一节，不是别的东西）。 */
      const between = sentence.body.slice(m.index + m[0].length, keepAt);
      if (!BETWEEN_ALLOW_RE.test(between)) continue;
      /* snippet 只取**声明附近那一小段**（压平折行后含 §号 与「保留」的窗口）——
       * 不给整句：实测致罪提交的那句是一条折了四行的列表项，整句打出来反而看不清
       * 「哪几个字是声明」（同 §11.23.1 那句「可见不等于被读」）。 */
      const flat = sentence.body.replace(/\s+/g, " ");
      const from = Math.max(0, m.index - 12);
      const to = Math.min(flat.length, keepAt + KEEP_CLAIM_RE.source.length + 20);
      claims.push({
        section: m[1],
        snippet: (from > 0 ? "…" : "") + flat.slice(from, to).trim(),
      });
    }
  }
  return claims;
}

/** 在 `text` 里找第一个**未被引号覆盖**的匹配（`mask` 与 `text` 同长）。 */
function findUnquoted(text, re, start, mask) {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(global)) {
    if (mask[start + m.index] !== true) return m.index;
  }
  return -1;
}

/** 按句末标点与换行切句，保留每句在原文里的起点下标（引号配平要按原文下标）。 */
function splitSentences(text) {
  const out = [];
  const BOUND = /[。；;！!？?]\s*|\n/;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const atEnd = i === text.length;
    const isBound = !atEnd && BOUND.test(text[i]);
    if (!atEnd && !isBound) continue;
    if (isBound && i + 1 < text.length && /\s/.test(text[i + 1])) continue;
    const body = text.slice(start, i + (isBound ? 1 : 0));
    if (body.trim() !== "") out.push({ body, start });
    start = i + 1;
  }
  return out;
}

/**
 * 在**某次提交的树**里找这个章节号 —— 逐份规范文档找 `^#+ <章节号>[ .]` 标题。
 *
 * 只看标题行、不看正文引用：正文里 `§13.6.2` 出现一百次也证明不了「这一节还在」
 * （立案现场那句反话针对的正是**整节**）。用树而不是工作区 —— 判的是「这次提交
 * 落下去的状态」，工作区里后来被人补回来了也不该改结论。
 *
 * @param {string} sha
 * @param {string} section
 * @returns {{found: boolean, files: string[]}}
 */
export function sectionInTree(sha, section) {
  /* `-c core.quotepath=false`：中文文件名默认会被 `ls-tree` 做八进制转义
   * （实测 `01-\346\236\266...`），于是 `git show <sha>:<转义名>` 取不到内容、
   * **每一节都判成「不在场」**—— 判据会对着任何提交报红，而读数看起来只是
   * 「这些章节都没了」。同族坑见 `check-ps1-consistency` 那类「静默地把中文当二进制」。 */
  const listing = git([
    "-c",
    "core.quotepath=false",
    "ls-tree",
    "--name-only",
    `${sha}:${DOCS_DIR}`,
  ]);
  if (listing === "") return { found: false, files: [] };
  const found = [];
  for (const name of listing.split("\n").map((s) => s.trim()).filter(Boolean)) {
    if (!name.endsWith(".md")) continue;
    const body = git(["show", `${sha}:${DOCS_DIR}/${name}`]);
    if (body === "") continue;
    const re = new RegExp(`^#+\\s*${section.replace(/\./g, "\\.")}(?:\\s|\\.|$|—|-)`, "m");
    if (re.test(body)) found.push(`${DOCS_DIR}/${name}`);
  }
  return { found: found.length > 0, files: found };
}

/**
 * 一次体检：给出「声明 ⇄ 树事实」的逐条结论。
 *
 * @param {string} sha
 * @returns {{ok: true, claims: Array<{section: string, snippet: string, found: boolean, files: string[]}>} | {ok: false, error: string}}
 */
export function checkCommit(sha) {
  if (!git(["rev-parse", "--git-dir"])) {
    return { ok: false, error: "当前目录不是 git 检出 —— 没有「某次提交的树」可核" };
  }
  const resolved = git(["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]).trim();
  if (resolved === "") {
    return { ok: false, error: `取不到提交 ${sha}（不在这个检出里 / 拼错了）` };
  }
  const message = git(["show", "-s", "--format=%B", resolved]);
  if (message === "") {
    return { ok: false, error: `读不到 ${sha} 的提交信息` };
  }
  const claims = extractKeepClaims(message).map((c) => {
    const { found, files } = sectionInTree(resolved, c.section);
    return { ...c, found, files };
  });
  return { ok: true, claims };
}

function main() {
  const argv = process.argv.slice(2);
  const reportOnly = argv.includes("--report");
  const positional = argv.filter((a) => !a.startsWith("--"));
  const sha = positional[0] || "HEAD";

  const result = checkCommit(sha);
  if (!result.ok) {
    console.error(`[commit-claims] ${result.error}`);
    process.exit(2);
  }
  const bad = result.claims.filter((c) => !c.found);
  if (reportOnly) {
    process.stdout.write(
      `[commit-claims] ${sha}：机械可核声明 ${result.claims.length} 条（相反 ${bad.length} 条）\n` +
        result.claims
          .map(
            (c) =>
              `  · §${c.section} ${c.found ? "在场" : "**树里不存在**"} —— ${c.snippet}`,
          )
          .join("\n") +
        "\n",
    );
    process.exit(0);
  }
  if (bad.length === 0) {
    process.stdout.write(
      `[commit-claims] ${sha}：${result.claims.length} 条机械可核声明与树一致\n`,
    );
    process.exit(0);
  }
  console.error(
    `[commit-claims] 声明与树事实相反 ${bad.length} 条（规范 §11.23.5）：\n` +
      bad
        .map(
          (c) =>
            `  · 信息里自称 §${c.section}「照旧保留」，而这次提交的树里**没有**这一节的标题\n` +
            `    ${c.snippet}`,
        )
        .join("\n") +
      "\n" +
      `[commit-claims] 要么这一节真的被回退了（去把它找回来），要么把这句声明改成事实。\n` +
      `[commit-claims] 别用 --no-verify 绕 —— 这条不在钩子里，它是事后盘点的那一档（§11.23.5）。\n`,
  );
  process.exit(1);
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  main();
}
