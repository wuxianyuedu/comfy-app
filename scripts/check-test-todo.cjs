#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:`test.todo` 的**消费方**在场(供 .githooks/pre-commit 调用)
/**
 * `test.todo` 只有**读到它的人**在场才有意义 —— 规范见
 * docs/standards/11-测试与可观测性.md §11.24。
 *
 * 它是 ISSUE #1485 盘点 vitest 5 新能力时最后没归宿的几条之一。实测定性下来，
 * 它和同批的 `tags` / `.only` / `expect.extend` **不是一类**：
 *
 * ── 同批那三个是**响的**（各跑了对照） ──────────────────────────────────
 *
 *   · `tags`：`it("x", { tags: ["slow"] }, …)` 而配置里没声明 `slow` →
 *     **整份 suite 直接挂**（`cannot apply "slow" tag`），`--tags-filter=slow`
 *     同样抛错。它自己会喊，不需要第二道闸门。
 *   · `.only`：`it.only(…)` → `Unexpected .only modifier` 当场红，
 *     `Tests 1 failed | 1 skipped`。vitest 默认就不放行它。
 *   · `expect.extend`：自定义匹配器**能过也能真报红**（与 jest-dom 同机制，
 *     实测 `toBeWithinRange` 断言不成立时 `Tests 1 failed`）。它的问题是
 *     「自定义判据的可见性」，不是「会不会静默失效」。
 *
 * ── 而 `test.todo` 是**静默的**，这才是本判据存在的全部理由 ──────────────
 *
 * 实测（vitest 5.0.3）：`test.todo("将来要做的事")` 的读数
 *   · 退出码 **0**（它不进失败计数，`Tests 1 passed | 1 todo (2)`）；
 *   · `--reporter=json` 里**看得见**（`numTodoTests: 1`、`status: "todo"`）；
 *   · 而**门禁链读不到** —— `run-affected-tests.mjs` 跑 `node <vitest> run
 *     --maxWorkers=N <files…>`，`stdio: "inherit"`、退出码是唯一判据，
 *     既没有 `--reporter=json` 也没有 `--outputFile`（`check-task-meta-consumer.cjs`
 *     量到的是同一件事）。
 *
 * 合起来：**一条 `test.todo` 是一份「这件事还没有人做」的声明，而它零成本、
 * 且门禁链一个字都读不到。** 与 `ctx.annotate` / `task.meta` 同族
 * （§11.21 / §11.22 / §11.23「声明写得出来不算数，读的人在跑才算」），
 * 只是它比那两个更直白 —— `annotate` 至少是句备注，`test.todo` 是一个**缺位的用例**。
 *
 * 所以本判据只做一件事：**有站点就必须登记消费方**。
 *
 *   · 零站点（本仓库当前状态）→ 通过，本判据是纯闸门；
 *   · 有站点 → `scripts/.test-todo-consumers.json` 里必须有一条说明
 *     「谁读它、怎么读」，否则阻断。
 *
 * **刻意不判**「该不该用 `test.todo`」：那是收益判断（要实测），不是文本判据。
 * **也刻意不铺开到 `tags` / `.only` / `expect.extend`**：那三个实测都是**响的**，
 * 给一个自己会喊的东西再配一道文本闸门 = 用一条会静默失效的清单去守一条不会
 * 静默失效的事实（§12.18「别造第二轮子」）。
 *
 * 用法：
 *   node scripts/check-test-todo.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-test-todo.cjs --report   # 只出清单不判失败（盘点用）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");
const { readForScan, walkForScan, vanishedNote } = require("./gate-scan-read.cjs");

const ROOT = path.resolve(__dirname, "..");
const REPORT_ONLY = new Set(process.argv.slice(2)).has("--report");

/** 扫描范围：与 `vitest.config.ts` 的 `include` 同口径。 */
const SCAN_DIRS = ["src", "tests"];
const TEST_FILE_RE = /\.test\.tsx?$/;

/** 台账：谁在读 `test.todo` 写下的那些「还没做」的声明。 */
const LEDGER = "scripts/.test-todo-consumers.json";

/**
 * 站点。`test.todo` / `it.todo`（含 `describe.todo`）都在面上 —— vitest 三者
 * 是同一族（`describe.todo` 整块不跑，后果更重）。
 *
 * ⚠️ **折行形态要认**（同 §11.18.3.1 / §11.20.5 / §11.21 那条实测）：prettier 会把
 * 长行折开，只认行内字面量会整片漏出扫描面，而漏得**静默**。
 * 所以标识符与 `.todo` 之间的空白都放行。
 */
const TODO_SITE_RE = /(?<![\w.$])(?:it|test|describe)\s*\.\s*todo\s*\(/g;

/**
 * 把**不是代码**的区间挖掉（换成等长空格，保持偏移）：行注释、块注释、
 * 单/双引号字符串、模板串。模板串里的 `${…}` 是**真代码**（表达式），
 * 递归回代码态处理，遇配对的花括号再回模板态 —— 用一个模板栈处理嵌套。
 *
 * 为什么要这一步：本判据自己的自测（`tests/test-todo-gate.test.ts`）里写着
 * **夹具字符串**（要造的正是「改坏后的文件」），不挖字符串的话判据会去判自己的
 * 夹具（同族先例：`tests/comment-language.test.ts` 里那份
 * `"// @vitest-environment jsdom"` 夹具字符串，把 §11.17 那轮的文件计数从 183 数成 185）。
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
      if (ch === "\n") {
        mode = "code";
      } else {
        out[i] = " ";
      }
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
        if (ch !== "\n") {
          out[i] = " ";
        }
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
        mode = "code";
      } else {
        out[i] = " ";
      }
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
      if (ch !== "\n") {
        out[i] = " ";
      }
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
      if (ch === "{") {
        braceDepth += 1;
      } else if (ch === "}") {
        if (braceDepth === 0) {
          stack.pop();
          mode = "tmpl";
        } else {
          braceDepth -= 1;
        }
      }
    }
    i += 1;
  }
  return out.join("");
}

/**
 * 枚举与读取都走 `gate-scan-read.cjs`：现场、两种消失窗口、「只降级 ENOENT」与
 * 「不许静默」的口径都在那一份里，这里不重述（同一件事曾经有四份私有实现）。
 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE);
}

/**
 * 读台账。**缺失 / 解析失败一律抛**（由调用方判失败）。
 *
 * 「缺失」与「解析失败」同等对待，这一条是照 §11.21 / §11.22 的修法直接继承的：
 * 原先那两份判据写的是 `if (!fs.existsSync(abs)) return null`，把「文件不在」
 * 静默退回成「没有台账」，而零站点时判据**在读到台账之前就 return 了** ——
 * 表现是全绿，绿的却是「台账压根不存在」，台账从建判据起就没被创建过。
 * 纯闸门的「零站点通过」必须由**台账在场、只是没内容**来说，不能由
 * 「台账根本没有」来说 —— 后者在第一次有人挂 `test.todo` 时就分叉，
 * 而那一侧今天没有任何执行者。所以这里一次做对：不走那条路。
 */
function readLedger() {
  const abs = path.join(ROOT, LEDGER);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `${LEDGER} 不存在。它不该缺席 —— 「零站点通过」要由「台账在、只是没内容」` +
        "来说，不是由「台账根本没有」来说（口径见 §11.23）。",
    );
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    throw new Error(`解析 ${LEDGER} 失败：${e.message}`, { cause: e });
  }
  if (!Array.isArray(json?.consumers)) {
    throw new Error(`${LEDGER} 的 \`consumers\` 不是数组（形状不在预期内）`);
  }
  return json.consumers;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const sites = [];
  let vanished = 0;
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const raw = readForScan(abs);
    if (raw === null) {
      vanished += 1;
      continue;
    }
    const masked = maskNonCode(raw);
    for (const m of masked.matchAll(TODO_SITE_RE)) {
      sites.push({
        rel,
        line: masked.slice(0, m.index).split("\n").length,
      });
    }
  }
  /* 消失数必须进结论：它等于「这几份文件这一轮没被读过」。 */
  const note = vanishedNote(vanished);

  /* 台账先读、哪怕零站点：`readLedger()` 缺失即抛，于是「零站点通过」这个结论
     由「台账在、只是没内容」担保，而不是由「台账根本没有」担保。 */
  let consumers;
  try {
    consumers = readLedger();
  } catch (e) {
    console.error(`[ERROR] ${e.message}`);
    return 1;
  }

  if (sites.length === 0) {
    console.log(
      "[test-todo] OK —— 0 处 `test.todo` 站点" +
        `（本判据是纯闸门：对象是「下一次有人留一条还没做的用例」；台账在场，${consumers.length} 条登记）。` +
        note,
    );
    return 0;
  }

  if (consumers === null || consumers.length === 0) {
    console.error(
      (REPORT_ONLY
        ? `[test-todo] 盘点：${sites.length} 处站点、无消费方登记（--report 不判失败）`
        : `[ERROR] 有 ${sites.length} 处 \`test.todo\` 站点，但 ${LEDGER} 里没有消费方`) + "：\n",
    );
    for (const s of sites) {
      console.error(`  · ${s.rel}:${s.line}`);
    }
    console.error(
      "\n`test.todo` 是一条「这件事还没有人做」的声明：退出码 **0**、不进失败计数，\n" +
        "而门禁链跑 vitest 只看退出码（`run-affected-tests.mjs`，无 `--reporter=json`）——\n" +
        "也就是说**它零成本、且没有任何东西在读它**。声明挂在那里会让人以为\n" +
        "「这件事有人管」（§11.23）。\n" +
        `修法二选一：\n  · 登记消费方：在 ${LEDGER} 的 \`consumers\` 里写明谁读、怎么读；\n` +
        "  · 或者把它写成一条真用例 —— 当前没有消费方时它只是装饰。\n" +
        "口径见 docs/standards/11-测试与可观测性.md §11.24。",
    );
    return REPORT_ONLY ? 0 : 1;
  }

  console.log(
    `[test-todo] OK —— ${sites.length} 处 todo 站点，消费方 ${consumers.length} 条登记。` + note,
  );
  return 0;
}

/* 与 `check-test-it-each.cjs` 同形：只有作为脚本运行才执行并定退出码，
   被 `require` 时（判据自测要进程内调 `readForScan`）不许把宿主进程一起带走。 */
if (require.main === module) {
  process.exit(main());
}

module.exports = { readForScan };
