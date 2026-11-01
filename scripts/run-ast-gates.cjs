#!/usr/bin/env node
// @ts-nocheck -- 聚合档：一次解析、多条 AST 判据共用的宿主（供 .githooks/pre-commit 的 D 组调用）
/**
 * **AST 判据聚合档** —— 规范见 docs/standards/13-提交与-code-review.md §13.5.8.2「第四笔账」。
 *
 * ── 它治的是什么 ──────────────────────────────────────────────────────
 *
 * 有 6 份判据判的是**同一批文件**（`src/**` 的 `.ts`/`.tsx`，实测 1082 份 / 7.3MB），
 * 而每份各自 `require("typescript")` + `walk` + `readFileSync` + `createSourceFile`
 * 全量走一遍。实测（8 核，热缓存，改动落在 `src/` 时）：
 *
 *   · 6 个独立进程：`681+629+627+451+462+348` = **3198ms**；
 *   · 一次 `walk`+`read` 35ms + 一次 `parse` 550ms + 6×遍历 6×52ms = **904ms**。
 *
 * 省下的 ≈2.3s 全在「**同一次解析被 6 个进程各做一遍**」——它不是代码重复，
 * 是**计算重复**，所以**共享颗粒度**必须定在「解析产物」上（下面那节）。
 *
 * ── 共享颗粒度：只共享解析产物，不共享遍历、更不共享判定 ────────────────
 *
 *   · **共享**：`SourceFile`（`ts.createSourceFile` 的纯函数产物 —— 同一份文本 +
 *     同一个 `ScriptTarget`/`ScriptKind` ⇒ 逐位相同，共享它不引入跨判据耦合）。
 *   · **不共享**：`visit`（每条判据自己的规则语义）。把它一起共享，六条规则就混进
 *     一个遍历器 —— 改一条的豁免要重读另外五条（§13.5.8.2 那句「缓存的是纯函数，
 *     不是『某条规则的计数』」的同一条边界）。实测全遍历只 52ms/遍，不值得动。
 *
 * ── 怎么复用各判据的**判定**（这是本档最容易做坏的一格）────────────────
 *
 * 判定（读基线 / 比数 / 点名词 / 退出码）**一行都不在这里重写** —— 重写一遍就是
 * 孪生实现，两处迟早漂开（§12.12），而且漂开的形态是静默的：聚合档说绿、单条脚本
 * 说红（或反过来），没有任何判据会看见。做法是：
 *
 *   1. 每条判据已经被拆成「规则本体（吃 `SourceFile`）」+「判定」两半，本档把
 *      **一份共享的 `Map<路径, SourceFile>`** 注入它 `main(parsed)` 的入参；
 *   2. 在进程内跑它自己的 `main()`，用 `captureProcessExit()` 接住它的 `process.exit`、
 *      `captureOutput()` 接住它的 stdout/stderr —— 于是**它的判定代码原样执行**，
 *      打印的每一个字也是它自己写的；
 *   3. 逐条汇总：全绿 ⇒ rc 0；任一条红 ⇒ rc 1，并把**每条失败判据的名字 + 它自己的
 *      输出**打出来（逐条可分辨，不糊成一句「D 组失败」）。
 *
 * ── 三条不许松的口径 ──────────────────────────────────────────────────
 *
 * 1. **每条判据都必须真跑**（静态清单，逐条点名）。少跑一条在这里的形态是「少一个
 *    函数调用」——没有任何判据会看见，所以由 `tests/ast-gates-aggregate.test.ts`
 *    钉「清单里每条都真跑」与「抹掉任意一条会被抓」。
 * 2. **人的动作不走这里**：`--report` / `--update` / `--json` / `--with-tests` /
 *    显式文件入参一律仍跑**单条脚本**（收紧基线要按单条记账，混在一起会写错账）。
 *    本档只跑「钩子档」= 全库 check。
 * 3. **`--staged` 短路仍按条判**：各判据的扫描面不同（`check-void-floats` 只认
 *    `src/lib`、`check-non-null-assertions` 认整个 `src`），本档把 `--staged` 透传
 *    给每条判据、由**它自己**的 `skipUnlessStagedTouches()` 决定跳不跳；全跳则本档
 *    一次解析都不做（不先解析再跳过，§13.5.8.2 第一个坑）。
 *
 * 用法：
 *   node scripts/run-ast-gates.cjs             # 钩子档：全库 check（逐条判据都真跑）
 *   node scripts/run-ast-gates.cjs --staged    # 钩子用：输入面跳过按条透传
 *   node scripts/run-ast-gates.cjs --list      # 只打印清单（盘点/接线判据用）
 */
const path = require("node:path");
const { readStagedPaths } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");

/**
 * 聚合档的**判据清单**（顺序即执行序）。
 *
 * 每条给出：`script`（单条脚本，人的动作仍走它）、`entry`（本档调它的 `main`）、
 * `tag`（失败点名的前缀，取各脚本自己的输出前缀）、`what`（中文名，给人看）、
 * `roots`（它的扫描面，用于「全跳则零解析」的判断）、`parsedKey`（注入的键形态）。
 *
 * **新增一条要同改三处**：这里、`.githooks/pre-commit` 的那一行、以及
 * `tests/ast-gates-aggregate.test.ts` 的清单断言 —— 三处任一漏改都会被判据拦下。
 */
const GATES = [
  {
    script: "check-react-updater-purity.cjs",
    tag: "[updater-purity]",
    what: "React 函数式 updater 纯净性",
    roots: ["src"],
    parsedKey: "rel",
  },
  {
    script: "check-non-null-assertions.cjs",
    tag: "[non-null]",
    what: "src 非空断言硬闸",
    roots: ["src"],
    parsedKey: "rel",
  },
  {
    script: "check-void-floats.cjs",
    tag: "[void-floats]",
    what: "src/lib void 悬空 Promise 棘轮",
    roots: ["src/lib"],
    parsedKey: "rel",
  },
  {
    script: "check-ts-duplicate-keys.cjs",
    tag: "[ts-duplicate-keys]",
    what: "TS 重复属性判定",
    roots: ["src"],
    parsedKey: "abs",
  },
  {
    script: "check-form-field-wiring.cjs",
    tag: "[form-field-wiring]",
    what: "FormField 标签⇄控件接线",
    roots: ["src"],
    parsedKey: "abs",
  },
  {
    script: "check-click-keyboard.cjs",
    tag: "[click-keyboard]",
    what: "非原生元素点击的键等价物",
    roots: ["src"],
    parsedKey: "abs",
  },
];

/**
 * 接住 `process.exit(code)`：抛一个哨兵，由调用方在 `catch` 里读回退出码。
 *
 * 为什么必须接住：多条判据的**失败路径**就是 `process.exit(1)`（它们本来是独立
 * 进程的入口，这是正常的）。在聚合档里直接跑会把整个聚合档打死在第一处失败上 ——
 * 于是后面 5 条**一条都不跑**，而「少跑 5 条」没有任何判据会看见。
 *
 * @returns {{code: number|null, restore: () => void}}
 */
function captureProcessExit() {
  const original = process.exit;
  let code = null;
  process.exit = (c) => {
    code = typeof c === "number" ? c : 0;
    // 用哨兵打断当前判据的调用栈；由 runGate() 的 catch 识别并当作正常结束。
    const sentinel = new Error("__gate_exit__");
    sentinel.__gateExit = true;
    throw sentinel;
  };
  return {
    get code() {
      return code;
    },
    restore() {
      process.exit = original;
    },
  };
}

/**
 * 接住 `console.log` / `console.warn` / `console.error`：把一条判据的输出收进数组，
 * 由本档在最后**逐条打印**（避免与其它判据的输出交错，也让「谁说了什么」可分辨）。
 *
 * @returns {{lines: string[], restore: () => void}}
 */
function captureOutput() {
  const lines = [];
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const make =
    () =>
    (...args) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    };
  console.log = make();
  console.warn = make();
  console.error = make();
  return {
    lines,
    restore() {
      console.log = originals.log;
      console.warn = originals.warn;
      console.error = originals.error;
    },
  };
}

/**
 * 载入一条判据模块。
 *
 * **必须在 argv 里没有 `--staged` 时 require**：6 条判据的模块顶层都有
 * `if (STAGED) skipUnlessStagedTouches(...)`，它在「没命中自己的扫描面」时
 * `process.exit(0)` —— 在聚合档里那就是**把整个聚合档打死**（后续判据一条都不跑，
 * 而「少跑几条」没有任何判据会看见）。本档把 `--staged` 的判断提升到 `main()` 里
 * **按条自己算**（`gateTouchesStaged()`），模块层不需要也不该再判一次。
 *
 * @param {object} gate GATES 的一项
 * @returns {object} 判据模块（已导出 `main`）
 */
function loadGate(gate) {
  const saved = process.argv;
  process.argv = [saved[0] ?? "node", path.join(__dirname, gate.script)];
  try {
    return require(path.join(__dirname, gate.script));
  } finally {
    process.argv = saved;
  }
}

/**
 * 跑一条判据：进程内调它的 `main(parsed)`，接住退出码与输出。
 *
 * @param {object} gate GATES 的一项
 * @param {Map<string, import("typescript").SourceFile>} parsed 共享解析结果
 * @returns {{tag:string, what:string, code:number, lines:string[]}}
 */
function runGate(gate, parsed) {
  const mod = loadGate(gate);
  const cap = captureOutput();
  const exit = captureProcessExit();
  let code = 0;
  try {
    const returned = mod.main(parsed);
    // 有的判据 `main()` 返回数字、有的靠 `process.exit`（上面接住了）。
    if (typeof returned === "number") {
      code = returned;
    } else if (exit.code !== null) {
      code = exit.code;
    }
  } catch (error) {
    if (error && error.__gateExit) {
      code = exit.code ?? 0;
    } else {
      /* 判据自己抛了异常 = 判据没跑成，不能读成「通过」（§13.5.12 那一族）。
       * 把异常文本收进输出、按红算，并**留下面向人的一行**。 */
      code = 1;
      cap.lines.push(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 异常可能没有 message（抛的是字符串/空 message），那时要念出本身
        `${gate.tag} 判据抛出异常（这一条没有结论，按红处理）：${(error && error.message) || String(error)}`,
      );
    }
  } finally {
    exit.restore();
    cap.restore();
  }
  return { tag: gate.tag, what: gate.what, code, lines: cap.lines };
}

/**
 * 枚举 6 条判据的扫描面并集，解析一次 —— **共享的唯一产物**。
 *
 * 用并集（不是逐条各解析一遍）：`check-void-floats` 只要 `src/lib`，但它要的文件
 * 是全并集的子集，解析它的子集与解析全并集**在它这一条上等价**（它只按自己的
 * `collectFiles` 取用）。键同时给「仓库根相对路径」与「绝对路径」两套，因为各判据
 * 历史实现里两种键都有 —— 这是**为了不改各判据的取用口径**，不是为了方便。
 *
 * @returns {Map<string, import("typescript").SourceFile>}
 */
function parseShared() {
  const { parseSources } = require("./gate-ast-read.cjs");
  const parsed = new Map();
  parseSources({
    roots: ["src"],
    root: ROOT,
    perSource: ({ rel, abs, sourceFile }) => {
      parsed.set(rel, sourceFile);
      parsed.set(abs, sourceFile);
    },
  });
  return parsed;
}

/**
 * 主流程：全跳则零解析；否则解析一次、逐条跑、逐条汇总。
 * @returns {number} 0 = 全绿；1 = 有判据红
 */
function main() {
  const argv = process.argv.slice(2);
  const staged = argv.includes("--staged");

  if (argv.includes("--list")) {
    for (const g of GATES) {
      console.log(`${g.tag} ${g.script} ${g.what}`);
    }
    return 0;
  }

  /* 人的动作（`--report` / `--update` / `--json` / `--with-tests`）不走聚合档 ——
   * 它们按单条记账，本档直接拒绝，避免「以为走了聚合档、其实语义被换掉」。 */
  const humanAction = argv.filter((a) => a && a !== "--staged");
  if (humanAction.length > 0) {
    console.error(
      `[ast-gates] 聚合档只跑钩子档（全库 check）。\n` +
        `  收到 ${humanAction.join(" ")} —— 人的动作（--report / --update / --json /\n` +
        `  --with-tests）请跑单条脚本，基线要按单条记账。`,
    );
    return 2;
  }

  /* `--staged` 的输入面判断在**这里按条算**，不在各判据的模块层（见 `loadGate()`）。
   * 读不到暂存清单（git 失败）时 `readStagedPaths()` 返回 `null` ⇒ 这里 fail-closed
   * 成「全部跑」，由各判据自己该红就红 —— 判据没跑成不许被读成「没触及扫描面」。 */
  const stagedFiles = staged ? readStagedPaths(process.cwd()) : null;
  const runnable = GATES.filter(
    (g) => !staged || stagedFiles === null || touches(stagedFiles, g.roots),
  );
  const skipped = GATES.filter((g) => !runnable.includes(g));

  if (runnable.length === 0) {
    console.log(
      `[ast-gates] ✓ 本次提交未触及任何 AST 判据的扫描面（${GATES.length} 条各自的根都没有命中），跳过。`,
    );
    return 0;
  }

  const parsed = parseShared();
  const results = runnable.map((g) => runGate(g, parsed));
  const failed = results.filter((r) => r.code !== 0);

  for (const g of skipped) {
    console.log(`${g.tag} ✓ 本次提交未触及扫描面（[${g.roots.join(", ")}] 没有命中），跳过。`);
  }
  for (const r of results) {
    for (const line of r.lines) {
      console.log(line);
    }
  }

  if (failed.length === 0) {
    console.log(
      `[ast-gates] OK —— ${results.length} 条 AST 判据全绿（共享一次解析，${parsed.size / 2} 份文件）${
        skipped.length ? `，另 ${skipped.length} 条未触及扫描面。` : "。"}`,
    );
    return 0;
  }

  console.error(
    `\n[ast-gates] ${failed.length}/${results.length} 条判据红：${
      failed.map((r) => `${r.what}${r.tag}`).join(" · ")}`,
  );
  /* 收尾段**逐行都带 `[ast-gates]` 前缀**：这一段是聚合档自己的输出，而 `gateLines()`
   * （`tests/ast-gates-aggregate.test.ts` 的对拍）按前缀识别「哪些行属于聚合档」。
   * 早期形态是「首行带前缀 + 续行缩进」，于是失败档会往对拍里混进 4 行没有前缀的续行 ——
   * 那个差异只在**有判据红时**才出现，而当时的输入面（真仓库全量 `src/`）永远全绿，
   * 所以这一格从没被走到过（ISSUE #1747「C 组第五笔账」把输入面换成探针后才暴露）。 */
  for (const line of [
    "[ast-gates] 逐条复验（单条脚本，语义与聚合档一致）：",
    ...failed.map((r) => `[ast-gates]   node scripts/${scriptOf(r.tag)}`),
  ]) {
    console.error(line);
  }
  return 1;
}

/** 按 tag 找脚本名（失败时的复验命令用）。 */
function scriptOf(tag) {
  const g = GATES.find((x) => x.tag === tag);
  return g ? g.script : "run-ast-gates.cjs";
}

/**
 * 「这一条判据的扫描面被暂存改动碰到了吗」。
 *
 * 用的是**各判据自己的根清单**（`GATES[].roots`），不另抄一份 —— 抄一份就会与
 * 判据漂开，而漂开的形态是静默的（§12.12 / §12.18）。`isUnderAny()` 就是
 * `gate-scan-read.cjs` 里 `skipUnlessStagedTouches()` 用的同一个判据，语义一字不差。
 *
 * @param {string[]} files 暂存清单（仓库根相对 POSIX 路径）
 * @param {string[]} roots 该判据的扫描根
 * @returns {boolean}
 */
function touches(files, roots) {
  const { isUnderAny } = require("./gate-scan-read.cjs");
  return files.some((f) => isUnderAny(f, roots));
}

if (require.main === module) {
  process.exit(main());
}
