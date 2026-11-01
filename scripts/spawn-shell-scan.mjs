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
 * ── 它判什么（ISSUE #2513 把面收在调用点上；ISSUE #2562 扩规则与覆盖面）──────
 *
 * `scripts/` / `tools/` / `.storybook/` / `e2e/` 下的 `.mjs` `.cjs` `.ts` `.tsx` `.jsx` 里，
 * **剥掉注释、并在实参里跳过字符串内容之后**，收三类「起子进程走 shell」的形态：
 *
 *   ① `spawn` / `spawnSync` / `exec` / `execFile` / `execFileSync` / `fork` 的**实参对象字面量**
 *      里出现 `shell` 属性，且值**不是明确不开**（只排 `false` / `null` / `undefined`，
 *      见 `SHELL_OPTION_RE`）。只判**顶层键** —— 嵌在里面的同名键（如 `{ env: { shell: … } }`）
 *      不是 spawn 的选项，不判。**truthy 字符串值算违例**：`shell: 'cmd.exe'` /
 *      `shell: process.env.ComSpec` 这类（Node 拿到字符串是「拿它当 shell 可执行文件」，
 *      仍然开 shell，旧版误当「不是布尔开关」放过，正是 #2562 的盲区）。
 *   ② `exec` / `execSync` 裸调用 —— 它们**天然走 shell**（没有 `shell: false` 这一说），
 *      调用点里一个 `shell` 字样都不会出现，按字面量扫描永远看不见；单独一条规则收。
 *      （`execFile` / `execFileSync` 默认不走 shell，不在这里一棍打死，留给 ① 的选项规则。）
 *   ③ **反向信号**（#2562 缺口 3）：`spawn` / `spawnSync` / `fork` 的**命令参数**里出现
 *      `.cmd` / `.bat` —— 这是「为修 EINVAL 而加 `shell: true`」的前一步，源头收掉，
 *      改走 `spawn(process.execPath, [resolvePackageBinEntry(pkg), …])` 直起包真身。
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
 *   · 不扫 `src/**`（那一侧的进程动作归硬规则 3 的 `kill-process-tree` 那一族，另有判据）；
 *   · 不追运行时拼出来的 `.cmd`/`.bat` 命令（如 `path.join(dir, "pnpm" + ".cmd")`，
 *     与整份脚本「不 AST」的取向一致 —— 那是判据的已知边界，静态面里它看不见）。
 *
 * 用法：
 *   node scripts/spawn-shell-scan.mjs                  # 人读报告，有违例即非零退出
 *   node scripts/spawn-shell-scan.mjs --root <dir>     # 阳性对照：扫指定根（canary 用）
 *   node scripts/spawn-shell-scan.mjs --json           # 机器读（供契约测试）
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/* 剥注释**不自己写**（§12.18）：唯一实现是 `tests/helpers/strip-comments.ts`，
 * `tests/strip-comments-single-source.test.ts` 那条台账按「文件里有没有那段本地定义」
 * 判 —— **连在注释里原样复述那段定义都会命中**（本文件第一版就是这么红的）。
 * 它剥块注释与整行 `//`，再加 `trailing: true` 连行尾注释一起剥：对本判据够用 ——
 * 违例只可能写在**代码**里，而注释里那几处「开 shell 是错的形态」正是要被剥掉的
 * （不剥就是自打自：把正在教人别这么写的那句话判成违例）。
 * 代价与边界：这份脚本因此依赖 Node 的类型剥离（直接 import `.ts`，
 * `package.json` 的 `engines` 三档都在默认开启的那一档上）。 */
import { stripComments } from "../tests/helpers/strip-comments.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

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
 * 把 `\s*` 挪进预查之后，`shell: false` 才会真的被排掉。
 *
 * 排除项**只留 `false` / `null` / `undefined` 这三种**（它们都是「明确不开」），
 * 一律**不排字符串值** —— 见 ISSUE #2562：旧版把任意字符串值都当成「不是布尔开关」
 * 放过，于是 `shell: 'cmd.exe'` / `shell: process.env.ComSpec` 这类 **truthy 字符串**
 * 漏了（Node 拿到字符串值是「拿它当 shell 可执行文件」，**仍然开 shell**）。
 * 改动后这些都算违例；`shell: "shell"` 这种恰好与字段同名的字符串也一并被收
 * （在 spawn 选项对象里它就是「用名叫 shell 的程序当 shell」，truthy ⇒ 开 shell）。 */
const SHELL_OPTION_RE = /\bshell\s*:(?!\s*(?:false\b|null\b|undefined\b))/;

/* 起子进程的那几个调用，且必须是**裸标识符**：前面有 `.` / 标识符字符就不认 ——
 * 那一格是 `re.exec(...)` 与 `cp.spawn(...)`，前者是正则、后者是本判据刻意不追的
 * 成员调用形态（见文件头「收窄的代价」）。 */
const SPAWN_CALLEE_SOURCE = String.raw`(?<![\w$.])(?:spawnSync|spawn|execFileSync|execFile|exec|fork)\s*\(`;

/* `exec` / `execSync` **天然走 shell**（没有 `shell: false` 这一说）—— 这正是
 * ISSUE #2562 的盲区：它们的调用点里**一个 `shell` 字样都不会出现**，按字面量扫描
 * 永远看不见。单独一条规则收。但**只认从 `node:child_process` import 出来的那一个**：
 * 仓内有 `const exec = …`（局部函数，如 `ci-cp936-exit.mjs` 的转码入口）和注入的
 * `exec` 端口（如 `ci-toolchain-browser.mjs` 的 `exec` 形参），裸 `exec(` 一律算违例
 * 会把它们一并红掉 —— 那正是「误报教会人加白名单」的那一档。所以先抠 import
 * 名单，只有文件真的 `import { exec } from "node:child_process"` 才判（见
 * `childProcessImports`）。`.exec(` 这种成员调用被负向预查排掉；`execFile` /
 * `execFileSync` 默认不走 shell，不在这里一棍打死，留给上面的 `shell:` 选项规则。 */
const EXEC_CALLEE_RE = /(?<![\\w$.])(?:execSync|exec)\s*\(/;

/* 反向信号（ISSUE #2562 缺口 3）：spawn / spawnSync / fork 的**命令参数**是一个
 * 「以 `.cmd` / `.bat` 结尾的引号字面量」—— 这正是「为了修 EINVAL 而加上 `shell: true`」
 * 的前一步。命中它 = 这一处将来会被「合规地」加上 shell 修好，所以直接在源头收掉：
 * 走 `spawn(process.execPath, [resolvePackageBinEntry(pkg), …])` 直起包真身。
 * 必须整段就是一个引号字面量（不是运行时 `path.join(dir, "pnpm" + ".cmd")` 那种拼接 ——
 * 那条是判据已知的静态边界，本仓「不 AST」的取向一致），且**不脱敏**原文（脱敏会把
 * `.cmd` 抹成空格，判据就看不见了）。 */
const ARG_LITERAL_CMD_RE = /^["'`][^"'`]*\.(?:cmd|bat)\b["'`]$/i;

/**
 * 一个文件从 `node:child_process` 里 import 了哪些名字（用于精确判定 `exec`/`execSync`
 * 是不是真的 child_process，而不是局部函数 / 注入端口）。
 *
 * @param {string} src 已剥注释的源码
 * @returns {Set<string>}
 */
function childProcessImports(src) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']/g)) {
    /* 类型上 `m[1]` 是 `string | undefined`（TS 不认必需分组），运行时必定是 string。 */
    for (const part of (m[1] ?? "").split(",")) {
      const name = (part.trim().split(/\s+as\s+/)[0] ?? "").trim();
      if (name) {
        names.add(name);
      }
    }
  }
  return names;
}

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
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
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
        if (ch !== ")") {
          return null;
        }
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
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      }
      out += ch;
      continue;
    }
    if (ch === "\\") {
      /* `text[i + 1]` 的静态类型是 `string`（`noUncheckedIndexedAccess` 不看字符串索引），
       * 而**串尾的孤立反斜杠**确实没有下一个字符 —— 这里按真值判，不按 `undefined` 判：
       * 空字符与「没有下一个字符」在下面的归约里给出同一个结果（都折成 ""）。 */
      const next = /** @type {string | undefined} */ (text[i + 1]);
      out += ch + (next ? (next === "\n" ? "\n" : " ") : "");
      if (next) {
        i += 1;
      }
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
    if (ch === "{" || ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === ")" || ch === "]") {
      depth -= 1;
    }
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
  const lineOf = (/** @type {number} */ index) => src.slice(0, index).split("\n").length;
  /* `exec` / `execSync` 只认 child_process 那一个（见 `childProcessImports` 头注）：
   * 局部函数 / 注入端口同名不算。 */
  const cpNames = childProcessImports(src);
  for (const call of src.matchAll(new RegExp(SPAWN_CALLEE_SOURCE, "g"))) {
    const open = call.index + call[0].length - 1;
    const spans = argumentSpans(src, open);
    if (spans === null) {
      continue;
    }
    for (const span of spans) {
      const text = src.slice(span.start, span.end);
      const trimmed = text.trim();
      /* 反向信号（缺口 3）：命令参数是一个「以 .cmd/.bat 结尾的引号字面量」—— 这是
       * 「为修 EINVAL 而加 shell: true」的前一步，源头收掉。不脱敏（否则 .cmd 被抹掉）。 */
      const rawArg = text.trim();
      if (ARG_LITERAL_CMD_RE.test(rawArg)) {
        const line = lineOf(span.start);
        offenders.add(
          `${rel}:${line}: ${(lines[line - 1] ?? "").trim()} ` +
            `（命令参数带 .cmd/.bat ⇒ 直接起会 EINVAL，应走 resolvePackageBinEntry 直起包真身）`,
        );
      }
      /* 只有**对象字面量**才是选项对象：字符串 / 数组 / 变量 / 回调都不是本判据的面 */
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        continue;
      }
      const masked = maskStringContents(text);
      for (const m of masked.matchAll(new RegExp(SHELL_OPTION_RE.source, "g"))) {
        /* 深度 1 = 选项对象的顶层键。嵌套对象里的同名键不是 spawn 的选项不判；
         * 深度 0 是字面量之前（不可能命中，留着当防御）。 */
        if (depthAt(masked, m.index) !== 1) {
          continue;
        }
        const line = lineOf(span.start + m.index);
        offenders.add(`${rel}:${line}: ${(lines[line - 1] ?? "").trim()}`);
      }
    }
  }
  /* `exec` / `execSync` **天然走 shell**：调用点里一个 `shell` 字样都不会出现，按字面量
   * 扫描永远看不见（缺口 2）。这里单独收，但只认 child_process 那个绑定。 */
  for (const call of src.matchAll(new RegExp(EXEC_CALLEE_RE, "g"))) {
    const fn = call[0].replace(/\s*\($/, "");
    if (!cpNames.has(fn)) {
      continue;
    }
    const line = lineOf(call.index);
    offenders.add(
      `${rel}:${line}: ${(lines[line - 1] ?? "").trim()} ` +
        `（exec/execSync 天然走 shell，等同 shell:true —— 改用 spawn 直起命令）`,
    );
  }
  return [...offenders];
}

/**
 * 递归收集某目录下的脚本（跳过 node_modules）。
 *
 * 扩展名覆盖 `.mjs` / `.cjs` / `.ts` / `.tsx` / `.jsx` —— 起子进程的判据不挑语言，
 * 且 `.storybook/` 的配置是 `.ts`、e2e 与 tools 里有 `.mjs`（ISSUE #2562 把面从
 * 只扫 `scripts/**` 扩到 `tools/` `.storybook/` `e2e/`）。
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
      if (name === "node_modules") {
        continue;
      }
      collect(full, out);
      continue;
    }
    if (/\.(?:mjs|cjs|ts|tsx|jsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/* 要扫的根下子目录（ISSUE #2562：从只扫 `scripts/` 扩到 `tools/` `.storybook/` `e2e/`）。
 * `src/**` 仍**不扫** —— 那一侧的进程动作归硬规则 3 的 `kill-process-tree` 那一族，
 * 另有判据；把两条判据的扫描面并到一起只会让它们互相污染。 */
const SCAN_SUBDIRS = ["scripts", "tools", ".storybook", "e2e"];

/**
 * 扫一遍，给出违例清单。
 *
 * @param {string} [root] 仓库根
 * @returns {string[]} `文件:行号: 原文` 形态
 */
export function findShellOptions(root = ROOT) {
  /** @type {string[]} */
  const offenders = [];
  for (const sub of SCAN_SUBDIRS) {
    const base = path.join(root, sub);
    if (!fs.existsSync(base)) {
      continue;
    }
    for (const file of collect(base)) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      /* `trailing: true`：默认档只去整行注释，会把 `const a = 1; // 别写 shell: true`
       * 这种**行尾**注释留着 ⇒ 判据红在一段正在教人别这么写的注释上（自打自）。 */
      const stripped = stripComments(fs.readFileSync(file, "utf8"), {
        trailing: true,
      });
      offenders.push(...findShellOptionsIn(stripped, rel));
    }
  }
  return offenders;
}

/* 直接执行时给人读的报告（`node scripts/spawn-shell-scan.mjs [--root <dir>]`）。
 * `--root` 供阳性对照（canary）：在临时树里放一个已知违例，确认本脚本退出码非 0。 */
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {
  const rootFlag = process.argv.indexOf("--root");
  const scanRoot = rootFlag === -1 ? ROOT : process.argv[rootFlag + 1];
  const offenders = findShellOptions(scanRoot);
  if (offenders.length > 0) {
    process.stderr.write(
      "[spawn-shell-scan] 起子进程开 shell 的形态（Node 26 的 DEP0190，" +
        "且开了 shell 参数要自己括引号）—— 改用" +
        "`spawn(process.execPath, [resolvePackageBinEntry(pkg), …])` 直起包真身：\n",
    );
    for (const o of offenders) {
      process.stderr.write(`  ${o}\n`);
    }
    process.exit(1);
  }
  const msg =
    "[spawn-shell-scan] OK：scripts/ tools/ .storybook/ e2e/ 里没有起子进程走 shell 的形态（含 exec/execSync 与 .cmd/.bat 直接 spawn）";
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: true, offenders }));
  } else {
    process.stdout.write(`${msg}\n`);
  }
}
