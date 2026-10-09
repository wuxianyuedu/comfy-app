#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:`ctx.annotate` 的**消费方**在场(供 .githooks/pre-commit 调用)
/**
 * `ctx.annotate` 只有**读到它的人**在场才有意义 —— 规范见
 * docs/standards/11-测试与可观测性.md §11.21。
 *
 * 为什么要有这条判据（ISSUE #1485 收尾轮）：`annotate` 是本仓库盘点 vitest 5
 * 新能力时最后三条之一。它看起来像「给用例挂个备注」，实测下来**四条**都出乎意料：
 *
 * ── ① 第二参数是字符串（type），不是对象 ────────────────────────────────
 *
 * 类型签名是 `annotate(message: string, type?: string, attachment?)`。
 * 照文档直觉写 `ctx.annotate("理由", { type: "known-failed" })` —— 那个对象会被
 * 当成**附件**，当场抛：
 *
 *   抛出的原文是：`TypeError: Test attachment requires "body" or "path" to be set.`
 *
 * 这条是第一版就踩到的：报错信息（讲 attachment）与真实原因（参数位置写错了）
 * 完全对不上，指不出方向。
 *
 * ── ② 它**不改结论**：红的照样红、退出码照样非零 ────────────────────────
 *
 * 实测：挂了 `known-failed` 注释的失败用例仍然 `Tests 1 failed`、退出码仍是 1。
 * 所以它**不能**替代 `KNOWN_FAILED_FILES` 那种「先摘掉、再跑」的机制 ——
 * 那一步必须发生在运行**之前**。
 *
 * ── ③ 绿的时候**完全不可见** ─────────────────────────────────────────────
 *
 * 实测 text reporter：绿的用例带 annotation 时，输出里**一个字都没有**；
 * 只有失败用例才会在调用点旁打一行 `↳ known-failed`。
 * 也就是说它的可见性完全绑在「这条已经红了」上 —— 对一批**当前是绿的**用例
 * 挂声明，等于写在没人会看的纸上。
 *
 * ── ④ 门禁链**读不到**它 ────────────────────────────────────────────────
 *
 * `--reporter=json` 的产物里既没有顶层 `annotations`、`assertionResults[].meta`
 * 也是空的（实测逐键核过）。唯一读得到的是 **programmatic API**：
 * `createVitest()` 的 `task.annotations()`（实测能拿到 message / type / location）。
 * 而本仓库门禁链跑 vitest 的方式是 **CLI spawn**（`run-affected-tests.mjs`），
 * 与那条通道**天然不兼容**。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *
 * 上面四条合起来只有一种「用了反而更坏」的形状：**挂一堆没人读的注释**。
 * 它比不写更坏 —— 注释在场会让人以为「这件事有人管」，而没有任何东西在读
 * （§11.13.1 / §11.18.3.1「判据在场 ≠ 判据在跑」的同族，只是这次「判据」变成一行注释）。
 *
 * 所以本判据只做一件事：**有站点就必须登记消费方**。
 *   · 零站点（本仓库当前状态）→ 通过，本判据是纯闸门；
 *   · 有站点 → `scripts/.annotate-consumers.json` 里必须有一条说明
 *     「谁读它、怎么读」，否则阻断。
 *
 * **刻意不判**「该不该用 annotate」：那是收益判断（要实测），不是文本判据。
 * **也刻意不做**「运行时真去读一遍」的判据：那要起 `createVitest()`，
 * 而钩子档已经在起一次 vitest（C 组），加第二次只为读几行注释 —— 代价与收益不成比例。
 *
 * 用法：
 *   node scripts/check-annotate-consumer.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-annotate-consumer.cjs --report   # 只出清单不判失败（盘点用）
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

/** 台账：谁在读 `ctx.annotate` 写的那些注释。 */
const LEDGER = "scripts/.annotate-consumers.json";

/**
 * `annotate` 站点。两种调用形态都要认：
 *   · `ctx.annotate(` / `context.annotate(` —— vitest 的用例上下文（正常形态）；
 *   · `task.annotate(` —— programmatic API 那一侧。
 *
 * ⚠️ **折行形态要认**（同 §11.18.3.1 / §11.20.5 那条实测）：prettier 会把长行折开，
 * 只认行内字面量会整片漏出扫描面，而漏得**静默**。
 */
const ANNOTATE_SITE_RE = /(?<![\w.$])(?:\w+\s*\.\s*)?annotate\s*\(/g;

/**
 * 把**不是代码**的区间挖掉（换成等长空格，保持偏移）：行注释、块注释、
 * 单/双引号字符串、模板串。
 *
 * 为什么要挖：本判据自己的自测（`tests/annotate-consumer-gate.test.ts`）里
 * 写着**夹具字符串**，里面就有 `ctx.annotate(` —— 不挖字符串，判据就会去判
 * 自己的夹具（同族先例：`tests/comment-language.test.ts` 里那份
 * `"// @vitest-environment jsdom"`，把 ISSUE #1485 那轮的文件计数从 183 数成了 185）。
 *
 * 刻意**不处理正则字面量**：少挖一段的代价只是漏报，而漏报是可接受的方向
 * （§11.17.4 / §11.18.3.1 同一条教训）。
 */
function maskNonCode(src) {
  const out = src.split("");
  /** @type {string[]} "tmpl" = 模板串本体；"interp" = 它里面的 `${…}` */
  const stack = [];
  let braceDepth = 0;
  let i = 0;
  let mode = "code"; // 状态:代码 | 行注释 | 块注释 | 单引号 | 双引号 | 模板串

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
      if (ch === quote) mode = "code";
      else out[i] = " ";
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
        mode = "code";
        out[i] = " ";
        i += 1;
        continue;
      }
      if (ch === "$" && next === "{") {
        stack.push("interp");
        braceDepth = 0;
        mode = "code";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch !== "\n") out[i] = " ";
      i += 1;
      continue;
    }
    // 代码态
    if (ch === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      mode = "line";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      mode = "block";
      i += 2;
      continue;
    }
    if (ch === "'") {
      mode = "sq";
      i += 1;
      continue;
    }
    if (ch === '"') {
      mode = "dq";
      i += 1;
      continue;
    }
    if (ch === "`") {
      mode = "tmpl";
      stack.push("tmpl");
      i += 1;
      continue;
    }
    if (stack.at(-1) === "interp") {
      if (ch === "{") braceDepth += 1;
      else if (ch === "}") {
        if (braceDepth === 0) {
          stack.pop();
          mode = "tmpl";
        } else braceDepth -= 1;
      }
    }
    i += 1;
  }
  return out.join("");
}

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
 * 读台账。**解析失败一律抛**（由调用方判失败）——
 * 静默退回「没有台账」＝ 有站点时判据空转，与 §11.18.3 首版那个
 * `include: []` 却退 0 的 bug 同族。
 */
function readLedger() {
  const abs = path.join(ROOT, LEDGER);
  if (!fs.existsSync(abs)) return null;
  let json;
  try {
    json = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    throw new Error(`解析 ${LEDGER} 失败：${e.message}`);
  }
  if (!Array.isArray(json?.consumers)) {
    throw new Error(`${LEDGER} 的 \`consumers\` 不是数组（形状不在预期内）`);
  }
  return json.consumers;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const sites = [];
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const masked = maskNonCode(fs.readFileSync(abs, "utf8"));
    for (const m of masked.matchAll(ANNOTATE_SITE_RE)) {
      sites.push({
        rel,
        line: masked.slice(0, m.index).split("\n").length,
      });
    }
  }

  if (sites.length === 0) {
    console.log(
      "[annotate] OK —— 0 处 `ctx.annotate` 站点（本判据是纯闸门：对象是「下一次有人挂注释」）。",
    );
    return 0;
  }

  let consumers;
  try {
    consumers = readLedger();
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    return 1;
  }

  if (consumers === null || consumers.length === 0) {
    console.error(
      (REPORT_ONLY
        ? `[annotate] 盘点：${sites.length} 处站点、无消费方登记（--report 不判失败）`
        : `[ERROR] 有 ${sites.length} 处 \`ctx.annotate\` 站点，但 ${LEDGER} 里没有消费方`) +
        "：\n",
    );
    for (const s of sites) console.error(`  · ${s.rel}:${s.line}`);
    console.error(
      "\n`annotate` 写下的注释**只有失败时**在 text reporter 里可见，`--reporter=json`\n" +
        "的产物里一个字都没有（实测逐键核过），唯一的读数通道是 programmatic API\n" +
        "`createVitest()` 的 `task.annotations()` —— 而门禁链跑 vitest 用的是 CLI spawn。\n" +
        "所以「挂一把没人读的注释」比不写更坏：它让人以为这件事有人管。\n" +
        `修法二选一：\n  · 登记消费方：在 ${LEDGER} 的 \`consumers\` 里写明谁读、怎么读；\n` +
        "  · 或者不写这条注释 —— 当前没有消费方时它只是装饰。\n" +
        "口径见 docs/standards/11-测试与可观测性.md §11.21。",
    );
    return REPORT_ONLY ? 0 : 1;
  }

  console.log(
    `[annotate] OK —— ${sites.length} 处注解站点，消费方 ${consumers.length} 条登记。`,
  );
  return 0;
}

process.exit(main());
