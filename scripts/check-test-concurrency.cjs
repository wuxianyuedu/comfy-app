#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:并发档位（it.concurrent / describe.concurrent）的使用面(供 .githooks/pre-commit 调用)
/**
 * `it.concurrent` 只能用在**没有共享可变状态、且用例真的在等 I/O** 的地方 ——
 * 规范见 docs/standards/11-测试与可观测性.md §11.19。
 *
 * 为什么要有这条判据（ISSUE #1485 的收尾）：`test.concurrent` 是本仓库盘点
 * vitest 5 新能力时最后一条「没用上」的。它看起来是个免费的旋钮 —— 加一个
 * 关键字，套件就快了。实测下来**三个方向都是否的**，而每一个都不会自己报错：
 *
 * ── ① 它不是免费的：只在用例**真的让出事件循环**时才能买到墙钟 ──────────
 *
 * 同一件事（起一个睡 300ms 的子进程）× 24 条，实测：
 *
 *   · 同步 `spawnSync`：串行 7.75s → 并发 7.75s —— **1.0×（一个毫秒都不省）**
 *   · 异步 `execFile`：串行 7.73s → 并发 1.71s —— **4.5×**
 *
 * 同步阻塞的用例改并发只是换了个调度顺序（`it.concurrent` 让出的是 JS 栈，
 * 不是被阻塞的线程）。而本仓库门槛自测里最大的一批（58 份）用的正是
 * `execFileSync` —— 对它们改并发，代价是新的耦合面，收益是零。
 *
 * ── ② 它会把「同文件共享可变状态」从「各自持有一份」变成「互相踩」 ────────
 *
 * 实测：把 `tests/executor-host.test.ts`（7 条真起子进程）改成 `it.concurrent`
 * 之后红 2 条，报的是 `ConnectionFailed("Unable to open connection to local
 * database …: 14")` —— 那里 `afterEach` 把模块级 `tmpDirs` 整个 pop 干净再
 * `rmSync`，于是**某条用例的 SQLite 临时库被别人的 afterEach 删掉了**。
 * 注意它不只是「内存里的变量串了」：真资源（文件、库、端口）一起串。
 * 同一形态在 `tests/check-ui-primitives.test.ts` 上更极端（328 条全改 → 红 202 条），
 * 失败信息指向 `seedBaseline` 这种与被测行为无关的位置 —— 最难归因的一类红。
 *
 * ── ③ 它与 `expect.poll` 在机制上冲突（本轮最值钱的一条）────────────────
 *
 * vitest 5.0.3 实测（`--no-file-parallelism`，每格 20 次）：
 *
 *   · `it.concurrent` × 2、「站点」在后、await 真 timer ≥ 20ms → **20/20 红**
 *   · 同样两条，**次序反转** → **0/20 红**
 *   · `it.concurrent` **只一条** / `describe.concurrent` + `it` / 串行 `it` → 绿
 *   · await 的是 `Promise.resolve()` / `setTimeout(0)` / 5~16ms → 绿
 *
 * 报错是 `Error: expect.poll() must be called inside a test`。
 * ⇒ 它红不红取决于**同文件里别的并发用例有没有先把事件循环让出去** ——
 * 这是**时序依赖**，不是共享内存，而且阈值卡在 20ms 那一档：同一份代码换台
 * 机器、换个调度就换一个结论。而上一轮（§11.14）刚把全仓的等待统一收成
 * `expect.poll` —— 两者在同一个用例里是互斥的，`vi.waitFor` 则不受影响（实测绿）。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *
 * 上面三条里，① 是**收益**判断（文本判不了）、② 是**语义**判断（要真跑才知道），
 * 都不适合做门禁。能做的是 ③ 与「隔离声明」的形状判据 —— 它们都是文本可判的：
 *
 *   ① **并发档里不许出现 `expect.poll`**：实测那条报错只在并发下出现，
 *      而它的触发条件（同文件别的用例先让出事件循环）恰恰是「谁先跑」决定的。
 *      修法二选一：把该条改用串行 `it`，或把等待换成 `vi.waitFor`
 *      （后者在并发下实测不受影响，见 §11.14 那张对照表的三层差别）。
 *
 *   ② **并发档的文件必须给出隔离声明**：真要用 `it.concurrent`，就得证明
 *      「同文件的用例之间没有共享可变状态」—— 而这件事必须留痕（下一个人
 *      才能判断新加一条用例安不安全）。声明形状是一条注释：
 *
 *        // 并发档：<为什么这些用例之间没有共享可变状态>
 *
 *      为什么是「声明」而不是机器判共享状态：共享是**跨模块**的（模块级变量、
 *      全局单例、临时目录、真库、端口），静态判会误报一片；而声明在场至少让
 *      「这里新增一条用例」这一步必须过一个判断。这与 §11.18.3 的取舍同源 ——
 *      会误报的判据活不过一次评审。
 *
 * 用法：
 *   node scripts/check-test-concurrency.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-test-concurrency.cjs --report   # 只出清单不判失败（盘点用）
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
 * 并发站点：`it.concurrent(` / `test.concurrent(` / `describe.concurrent(`。
 *
 * ⚠️ **折行形态要认** —— prettier 会把长标题折成
 * `it.concurrent(\n  "…",\n  async () => {…},\n)`。只认「`concurrent(` 紧跟
 * 在行内」会漏掉折行那一半（同 §11.18.3.1 那条：`expect.soft` 的判据首版
 * 就是因为只认字面量而整片漏出扫描面，计数从 27 掉到 26 而判据照样报 OK）。
 * 这里按「标识符 + `.concurrent` + 可选空白 + `(`」判，跨行由 `\s` 覆盖。
 */
const CONCURRENT_SITE_RE =
  /(?<![\w.$])(?:it|test|describe)\s*\.\s*concurrent\s*\(/g;

/** `expect.poll` 站点（折行形态同款，见 §11.18.3.1）。 */
const EXPECT_POLL_RE = /expect\s*\.\s*poll\s*\(/g;

/**
 * 隔离声明：一行注释，写明「为什么这个文件里的用例之间没有共享可变状态」。
 * 要有内容 —— 空声明（只有一个标签）不算，那与没有声明等价。
 */
const ISOLATION_DECL_RE = /\/\/\s*并发档\s*[：:]\s*(\S.*)/;

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
 * 单/双引号字符串、模板串。
 *
 * ⚠️ 行注释也要挖，但**隔离声明的判据走原文**（它要读注释）—— 两件事分开做：
 * 站点扫描看挖过的，声明扫描看原文只取注释行。
 *
 * 为什么要挖：本判据自己的自测（`tests/test-concurrency-gate.test.ts`）里写着
 * **夹具字符串**，里面就有 `it.concurrent(` 与 `expect.poll(` —— 不挖字符串的话
 * 判据会去判自己的夹具（同族先例：`tests/comment-language.test.ts` 里那份
 * `"// @vitest-environment jsdom"` 夹具字符串，把 ISSUE #1485 那轮的文件计数
 * 从 183 数成了 185）。
 *
 * 刻意**不处理正则字面量**：少挖一段的代价只是判定更宽松（漏报），
 * 而那正是可接受的方向（§11.17.4 同一条教训）。
 *
 * @param {string} src
 * @returns {string} 与输入等长、非代码区间换成空格的串
 */
function maskNonCode(src) {
  /**
   * 模板串里的 `${…}` 是**真代码**（表达式），必须回代码态处理；而它自己的
   * `}` 之外还有模板串的余下部分。用一个**栈**记住每一层：
   *
   *   · 进模板态时压 `"tmpl"`；
   *   · 遇到 `${` 时压 `"interp"`（记住「这一层是指插值，遇到配对的 `}` 要回模板」）
   *     并回代码态；
   *   · 代码态里数花括号深度，`}` 归零时弹栈并按栈顶决定回模板还是回代码。
   *
   * ⚠️ 首版**只压了模板层、没有数插值的花括号**，于是 `${HEAD}` 那一层永远不弹 ——
   * 从第一个 `${` 往后整段都被当成代码。表现是本判据自己的**夹具字符串**被判成了
   * 真站点（自测文件里 `expect.poll(` 出现在夹具模板串里，却被判成「并发档 × poll」
   * 冲突），也就是 §11.18.3.1 记过的那个坑换了个入口：
   * **判据去判自己的夹具**。这条是提交门槛当场拦下来的（自测的 8 条用例全绿，
   * 而钩子报红）—— 自测绿、判据本体错，正是「判据在场 ≠ 判据在跑」的又一面。
   *
   * 正则字面量照旧不处理（§11.18.4 的取舍）：少挖一段只是漏报，可接受。
   *
   * @param {string} src
   * @returns {string} 与输入等长、非代码区间换成空格的串
   */
  const out = src.split("");
  /** @type {string[]} "tmpl" = 模板串本体；"interp" = 它里面的 `${…}` */
  const stack = [];
  let braceDepth = 0;
  let i = 0;
  let mode = "code"; // code | line | block | sq | dq | tmpl

  /* 字符串字面量闭合之后一律回**代码态** —— 不需要一个 `afterString()` 函数：
   * 插值里的 `}`、模板串的 `` ` ``、语句的 `;` 都只在代码态才被认出来，
   * 而那些正是紧跟在一个字符串后面的东西。早期版本在这里写过一个按「栈顶是不是
   * 模板」分叉的恢复态函数，实测**每一格都返回同一个值**（死分支）——
   * 留着它只会让下一个人以为那里有取舍。 */

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
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === quote) {
        out[i] = " ";
        i += 1;
        mode = "code";
        continue;
      }
      if (ch === "\n") {
        /* 未闭合的引号：不该出现，但别让判据崩在一行上（宁可放宽也不误报）。 */
        mode = "code";
        i += 1;
        continue;
      }
      out[i] = " ";
      i += 1;
      continue;
    }
    if (mode === "tmpl") {
      if (ch === "\\") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === "`") {
        out[i] = " ";
        i += 1;
        stack.pop();
        mode = "code";
        continue;
      }
      if (ch === "$" && next === "{") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        stack.push("interp");
        braceDepth = 0;
        mode = "code";
        continue;
      }
      if (ch !== "\n") out[i] = " ";
      i += 1;
      continue;
    }

    /* code 态 —— 但可能正处在一层插值里，要数花括号 */
    const inInterp = stack[stack.length - 1] === "interp";
    if (inInterp) {
      if (ch === "{") braceDepth += 1;
      else if (ch === "}") {
        if (braceDepth === 0) {
          /* 这一层插值收口：回到模板态继续吃字面量 */
          out[i] = " ";
          i += 1;
          stack.pop();
          mode = "tmpl";
          continue;
        }
        braceDepth -= 1;
      }
    }
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
      stack.push("tmpl");
      continue;
    }
    i += 1;
  }

  return out.join("");
}

/** 第几行（1 起）：数到某个字符偏移为止的换行数。 */
function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (src[i] === "\n") n += 1;
  return n;
}

/**
 * 扫一个文件，返回它命中的三类事实。
 * @param {string} abs
 * @returns {{concurrentSites: number[], pollSites: number[], isolationNotes: string[]}}
 */
function scanFile(abs) {
  const raw = fs.readFileSync(abs, "utf8");
  const masked = maskNonCode(raw);

  const concurrentSites = [];
  for (const m of masked.matchAll(CONCURRENT_SITE_RE)) {
    concurrentSites.push(lineOf(masked, m.index));
  }
  const pollSites = [];
  for (const m of masked.matchAll(EXPECT_POLL_RE)) {
    pollSites.push(lineOf(masked, m.index));
  }
  /* 隔离声明走原文（它是注释），但**只认行注释**：与「站点扫描看挖过的」分开，
   * 免得把站点的 mask 逻辑搅成两用的（那正是首版容易出错的地方）。 */
  const isolationNotes = [];
  for (const m of raw.matchAll(/\/\/.*$/gm)) {
    const hit = ISOLATION_DECL_RE.exec(m[0]);
    if (hit) isolationNotes.push(hit[1].trim());
  }

  return { concurrentSites, pollSites, isolationNotes };
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const problems = [];
  const concurrentFiles = [];
  let concurrentSites = 0;

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const { concurrentSites: sites, pollSites, isolationNotes } = scanFile(abs);
    if (sites.length === 0) continue;

    concurrentSites += sites.length;
    concurrentFiles.push({ rel, sites: sites.length });

    /* 判据 ①：并发档 × `expect.poll` —— 实测互斥（见文件头）。 */
    if (pollSites.length > 0) {
      problems.push(
        `${rel}:${pollSites.join(",")} —— 这个文件有 ${sites.length} 处并发站点` +
          `（第 ${sites.join(",")} 行），而第 ${pollSites.join(",")} 行用了 \`expect.poll\`。` +
          "\n      实测（vitest 5.0.3）：并发档里若同文件其它用例先让出事件循环，" +
          "\n      `expect.poll` 会报 `Error: expect.poll() must be called inside a test` ——" +
          "\n      20/20 红，而把两条用例次序反转则 0/20 红（阈值卡在 20ms 那一档）。" +
          "\n      修法二选一：该条改用串行 `it`；或把等待换成 `vi.waitFor`（并发下实测不受影响）。",
      );
    }

    /* 判据 ②：并发档要有隔离声明（下一个人据此判断新用例安不安全）。 */
    if (isolationNotes.length === 0) {
      problems.push(
        `${rel} —— 这个文件有 ${sites.length} 处并发站点（第 ${sites.join(",")} 行），` +
          "但没有任何隔离声明。\n      " +
          "在文件头（或并发块的上一行）写一条注释说明**为什么这些用例之间没有共享可变状态**：\n" +
          "        // 并发档：<理由>\n      " +
          "反例（实测）：模块级 `let workdir` / `tmpDirs` 被 `beforeEach` 覆写、" +
          "\n      被 `afterEach` 整个 `rmSync` —— 并发下前一条用例还在跑的子进程就指向别人的目录\n" +
          "      （`tests/executor-host.test.ts` 真红 2 条：SQLite 临时库被别人的 afterEach 删了）。",
      );
    }
  }

  if (problems.length === 0) {
    console.log(
      `[concurrency] OK —— ${concurrentSites} 处并发站点 / ${concurrentFiles.length} 份文件，` +
        "隔离声明齐全、无 `expect.poll` 冲突。",
    );
    return 0;
  }

  console.error(
    (REPORT_ONLY
      ? `[concurrency] 盘点：${problems.length} 处待办（--report 不判失败）`
      : `[ERROR] 有 ${problems.length} 处并发档用法不合口径`) + "：\n",
  );
  for (const p of problems) console.error(`  · ${p}\n`);
  console.error(
    "口径见 docs/standards/11-测试与可观测性.md §11.19。" +
      "\n一句话：`it.concurrent` 不是免费的旋钮 —— 同步阻塞的用例改它零收益，" +
      "\n真起进程的用例改它要和真资源（临时目录 / 库 / 端口）的隔离一起改。",
  );
  return REPORT_ONLY ? 0 : 1;
}

/* 自测（`tests/test-concurrency-gate.test.ts`）要**直接**钉字符串状态机 ——
 * 它是个纯函数，而它的失效形态（判据去判自己的夹具）没法靠「造一个临时仓库跑一遍」
 * 稳定复现：同一个形状在有没有前置代码时会得到不同结果（实测）。
 * 只导出这一个函数，不导出 `main` —— 那是门口的入口，不该被 import。 */
module.exports = { maskNonCode };

/* 被 import 时（自测）只导出、不执行；被当脚本跑时（钩子）才判。 */
if (require.main === module) process.exit(main());
