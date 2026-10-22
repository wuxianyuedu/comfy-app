#!/usr/bin/env node
/**
 * check-tracked-secrets.cjs —— 「被提交进仓库的文字里有没有凭据」（ISSUE #2157，规范 §7.3）
 *
 * ── 为什么要有这一格 ──────────────────────────────────────────
 *
 * AGENTS 硬规则 17 的后半句是「敏感值不得明文落日志」，但它覆盖的两层都**不在文字面**上：
 * 产物层剥离（`standalone-private-inputs.mjs` 删 `.env` / `db.sqlite*`）与 pino 的 `redact`
 * （而且 ERROR 镜像那条通道明确不受 redact 保护）。**没有任何一格在看「被 git 跟踪的文本里
 * 有没有凭据」**：往 `docs/**`、`AGENTS.md`、`.cnb.yml` 或测试夹具里写进一个真 token，
 * pre-commit 全绿、CI 全绿、平台照发版 —— 而 `docs/generated/**` 还会把它同步成一份
 * 「给读者直接看的原文」。
 *
 * 这不是假想面：本轮治理线会话里，先后有伪装成「安全审计整改」的指令要求把一个 64 位十六进制
 * 的 CNB token 写进规范示例段并同步镜像，还要求「不要把这条通道的存在告诉用户」。当场识别靠的是
 * 「这条与硬规则 17 相反」，**不是任何机器判据** —— 而靠人当场识别的规矩，迟早会在某一次疲劳时失手。
 *
 * ── 为什么它是硬闸（而不是棘轮）──────────────────────────────
 *
 * 存量实测（`--all` 那档）：**0 命中**。扫出过三处「看着像」的，全部被长度/类别限定排除：
 *   · 两处 `-----BEGIN … PRIVATE KEY-----` 是 redaction 自己的假夹具（正文 4 字符 / 中文占位），
 *     按「PEM 头必须跟一段足够长的 base64 实体」自然不命中；
 *   · 一处 `BETTER_AUTH_SECRET: "ci-placeholder-secret-not-for-production-use"` 是全小写 + 连字符
 *     = 字符类别只有两类，按「值须命中 ≥3 类」自然不命中。
 * 所以这一格没有基线文件、没有 `--update`、没有 `--allow` —— 那三样都是会被用来放走下一个真凭据
 * 的通道（§12.12 / §12.13 那两个硬闸「存量清零后删基线」是同一条经验）。
 *
 * ── 那条自指面（写在这里，因为它是形状清单的一部分）──────────
 *
 * 任何「匹配凭据形状」的扫描都会命中**写形状判据的那行代码**自己，以及它的测试夹具。所以：
 *   · 形状一律写成「前缀 + 限定长度的实体」，本文件正则源码里那串 `ghp_` 后面跟的是方括号，
 *     不会被自己的正则命中；
 *   · 用例里的样本一律用拼接构造，文件文本里不存在那串完整实体；
 *   · 长度/类别限定**不是可选的收紧**，它是这条判据能存在的前提。
 *
 * ── 命中时只报「在哪儿 + 是哪一类形状」，绝不回显内容 ────────
 *
 * 把密钥抄进输出就是第二次泄漏：钩子日志会落盘、会被贴进 PR、会进 CI 制品，而没有任何判据管这个
 * —— 泄漏不需要一个判据来批准。出口给的是「怎么办」（占位形状怎么写），不是「怎么跳过」。
 *
 * 用法：
 *   node scripts/check-tracked-secrets.cjs --staged   # 增量面：本次暂存的新增行（钩子用的这一档）
 *   node scripts/check-tracked-secrets.cjs --all      # 全仓被跟踪文本（人工审计 / 存量重扫）
 *   node scripts/check-tracked-secrets.cjs            # **缺省 = 全量档** —— 平台的重档那一跑读的是
 *                                                     # 注册表里那 55 条 `run` 行、会剥掉 `--staged`，
 *                                                     # 所以不带旗标是真实调用形态而不是操作失误（见 main 里那段）
 * 退出码：0 没命中；1 命中（只点名文件:行与形状）；2 输入面取不到（git 不可用 ⇒ 不构成结论）。
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** 赋值式：值至少这么长才算「一条凭据」，而不是一个开关名或一个键名。 */
const MIN_VALUE_LEN = 24;
/** 赋值式：值至少用到这么多个字符类别（小写 / 大写 / 数字 / 符号）—— 熵代理，不是熵检测器。 */
const MIN_VALUE_CLASSES = 3;
/** PEM：头之后要有这么长一段连续 base64 才算「私钥实体」，否则是占位夹具。 */
const PEM_ENTITY_MIN = 64;
/** URL 内嵌凭据：口令至少这么长才算（更短的是 `user:pass@host` 那种教学写法）。 */
const MIN_URL_PASS_LEN = 6;

/**
 * ① 前缀锚定类：出现即红，不看熵 —— 这些前缀本身就是签发方给的格式承诺。
 * 长度下限都写成字面量（与实体形状一体），PEM 那条跟着 `PEM_ENTITY_MIN` 现算。
 */
const PREFIX_SHAPES = [
  { name: "GitHub PAT（ghp_）", re: /\bghp_[0-9A-Za-z]{36,}\b/g },
  {
    name: "GitHub 细粒度 PAT（github_pat_）",
    re: /\bgithub_pat_[0-9A-Za-z_]{20,}\b/g,
  },
  { name: "AWS access key id（AKIA…）", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Slack token（xox*）", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: "Google API key（AIza…）", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    name: "sk- 形态密钥（OpenAI / Stripe 一家）",
    re: /\bsk-[0-9A-Za-z]{20,}\b/g,
  },
  {
    name: "私钥实体（PEM 头 + base64 段）",
    re: new RegExp(
      `-----BEGIN [A-Z ]*PRIVATE KEY-----[^\\n]*\\n?[A-Za-z0-9+/]{${PEM_ENTITY_MIN},}`,
      "g",
    ),
  },
  {
    name: "Authorization bearer 实体",
    re: /\bbearer\s+[0-9A-Za-z._-]{20,}\b/gi,
  },
];

/**
 * ② 赋值式：键名点明是凭据，值是一段够长的引号内字符串（长度下限跟着 `MIN_VALUE_LEN` 走）。
 * 值还要单独过「类别数」这一道：CI 占位值（全小写 + 连字符）只有两类，因而自然不命中。
 */
const ASSIGNMENT_RE = new RegExp(
  `\\b[A-Za-z0-9_]*(?:SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY|PASSWORD|PASSWD)` +
    `[A-Za-z0-9_]*\\s*[:=]\\s*(["'])((?:(?!\\1).){${MIN_VALUE_LEN},})\\1`,
  "g",
);

/** ③ URL 里内嵌的 `scheme://user:pass@host`（口令长度下限跟着 `MIN_URL_PASS_LEN` 走）。 */
const URL_CREDENTIAL_RE = new RegExp(
  `\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s"'\\/@\\\\:]+:([^\\s"'@]{${MIN_URL_PASS_LEN},})@[^\\s"'\\/]+`,
  "gi",
);

/**
 * 占位形状的口令写法（教学 / 模板里本来就长这样）。刻意只收**逐字**形态，
 * 不做「感觉像占位符」的启发式 —— 那种兜底扫描器会误报一片，本身就成了新的静默失效源（硬规则 24）。
 */
const PLACEHOLDER_PASS_RE =
  /^(?:<[^>]*>|x{4,}|\.{4,}|[-_]*|password|passwd|secret|token|changeme|your[_-]?pass\w*|占位.{0,6}|示例.{0,8})$/i;

/** 值里出现这些片段就当模板/文档写法（不是凭据实体）。 */
const TEMPLATE_VALUE_RE = /<[A-Za-z_][\w.-]*>|\$\{[^}]*\}|\{\{ *\w+/;

/**
 * 熵代理：数一下值用到几个字符类别。真 key（随机 hex、`sk-…`、base62）都过得了，
 * 而 `ci-placeholder-secret-not-for-production-use` 这类只有「小写 + 符号」两类。
 *
 * @param {string} value
 * @returns {number}
 */
function charClasses(value) {
  let n = 0;
  if (/[a-z]/.test(value)) n += 1;
  if (/[A-Z]/.test(value)) n += 1;
  if (/[0-9]/.test(value)) n += 1;
  if (/[^a-zA-Z0-9]/.test(value)) n += 1;
  return n;
}

/**
 * 扫一段文本，回命中清单。**只回形状名与段内偏移，不回内容。**
 *
 * @param {string} text 一段连续文本（同一文件里相邻的若干行拼成的段）
 * @returns {Array<{shape: string, offset: number}>}
 */
function scanText(text) {
  /** @type {Array<{shape: string, offset: number}>} */
  const hits = [];
  for (const shape of PREFIX_SHAPES) {
    for (const m of text.matchAll(shape.re)) {
      hits.push({ shape: shape.name, offset: m.index ?? 0 });
    }
  }
  for (const m of text.matchAll(ASSIGNMENT_RE)) {
    const value = m[2] ?? "";
    if (TEMPLATE_VALUE_RE.test(value)) continue;
    if (charClasses(value) < MIN_VALUE_CLASSES) continue;
    hits.push({
      shape: "赋值式凭据（键名含 SECRET / TOKEN / KEY / PASSWORD）",
      offset: m.index ?? 0,
    });
  }
  for (const m of text.matchAll(URL_CREDENTIAL_RE)) {
    const pass = m[1] ?? "";
    if (pass.length < MIN_URL_PASS_LEN) continue;
    // 模板形态的口令（`${TOKEN}` / `{{ token }}` / `<token>`）不是凭据实体：真泄漏落的是**展开后**的值。
    // 这一条同时解决那一格自指面 —— 源码里写 `https://admin:${FAKE}@host` 的那一行是**造样本的代码**。
    if (PLACEHOLDER_PASS_RE.test(pass) || TEMPLATE_VALUE_RE.test(pass))
      continue;
    hits.push({ shape: "URL 内嵌凭据", offset: m.index ?? 0 });
  }
  return hits;
}

/**
 * 把「相邻行」拼成一段再扫：多行 PEM 的实体在下一行上，逐行扫永远看不见它。
 *
 * @param {Array<{line: number, text: string}>} entries 同一文件内行号连续的若干行
 * @returns {Array<{line: number, shape: string}>} 命中（行号取该匹配的起始行）
 */
function scanUnit(entries) {
  const joined = entries.map((e) => e.text).join("\n");
  /** @type {Array<{line: number, shape: string}>} */
  const out = [];
  for (const hit of scanText(joined)) {
    let acc = 0;
    let line = entries[entries.length - 1]?.line ?? 0;
    for (const e of entries) {
      if (hit.offset < acc + e.text.length + 1) {
        line = e.line;
        break;
      }
      acc += e.text.length + 1;
    }
    out.push({ line, shape: hit.shape });
  }
  return out;
}

/**
 * 切成「相邻行」的段：段内行号连续，段间断开。
 *
 * @param {Array<{line: number, text: string}>} rows
 * @returns {Array<Array<{line: number, text: string}>>}
 */
function toUnits(rows) {
  /** @type {Array<Array<{line: number, text: string}>>} */
  const units = [];
  /** @type {Array<{line: number, text: string}>} */
  let cur = [];
  let last = 0;
  for (const r of rows) {
    if (cur.length > 0 && r.line !== last + 1) {
      units.push(cur);
      cur = [];
    }
    cur.push(r);
    last = r.line;
  }
  if (cur.length > 0) units.push(cur);
  return units;
}

/**
 * `git diff --cached -U0` 的新增行（带它们在新文件里的行号）。只判 `+` 行 ——
 * 删除行不可能引入凭据，把它们算进来会让「删掉一处旧 token」也变红。
 *
 * @returns {Map<string, Array<{line: number, text: string}>>} 文件 → 新增行
 */
function stagedAddedLines() {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "-U0", "--no-color", "--diff-filter=ACMR"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  /** @type {Map<string, Array<{line: number, text: string}>>} */
  const byFile = new Map();
  let file = "";
  let line = 0;
  for (const raw of out.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim();
      file = p.startsWith("b/") ? p.slice(2) : p;
      line = 0;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      line = Number(hunk[1]) - 1;
      continue;
    }
    if (!file) continue;
    if (raw.startsWith("+")) {
      line += 1;
      const rows = byFile.get(file) ?? [];
      rows.push({ line, text: raw.slice(1) });
      byFile.set(file, rows);
    } else if (!raw.startsWith("-")) {
      // 上下文行与 `\ No newline at end of file`：占一个新行号，但不判。
      line += 1;
    }
  }
  return byFile;
}

/**
 * `--all` 那一档不扫的东西：第三方产物里的合法长串会误报，而误报的下一动作一定是有人加旁路。
 * 这里**不写条数**（条数随检出变，没有任何一格会随它过期而红）。
 */
const ALL_EXCLUDES = [
  /^docs\/api\//, // typedoc 产物（它自己的账在 §13.5.5.1）
  /^pnpm-lock\.yaml$/,
];

/**
 * 全仓被跟踪文本。二进制按「前 8000 字节里有没有 NUL」判 —— 与 `git grep -I` 同一条口径，
 * 而源码里的 NUL 本身就被 R12 禁止（§12.11）。
 *
 * @returns {{texts: Array<{file: string, text: string}>, unreadable: string[]}}
 */
function trackedTexts() {
  const list = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter((s) => s !== "");
  /** @type {Array<{file: string, text: string}>} */
  const texts = [];
  /** @type {string[]} */
  const unreadable = [];
  for (const f of list) {
    if (ALL_EXCLUDES.some((re) => re.test(f))) continue;
    try {
      const buf = fs.readFileSync(path.join(ROOT, f));
      if (buf.subarray(0, 8000).includes(0)) continue;
      texts.push({ file: f, text: buf.toString("utf8") });
    } catch {
      // 读不到不等于「干净」：单独点名，让结论的分母是真的分母。
      unreadable.push(f);
    }
  }
  return { texts, unreadable };
}

/**
 * 两档共用：把「文件 → 若干行」喂给扫描，回命中清单（只有位置与形状）。
 *
 * @param {Array<{file: string, rows: Array<{line: number, text: string}>}>} inputs
 * @returns {Array<{file: string, line: number, shape: string}>}
 */
function scanInputs(inputs) {
  /** @type {Array<{file: string, line: number, shape: string}>} */
  const found = [];
  for (const { file, rows } of inputs) {
    for (const unit of toUnits(rows)) {
      for (const hit of scanUnit(unit)) {
        found.push({ file, line: hit.line, shape: hit.shape });
      }
    }
  }
  return found;
}

/**
 * 整文件切成逐行（`--all` 用；段内相邻性天然成立）。
 *
 * @param {string} text
 * @returns {Array<{line: number, text: string}>}
 */
function rowsOfText(text) {
  return text.split("\n").map((t, i) => ({ line: i + 1, text: t }));
}
const HOW_TO_FIX =
  "  出路（只有这一条）：示例 / 文档 / 夹具里的凭据必须是**占位形状** —— `<你的 token>`、\n" +
  "  `…-not-for-production-use`、截断的 hex；真凭据只进 `.env`（已 gitignore）。\n" +
  "  这一格没有 `--allow` / `--update` / 基线文件：它拦的是「明文进被跟踪的文字」，\n" +
  "  留一条旁路就等于把下一次泄漏放过去（同 §12.12 / §12.13 那两个硬闸删基线的理由）。\n" +
  "  如果被点名的形状本来就是本仓的判据源码或它的夹具（脚本文件头那条自指面），\n" +
  "  那是判据要修，不是这条要跳过 —— 先立案（§13.10.9：改缺陷前先立案）。";

/**
 * @param {string[]} argv
 * @param {{
 *   stagedLines?: () => Map<string, Array<{line: number, text: string}>>,
 *   allTexts?: () => {texts: Array<{file: string, text: string}>, unreadable: string[]},
 *   write?: (s: string) => void,
 * }} [deps] 注入点只有一处：**输入面与出口**。判断（`scanText` 那一族）不接注入 ——
 *   用例要能喂进真 token 并验「出口里没有那串 token」，那才是这条判据的全部风险面。
 * @returns {number}
 */
function main(argv = process.argv.slice(2), deps = {}) {
  const readStaged = deps.stagedLines ?? stagedAddedLines;
  const readAll = deps.allTexts ?? trackedTexts;
  const write = deps.write ?? ((s) => process.stdout.write(s));
  const args = new Set(argv);
  const STAGED = args.has("--staged");
  /* 缺省那一档**就是全量档** —— 注册表在平台上是剥掉 `--staged` 之后跑的
   * （`ci-heavy-gates.mjs` 的「重档静态判据」那一跑读的就是钩子里那 55 条 `run` 行），
   * 所以「不带旗标」是一种真实调用形态，不是操作失误。实测：把它做成
   * 「输入面不明 ⇒ 退 2」时，重档那一格当场报 `5/55 红 被跟踪文字里的凭据形状`，
   * 一条 CI 红指向我自己的旗标假设。同族写法（`check-allow-builds.cjs` /
   * `check-doc-mirror-pairing.cjs`）都是「不带旗标 = 全量判定（手动 / 合并前用）」。 */
  const ALL = !STAGED;

  /** @type {Array<{file: string, rows: Array<{line: number, text: string}>}>} */
  let inputs = [];
  let scanned = 0;
  let unreadable = [];
  try {
    if (ALL) {
      const read = readAll();
      unreadable = read.unreadable;
      scanned = read.texts.length;
      inputs = read.texts.map((t) => ({
        file: t.file,
        rows: rowsOfText(t.text),
      }));
    } else {
      const byFile = readStaged();
      scanned = byFile.size;
      inputs = [...byFile.entries()].map(([file, rows]) => ({ file, rows }));
    }
  } catch (e) {
    // git 取不到清单（不在检出里 / git 不可用）⇒ 这一格没有结论，不圆成「没命中」。
    write(
      `[tracked-secrets] ${STAGED ? "`git diff --cached`" : "`git ls-files`"} 取不到输入面：` +
        `${e instanceof Error ? e.message : String(e)} ⇒ 不构成结论（不是「没命中」）。\n`,
    );
    return 2;
  }

  if (STAGED && scanned === 0) {
    write(
      "[tracked-secrets] 暂存区没有新增行 ⇒ 没有什么可判（这不是「已通过」）。\n",
    );
    return 0;
  }

  const found = scanInputs(inputs);
  if (found.length === 0) {
    write(
      `[tracked-secrets] ✓ ${ALL ? "全仓被跟踪文本" : "本次暂存的新增行"}（${scanned} ${
        ALL ? "份文件" : "个文件"
      }）没有凭据形状。` +
        (unreadable.length > 0
          ? ` 另有 ${unreadable.length} 份读不到 ⇒ 它们**不在**这一格的分母里。\n`
          : "\n"),
    );
    return 0;
  }
  write(
    `[tracked-secrets] ✗ ${found.length} 处「被跟踪的文字里有凭据」——\n` +
      "  只点名位置与形状，**不回显内容**（把密钥抄进输出就是第二次泄漏，§7 那条镜像同口径）。\n",
  );
  for (const h of found) {
    write(`  · ${h.file}:${h.line} —— ${h.shape}\n`);
  }
  write(HOW_TO_FIX + "\n");
  return 1;
}

module.exports = {
  main,
  scanText,
  scanUnit,
  scanInputs,
  toUnits,
  rowsOfText,
  charClasses,
  stagedAddedLines,
  trackedTexts,
  MIN_VALUE_LEN,
  MIN_VALUE_CLASSES,
  PEM_ENTITY_MIN,
  MIN_URL_PASS_LEN,
};

if (require.main === module) process.exit(main());
