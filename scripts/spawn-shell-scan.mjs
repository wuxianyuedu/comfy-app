#!/usr/bin/env node
/**
 * spawn-shell-scan.mjs — 守「**起子进程不许开 shell**」这一条（ISSUE #2453 / #2445）。
 *
 * ── 为什么要有这个脚本 ────────────────────────────────────────────────────
 *
 * `node_modules/.bin/<工具>` 是给宿主 shell 用的垫片，Node 直起它 `EINVAL` ⇒ 于是有人
 * 给 `spawn` / `spawnSync` 加一句 `shell: true`。那一条同时带来两件事：
 *
 *   ① Node 26 把它标成 **DEP0190** 弃用（「args 数组 + 开 shell」）；
 *   ② 开了 shell 之后 Node **不给参数转义**，含空格的路径要自己括引号 ——
 *      括漏了就是「换台机器跑不起来」，而它不报错、只是 quietly 跑错。
 *
 * ISSUE #2445 修掉了 typedoc 那一处（改成 `spawn(process.execPath, [包真身入口, …])`），
 * 而**第二处**（`scripts/storybook.mjs`）是靠 grep 肉眼找到的 —— 这正说明缺一条判据：
 * 「第三处还会长出来」这件事，靠人记得不如靠机器念。
 *
 * ── 它判什么（ISSUE #2513 把面收在调用点上）───────────────────────────────
 *
 * `scripts/**` 下的 `.mjs` / `.cjs` 里，**剥掉注释、并在实参里跳过字符串内容之后**，
 * `spawn` / `spawnSync` / `exec` / `execFile` / `execFileSync` / `fork` 这几类调用的
 * **实参中的对象字面量**，不许带「不是明确不开」的 `shell` 属性（哪几种取值算「明确不开」
 * 见下方 `SHELL_OPTION_RE`）。只判这个对象的**顶层键** —— 嵌在它里面的同名键（比如
 * `{ env: { shell: … } }`）不是 spawn 的选项，不判。
 *
 * 为什么收在调用点上（#2513 的现场）：第一版按**行的字面形态**认（任意 `shell:` 键），
 * 于是 `ci-cache-slot.mjs` 里一个跟子进程毫无关系的读数字段就能让 PR 红在「受影响用例」，
 * 而红指向的那一行里没有任何 `spawn` —— 读的人要绕一圈才明白那是判据的误报，而误报教会
 * 人的第一件事就是给判据加白名单。
 *
 * 收窄的代价写在明处：**间接形态看不见** —— `const opts = { shell: needsShell(cmd) };
 * spawn(c, a, opts)` 里那个字面量不追（要追它就得回到「全文件任意 `shell:` 键」那一档，
 * 正是这条单要收掉的东西）。同理 `cp.spawn(...)` / `child_process.execFile(...)` 这类
 * **成员调用**不认（`re.exec(...)` 是正则，与子进程无关，两边的文本形状分不开）。
 *
 * 剥注释这一步不是可选的：仓里有四份文件在**注释里**写着「不要开 shell / 开 shell
 * 是错的形态」（`hook-steps` / `ci-install-deps` / `e2e-run` / `ship-exec`）—— 不剥就会把
 * 「正在教人别这么写」的那一句判成违例，而那会让人学会的第一件事就是给判据加白名单。
 *
 * 刻意**不做**的事：
 *   · 不判「该不该起这个进程」（那是各调用方的事）；
 *   · 不做 AST（括号配平 + 跳过字符串对本仓这批扁平的选项对象足够，而 AST 会把这份判据
 *     钉在某个 parser 版本上）；
 *   · 不扫 `src/**`（那一侧的进程动作归硬规则 3 的 `kill-process-tree` 那一族，另有判据）。
 *
 * 用法：
 *   node scripts/spawn-shell-scan.mjs            # 人读报告，有违例即非零退出
 *   node scripts/spawn-shell-scan.mjs --json     # 机器读（供契约测试）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/* 剥注释**不自己写**（§12.18）：唯一实现是 `tests/helpers/strip-comments.ts`，
 * `tests/strip-comments-single-source.test.ts` 那条台账按「文件里有没有那段本地定义」
 * 判 —— **连在注释里原样复述那段定义都会命中**（本文件第一版就是这么红的）。
 * 它剥块注释与整行 `//`，再加 `trailing: true` 连行尾注释一起剥：对本判据够用 ——
 * 违例只可能写在**代码**里，而注释里那几处「开 shell 是错的形态」正是要被剥掉的
 * （不剥就是自打自：把正在教人别这么写的那句话判成违例）。
 * 代价与边界：这份脚本因此依赖 Node 的类型剥离（直接 import `.ts`，
 * `package.json` 的 `engines` 三档都在默认开启的那一档上）。 */
import { stripComments } from "../tests/helpers/strip-comments.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 违例形状：`shell:` 且值**不是**「明确不开」的那几种。
 *
 * 为什么排除 `shell: false` / `null` / `undefined` / 字符串值：
 *   · `shell: false` 是**显式**关掉（本仓 `launcher-core/shell.mjs` 有四处这么写），
 *     它不是弃用形态，判它就是把「写清楚的人」和「没写的人」一起罚；
 *   · 字符串值（`undefined` 之外的任何字符串）不是布尔开关，写它的人没在开 shell。
 * 于是留下来的正是要拦的那三种：`shell: true`、`shell: process.platform === "win32"`、
 * `shell: needsShell(cmd)`。
 */
/* ⚠️ 空白要在**预查里面**（`\s*` 放在预查前面时，正则会回溯到「不吃空白」那一步，
 * 于是 `(?!false)` 永远成立 —— 那是一句**什么都不排**的排除，写它的人以为排掉了）。
 * 把 `\s*` 挪进预查之后，`shell: false` 才会真的被排掉。 */
const SHELL_OPTION_RE = /\bshell\s*:(?!\s*(?:false\b|null\b|undefined\b|["'`]))/;

/* 起子进程的那几个调用，且必须是**裸标识符**：前面有 `.` / 标识符字符就不认 ——
 * 那一格是 `re.exec(...)` 与 `cp.spawn(...)`，前者是正则、后者是本判据刻意不追的
 * 成员调用形态（见文件头「收窄的代价」）。 */
const SPAWN_CALLEE_SOURCE =
  "(?<![\\w$.])(?:spawnSync|spawn|execFileSync|execFile|exec|fork)\\s*\\(";

/**
 * 从调用处的 `(` 起按**顶层逗号**切实参区间。
 *
 * 引号（含模板串）里的逗号与括号都不算；括号不配平就返回 null —— 判不了的不猜。
 *
 * @param {string} src 已剥注释的源码
 * @param {number} open `(` 的下标
 * @returns {Array<{start: number, end: number}> | null}
 */
function argumentSpans(src, open) {
  /** @type {Array<{start: number, end: number}>} */
  const spans = [];
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  let start = open + 1;
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) {
        if (ch !== ")") return null;
        spans.push({ start, end: i });
        return spans;
      }
      depth -= 1;
      continue;
    }
    if (ch === "," && depth === 0) {
      spans.push({ start, end: i });
      start = i + 1;
    }
  }
  return null;
}

/**
 * 把字符串 / 模板串的**内容**换成空格（引号与换行留着）。
 *
 * 两个用途：① 值里的 `shell:` 是**字符串内容**，不是选项键（`{ cwd: "shell: true" }`
 * 不该被判）；② 保留长度 ⇒ 匹配位置与原文一一对应，行号不用另算。
 *
 * @param {string} text
 * @returns {string}
 */
function maskStringContents(text) {
  let out = "";
  /** @type {string | null} */
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote === null) {
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      out += ch;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1];
      out += ch + (next === undefined ? "" : next === "\n" ? "\n" : " ");
      if (next !== undefined) i += 1;
      continue;
    }
    if (ch === quote) {
      quote = null;
      out += ch;
      continue;
    }
    out += ch === "\n" ? "\n" : " ";
  }
  return out;
}

/**
 * 某个下标处的括号深度（字符串内容已被抹掉，所以直接数就够了）。
 *
 * @param {string} masked 已抹掉字符串内容的文本
 * @param {number} index
 * @returns {number}
 */
function depthAt(masked, index) {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const ch = masked[i];
    if (ch === "{" || ch === "(" || ch === "[") depth += 1;
    else if (ch === "}" || ch === ")" || ch === "]") depth -= 1;
  }
  return depth;
}

/**
 * 扫一段源码（调用方负责先剥注释），给出违例。
 *
 * @param {string} src 已剥注释的源码
 * @param {string} [rel] 报告里用的文件名
 * @returns {string[]} `文件:行号: 原文` 形态
 */
export function findShellOptionsIn(src, rel = "(inline)") {
  /** @type {Set<string>} */
  const offenders = new Set();
  const lines = src.split("\n");
  const lineOf = (/** @type {number} */ index) =>
    src.slice(0, index).split("\n").length;
  for (const call of src.matchAll(new RegExp(SPAWN_CALLEE_SOURCE, "g"))) {
    const open = (call.index ?? 0) + call[0].length - 1;
    const spans = argumentSpans(src, open);
    if (spans === null) continue;
    for (const span of spans) {
      const text = src.slice(span.start, span.end);
      const trimmed = text.trim();
      /* 只有**对象字面量**才是选项对象：字符串 / 数组 / 变量 / 回调都不是本判据的面 */
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
      const masked = maskStringContents(text);
      for (const m of masked.matchAll(new RegExp(SHELL_OPTION_RE.source, "g"))) {
        /* 深度 1 = 选项对象的顶层键。嵌套对象里的同名键不是 spawn 的选项不判；
         * 深度 0 是字面量之前（不可能命中，留着当防御）。 */
        if (depthAt(masked, m.index ?? 0) !== 1) continue;
        const line = lineOf(span.start + (m.index ?? 0));
        offenders.add(`${rel}:${line}: ${(lines[line - 1] ?? "").trim()}`);
      }
    }
  }
  return [...offenders];
}

/**
 * 递归收集 `scripts/**` 下的 .mjs / .cjs（跳过 node_modules）。
 *
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collect(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules") continue;
      collect(full, out);
      continue;
    }
    if (name.endsWith(".mjs") || name.endsWith(".cjs")) out.push(full);
  }
  return out;
}

/**
 * 扫一遍，给出违例清单。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]} `文件:行号: 原文` 形态
 */
export function findShellOptions(root = ROOT) {
  /** @type {string[]} */
  const offenders = [];
  for (const file of collect(path.join(root, "scripts"))) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    /* `trailing: true`：默认档只去整行注释，会把 `const a = 1; // 别写 shell: true`
     * 这种**行尾**注释留着 ⇒ 判据红在一段正在教人别这么写的注释上（自打自）。 */
    const stripped = stripComments(fs.readFileSync(file, "utf8"), {
      trailing: true,
    });
    offenders.push(...findShellOptionsIn(stripped, rel));
  }
  return offenders;
}

/* 直接执行时给人读的报告（`node scripts/spawn-shell-scan.mjs`）。 */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const offenders = findShellOptions();
  if (offenders.length > 0) {
    process.stderr.write(
      "[spawn-shell-scan] scripts/** 出现「起子进程开 shell」的形态" +
        "（Node 26 的 DEP0190，且开了 shell 参数要自己括引号）—— 改用" +
        "`spawn(process.execPath, [resolvePackageBinEntry(pkg), …])` 直起包真身：\n",
    );
    for (const o of offenders) process.stderr.write(`  ${o}\n`);
    process.exit(1);
  }
  const msg = "[spawn-shell-scan] OK：scripts/** 里没有开 shell 起子进程的形态";
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: true, offenders: [] }));
  } else {
    process.stdout.write(msg + "\n");
  }
}
