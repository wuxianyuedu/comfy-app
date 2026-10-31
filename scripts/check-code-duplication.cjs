#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:跨文件重复块扫描(供 .githooks/pre-commit 与 CI 调用)
/**
 * 跨文件重复块扫描 —— 规范见 docs/standards/12-代码组织与文件结构.md §12.12。
 *
 * 背景(ISSUE #536 P2，真实事故)：
 * `lib/workshop/api-channel.server.ts` 与 `server/workshop/api-channel.ts` 是
 * 同一套能力的两个入口，第二个文件的注释大大方方写着「复刻第一个的生图/视频
 * 能力」—— 按行做一一对应统计，B 文件 **153/182 行(84%)** 在 A 中能找到对应。
 * 这不是「看起来有点像」，是**协议实现被复制了一份**：生图请求体、超时、错误
 * 文案、URL/任务 id 提取全都各存一份，以后改生图协议要改两处，漏一处就是
 * **静默行为分叉**(两个入口对同一上游发出不同请求，而没有任何门禁看得见)。
 *
 * 为什么不能只靠「看」：重复代码在 review 里是最容易被放行的东西 —— 单看每一
 * 份都「没毛病」，只有把两份并排比较才发现它们是同一段。所以这里把它机器化。
 *
 * 判定口径(v1，刻意保守，宁漏不误报)：
 *   ① 只扫 `src/**` 的 .ts/.tsx(不含测试/快照)；
 *   ② 逐行归一化(去首尾空白；跳过空行与整行注释)—— 缩进/注释差异不算差异；
 *   ③ 对每一对文件求「B 的每一行是否在 A 里出现过」的比例(集合式，不比顺序)；
 *   ④ 比例超过阈值且**两个文件都够大**(行数 ≥ 阈值下限)才算一对孪生。
 * 集合式口径的好处是零误报(不会因为「碰巧有 20 行相同」就报)；代价是它只
 * 认得出「整份复制」而认不出「局部大段复制」。后者交给阈值更低的 v2，
 * 现在先把历史上真实发生过的这一档堵住。
 *
 * ## 为什么是硬闸而不是棘轮
 *
 * 本判据此前是**棘轮**：孪生对记进 `scripts/.code-duplication-baseline.json`，
 * `--update` 收紧、`--strict` 要求下降。但实到今天是 **0 对孪生**——基线
 * `pairs: {}`，而棘轮在归零后只剩开销：`--update` 无事可做，基线文件却仍是一条
 * 「手改就能把新孪生对登记成已知存量」的通道 —— 那正是硬闸类**本来没有**的中间态。
 * 判据口径与阈值一字未改，只把「有存量、逐批治理」那一层皮收掉：
 * **新增一对孪生即阻断**，修法只有「抽共享模块」一条。
 *
 * 用法:
 *   node scripts/check-code-duplication.cjs           # 检查(硬闸:命中即退 1)
 *   node scripts/check-code-duplication.cjs --report  # 只出清单不判失败(盘点用)
 *   --staged(钩子用)仅当暂存改动落在扫描面(`src/**`)内才扫，口径见 §13.5.8.2
 */
const fs = require("node:fs");
const path = require("node:path");
const { skipUnlessStagedTouches } = require("./gate-scan-read.cjs");
const { gateFail, gatePass } = require("./ci-log.mjs");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const STAGED = ARGS.has("--staged");

/** 扫描范围：应用源码。 */
const SCAN_DIR = "src";

if (STAGED && !REPORT_ONLY) {
  skipUnlessStagedTouches({ roots: [SCAN_DIR], tag: "[duplication]" });
}
const SOURCE_EXT = /\.(ts|tsx)$/;

/** 判据阈值。
 *
 *  · `MIN_LINES` —— 参与比较的文件至少这么大。5 行的工具文件「全都一样」
 *    没有意义，避免小文件互刷比例。
 *  · `MIN_SIMILARITY` —— 逐行对应比例。0.75 是「明显是同一份实现」的档位：
 *    重构过的孪生(加了适配器注入、改了入参类型)仍落在 0.75~0.9 之间，而
 *    「碰巧都用 zod 校验」这类结构相似只有 0.2~0.3。 */
const MIN_LINES = 60;
const MIN_SIMILARITY = 0.75;

/** 测试/快照不算重复源：用例之间大量雷同是正常的。
 *
 * 这是一条**口径**，不是疏漏（ISSUE #2173 把它问了一遍，答案在这里）：本判据按
 * **整文件**算重合（≥60 行、≥75%），所以它要回答的是「同一份实现被整篇抄了一遍」；
 * 而用例之间「结构像、断言不同」是常态，把它们放进面只会得到一堆要人逐个豁免的噪音
 * （§12.18 那条「别为『该不该通用』写启发式扫描器」的同一条理由）。
 *
 * 代价当场量过一次（放宽成「src+tests 且**包含**测试文件」）：新报 3 对 ——
 * `annotate-consumer-gate` / `task-meta-consumer-gate` / `test-todo-gate` 三份门禁用例
 * 互 0.84~0.89；而 #2173 点名的那五份契约测试**一对都不报**，因为它们真正同形的只有
 * 十来行的 mock 样板，摊进两百行的文件里远够不到 75%。
 * ⇒ 结论：**块级样板不是这一层能抓的东西**。那种重复的出路是抽共享实现体
 * （`tests/helpers/wire-mock-boundary.ts` 就是那次抽的），不是把本判据的根扩到 tests/。
 * 记在这里而不是记成 bug，是因为放宽的方向与上面的读数是反的。
 * 顺带一条容易被那句「盲区在 tests/ 目录」的说法盖掉的事实：这条排除按**文件名**判，
 * 所以 `src/` 里那几百份 `.test.ts` 与快照同样不在面上。
 */
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) || /\.snap$/.test(rel) || rel.includes("/__tests__/");

/** 归一化：去首尾空白；丢掉空行与整行注释(缩进/注释差异不构成差异)。 */
function normalizedLines(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!t) {
      continue;
    }
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t === "*/") {
      continue;
    }
    out.push(t);
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") {
        continue;
      }
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

const relOf = (p) =>
  p
    .split(path.sep)
    .join("/")
    .replace(ROOT.split(path.sep).join("/") + "/", "");

/* ── 采集 ────────────────────────────────────────────────── */

const files = [];
for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const rel = relOf(abs);
  if (!SOURCE_EXT.test(rel) || rel.endsWith(".d.ts")) {
    continue;
  }
  if (isTestFile(rel)) {
    continue;
  }
  const lines = normalizedLines(fs.readFileSync(abs, "utf8"));
  if (lines.length < MIN_LINES) {
    continue;
  }
  files.push({ rel, lines, set: new Set(lines) });
}

/** 一对文件的重合判据：以行数少的那个为基准 —— 比例要回答的是「小的那半
 *  有多少能在大的那半找到」，而不是反过来(否则 5000 行的文件会被 200 行吸收)。 */
function similarity(a, b) {
  const [small, big] = a.lines.length <= b.lines.length ? [a, b] : [b, a];
  let hit = 0;
  for (const line of small.lines) {
    if (big.set.has(line)) {
      hit++;
    }
  }
  return {
    ratio: hit / small.lines.length,
    hits: hit,
    total: small.lines.length,
  };
}

const twins = [];
for (let i = 0; i < files.length; i++) {
  for (let j = i + 1; j < files.length; j++) {
    const { ratio, hits, total } = similarity(files[i], files[j]);
    if (ratio < MIN_SIMILARITY) {
      continue;
    }
    const pair = [files[i].rel, files[j].rel].sort();
    twins.push({ a: pair[0], b: pair[1], ratio, hits, total });
  }
}
twins.sort((x, y) => y.ratio - x.ratio || (x.a + x.b).localeCompare(y.a + y.b));

/* ── 报告 / 判定 ────────────────────────────────────────── */

const listLine = (t) =>
  `  · ${t.a}\n    ⇄ ${t.b}\n    ${(t.ratio * 100).toFixed(1)}%（${t.hits}/${t.total} 行可对应）`;

if (REPORT_ONLY) {
  console.log(
    `[duplication] 扫描 ${files.length} 个文件（≥${MIN_LINES} 行），相似度 ≥${MIN_SIMILARITY * 100}% 的孪生对：`,
  );
  console.log(twins.length ? twins.map(listLine).join("\n") : "  （无）");
  console.log("[duplication] --report 模式：只出清单，不判失败 ✓");
  process.exit(0);
}

if (twins.length) {
  gateFail("跨文件重复块", twins.map(listLine), {
    subject: "src/**",
    detail: `${twins.length} 对跨文件孪生（逐行重合 ≥${MIN_SIMILARITY * 100}%，§12.12）`,
    hint:
      "修法是把共享逻辑抽到一个模块（两份各自只留自己的差异），而不是「两边一起改」。\n" +
      "共享内核里不许放任何一侧的传输层代码（§18.4）。\n" +
      "本判据是硬闸（无基线、无 --update）：孪生对的存量已清零，新增一对即阻断。",
  });
  process.exit(1);
}

gatePass("跨文件重复块", `${files.length} 个文件（≥${MIN_LINES} 行）无孪生对`, {
  subject: "src/**",
});
