#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:`ctx.task.meta` 写下的数据**有读的人在**(供 .githooks/pre-commit 调用)
/**
 * `ctx.task.meta` 写下的东西，必须有人从 JSON 报告里读 —— 规范见
 * docs/standards/11-测试与可观测性.md §11.22。
 *
 * 为什么要有这条判据（ISSUE #1485 收尾轮）：`task.meta` 是本仓库盘点 vitest 5
 * 新能力时**最后一条**。它和相邻那两条（`expectTypeOf` §11.20 / `annotate` §11.21）
 * 的关键差别是一条实测出来的事实：
 *
 * ── 它是**唯一**能从 CLI 那侧读到的通道 ──────────────────────────────────
 *
 * 实测（vitest 5.0.3，`--reporter=default --reporter=json --outputFile=…`）：
 *
 *   · 自定义键原样落进报告：`{"tier":"artifact"}` / `{"baselineRed":"别线"}`
 *   · **绿的用例也带 meta**（`annotate` 只有失败时才可见，§11.21.1 ③）
 *   · 两个 reporter 可以同时给：人读的 text 输出照旧，机器读的那份另存
 *
 * 对照 `annotate`：`--reporter=json` 的产物里既无顶层 `annotations`、
 * `assertionResults[].meta` 也空；唯一读数通道是 programmatic API
 * （`createVitest()`），与门禁链的 CLI spawn 天然不兼容。
 * 所以「要往报告里塞机器可读的事实」这件事，本仓库**只有 `task.meta` 能做**。
 *
 * ── 那为什么仍然要判「有没有消费方」 ──────────────────────────────────────
 *
 * 因为它的**可见性也是隐式的**：门禁链跑 vitest 的参数是
 * `node <vitest入口> run --maxWorkers=4 <files…>`（`run-affected-tests.mjs`），
 * **没有 `--reporter=json`、没有 `--outputFile`**。也就是说：
 *
 *   写 `ctx.task.meta.xxx = …` 而没有人带 `--reporter=json` 去跑 ——
 *   那些数据落进**空气**，一个字都不会被任何人看见，而表面上代码写得像
 *   「已经登记了」。这与 §11.13.1 / §11.18.3.1 / §11.21.3 是同一族：
 *   **判据在场 ≠ 判据在跑** —— 这次「判据」是一份写进 task 的元数据。
 *
 * ── 判据 ──────────────────────────────────────────────────────────────
 *
 * 只做一件事：**有站点就必须登记消费方**（`scripts/.task-meta-consumers.json`），
 * 且消费方那一条要写明「哪个脚本、怎么读」（读的前提是按 §11.22.2 带
 * `--reporter=json --outputFile`）。
 *
 *   · 零站点（本仓库当前状态）→ 通过，本判据是纯闸门；
 *   · 有站点 + 无消费方 → 阻断。
 *
 * **刻意不判**「该不该用 `task.meta`」：那是收益判断，要实测。
 * **也刻意不做**「运行时真去读一遍 JSON 报告」的判据：那要在钩子档再起一次 vitest
 * 并落一份报告文件，代价与收益不成比例（同 §11.21.3 的取舍）。
 *
 * 用法：
 *   node scripts/check-task-meta-consumer.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-task-meta-consumer.cjs --report   # 只出清单不判失败（盘点用）
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

/** 台账：谁在读 JSON 报告里的 `meta`。 */
const LEDGER = "scripts/.task-meta-consumers.json";

/**
 * `task.meta` 的**写**站点。三种形态都要认：
 *   · `ctx.task.meta.x = …`   / `context.task.meta.x = …`  —— 用例上下文（正常形态）；
 *   · `task.meta.x = …`                                    —— programmatic 那一侧；
 *   · `ctx.task.meta` 整体赋值。
 *
 * 认的是 `task.meta` 这个**属性链**（而不是 `meta` 单独一词）：`meta` 在本仓库
 * 另有大量无关用法（`<meta>`、`meta.name`、`{ meta: … }` 里那种），
 * 只认 `task\.meta` 这条链能把误报压到零 —— 而误报的判据活不过一次评审（§11.18.4）。
 */
const TASK_META_SITE_RE = /(?<![\w.$])(?:\w+\s*\.\s*)?task\s*\.\s*meta\b/g;

/**
 * 把**不是代码**的区间挖掉（换成等长空格，保持偏移）：行注释、块注释、
 * 单/双引号字符串、模板串。
 *
 * 为什么要挖：本判据自己的自测（`tests/task-meta-consumer-gate.test.ts`）里
 * 写着**夹具字符串**，里面就有 `ctx.task.meta.x = …` —— 不挖字符串，判据就会去判
 * 自己的夹具（同族先例：`tests/comment-language.test.ts` 里那份
 * `"// @vitest-environment jsdom"`，把 ISSUE #1485 那轮的文件计数从 183 数成了 185）。
 *
 * 刻意**不处理正则字面量**：少挖一段的代价只是漏报，而漏报是可接受的方向
 * （§11.17.4 / §11.18.3.1 / §11.21 同一条教训）。
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

/** 枚举扫描面：消失的目录/文件由 `gate-scan-read.cjs` 降级，读取侧的计数在 `main`。 */
function walk(dir) {
  return walkForScan(dir, TEST_FILE_RE);
}

/**
 * 读台账。**缺失 / 解析失败一律抛**（由调用方判失败）。
 *
 * ⚠️ 「缺失」与「解析失败」同等对待，这一条是补出来的 —— 原先写的是
 * `if (!fs.existsSync(abs)) return null`，把「文件不在」静默退回成「没有台账」，
 * 而判据零站点时在那之前就 return 了、根本走不到这里：表现是全绿，绿的却是
 * 「台账压根不存在」。这正是本判据要拦的形状（§11.23「声明 ⇄ 读者」）。
 * 纯闸门的「零站点通过」必须由**台账在场、只是没内容**来说。
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
  } catch (error) {
    throw new Error(`解析 ${LEDGER} 失败：${error.message}`, { cause: error });
  }
  if (!Array.isArray(json?.consumers)) {
    throw new Error(`${LEDGER} 的 \`consumers\` 不是数组（形状不在预期内）`);
  }
  return json.consumers;
}

/**
 * 扫一份文件，返回它命中 `task.meta` 的行号（1 起）；文件在「列目录 → 读内容」之间
 * 消失时返回 `null`（两种消失窗口与「只降级 ENOENT、不许静默」的口径都在
 * `gate-scan-read.cjs`，这里不重述）。
 *
 * @param {string} abs
 * @returns {number[] | null}
 */
function scanFile(abs) {
  const raw = readForScan(abs);
  if (raw === null) {
    return null;
  }
  const masked = maskNonCode(raw);
  const hitLines = [];
  for (const m of masked.matchAll(TASK_META_SITE_RE)) {
    hitLines.push(masked.slice(0, m.index).split("\n").length);
  }
  return hitLines;
}

function main() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const sites = [];
  let vanished = 0;
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const hitLines = scanFile(abs);
    if (hitLines === null) {
      vanished += 1;
      continue;
    }
    for (const line of hitLines) {
      sites.push({ rel, line });
    }
  }
  /* 消失数必须进结论：它等于「这几份文件这一轮没被读过」。 */
  const note = vanishedNote(vanished);

  /* 台账先读、哪怕零站点：`readLedger()` 缺失即抛，于是「零站点通过」这个结论
     由「台账在、只是没内容」担保，而不是由「台账根本没有」担保
     （原先零站点直接 return 0，台账从没被碰过 —— §11.23 那个形状）。 */
  let consumers;
  try {
    consumers = readLedger();
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    return 1;
  }

  if (sites.length === 0) {
    console.log(
      `[task-meta] OK —— 0 处 \`task.meta\` 站点` +
        `（本判据是纯闸门：对象是「下一次有人往报告里塞事实」；台账在场，${consumers.length} 条登记）。${
        note}`,
    );
    return 0;
  }

  if (consumers === null || consumers.length === 0) {
    console.error(
      `${REPORT_ONLY
        ? `[task-meta] 盘点：${sites.length} 处站点、无消费方登记（--report 不判失败）`
        : `[ERROR] 有 ${sites.length} 处 \`task.meta\` 站点，但 ${LEDGER} 里没有消费方`}：\n`,
    );
    for (const s of sites) {
      console.error(`  · ${s.rel}:${s.line}`);
    }
    console.error(
      `\n\`task.meta\` 是**唯一**能从 CLI 那侧读到的通道（实测自定义键原样落进\n` +
        `\`--reporter=json\` 的报告、绿的用例也带），但门禁链跑 vitest 的参数里\n` +
        `**没有** \`--reporter=json\`、没有 \`--outputFile\` —— 也就是说：\n` +
        `写了 \`ctx.task.meta.x = …\` 而没有人带那两个参数去跑，这些数据落进**空气**，\n` +
        `一个字都不会被任何人看见，而表面上代码写得像「已经登记了」。\n` +
        `修法二选一：\n  · 登记消费方：在 ${LEDGER} 的 \`consumers\` 里写明谁读、怎么读；\n` +
        `  · 或者不写这条元数据 —— 当前没有消费方时它只是写着好看的字段。\n` +
        `口径见 docs/standards/11-测试与可观测性.md §11.22。${
        note}`,
    );
    return REPORT_ONLY ? 0 : 1;
  }

  console.log(
    `[task-meta] OK —— ${sites.length} 处 \`task.meta\` 站点，消费方 ${consumers.length} 条登记。${
      note}`,
  );
  return 0;
}

/* 只有作为脚本运行才执行并定退出码；被 `require` 时（判据自测要进程内调
   `scanFile`）不许把宿主进程一起带走。 */
if (require.main === module) {
  process.exit(main());
}

module.exports = { scanFile };
