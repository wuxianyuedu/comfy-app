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
 * 结果记在 `scripts/.code-duplication-baseline.json`(棘轮，只许降不许升)：
 *   · 出现基线外的新孪生对 → 阻断；
 *   · 存量孪生对被修掉 → 提示收紧基线(--strict 下也阻断，与其它棘轮同口径)。
 *
 * 用法:
 *   node scripts/check-code-duplication.cjs           # 检查(棘轮)
 *   node scripts/check-code-duplication.cjs --strict  # 基线未收紧也失败(CI 用)
 *   node scripts/check-code-duplication.cjs --update  # 重写基线(须伴随下降)
 *   node scripts/check-code-duplication.cjs --report  # 只出清单不判失败(盘点用)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, ".code-duplication-baseline.json");
const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const REPORT_ONLY = ARGS.has("--report");

/** 扫描范围：应用源码。 */
const SCAN_DIR = "src";
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

/** 测试/快照不算重复源：用例之间大量雷同是正常的。 */
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) || /\.snap$/.test(rel) || rel.includes("/__tests__/");

/** 归一化：去首尾空白；丢掉空行与整行注释(缩进/注释差异不构成差异)。 */
function normalizedLines(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t === "*/") continue;
    out.push(t);
  }
  return out;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const relOf = (p) =>
  p.split(path.sep).join("/").replace(ROOT.split(path.sep).join("/") + "/", "");

/* ── 采集 ────────────────────────────────────────────────── */

const files = [];
for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const rel = relOf(abs);
  if (!SOURCE_EXT.test(rel) || rel.endsWith(".d.ts")) continue;
  if (isTestFile(rel)) continue;
  const lines = normalizedLines(fs.readFileSync(abs, "utf8"));
  if (lines.length < MIN_LINES) continue;
  files.push({ rel, lines, set: new Set(lines) });
}

/** 一对文件的重合判据：以行数少的那个为基准 —— 比例要回答的是「小的那半
 *  有多少能在大的那半找到」，而不是反过来(否则 5000 行的文件会被 200 行吸收)。 */
function similarity(a, b) {
  const [small, big] = a.lines.length <= b.lines.length ? [a, b] : [b, a];
  let hit = 0;
  for (const line of small.lines) if (big.set.has(line)) hit++;
  return { ratio: hit / small.lines.length, hits: hit, total: small.lines.length };
}

const twins = [];
for (let i = 0; i < files.length; i++) {
  for (let j = i + 1; j < files.length; j++) {
    const { ratio, hits, total } = similarity(files[i], files[j]);
    if (ratio < MIN_SIMILARITY) continue;
    const pair = [files[i].rel, files[j].rel].sort();
    twins.push({ a: pair[0], b: pair[1], ratio, hits, total });
  }
}
twins.sort((x, y) => y.ratio - x.ratio || (x.a + x.b).localeCompare(y.a + y.b));

const key = (t) => `${t.a} ⇄ ${t.b}`;
const current = Object.fromEntries(
  twins.map((t) => [key(t), { ratio: Number(t.ratio.toFixed(3)), hits: t.hits, total: t.total }]),
);

/* ── 报告 / 棘轮 ────────────────────────────────────────── */

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

const prev = fs.existsSync(BASELINE)
  ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
  : null;
const prevPairs = prev?.pairs ?? null;

if (UPDATE) {
  const before = prevPairs ? Object.keys(prevPairs).length : 0;
  const after = Object.keys(current).length;
  if (prevPairs && after > before) {
    console.error(
      `[duplication] 拒绝放宽基线：${before} → ${after} 对孪生（棘轮只许下降）。\n` +
        "  新增重复必须先抽共享模块，不要用 --update 掩盖。",
    );
    process.exit(1);
  }
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        note:
          "跨文件孪生对（≥" + MIN_LINES + " 行、逐行重合 ≥" + MIN_SIMILARITY * 100 + "%）。" +
          "棘轮只许下降：新增孪生对须先把共享逻辑抽到一处，再收紧基线。",
        pairs: current,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`[duplication] 基线已更新：${before} → ${after} 对（scripts/.code-duplication-baseline.json）`);
  process.exit(0);
}

if (!prevPairs) {
  console.error(
    "[duplication] 基线文件缺失：先执行 node scripts/check-code-duplication.cjs --update",
  );
  process.exit(1);
}

const added = twins.filter((t) => !(key(t) in prevPairs));
const fixed = Object.keys(prevPairs).filter((k) => !(k in current));

console.log(
  `[duplication] 扫描 ${files.length} 个文件（≥${MIN_LINES} 行）；` +
    `孪生对 ${twins.length} 对（基线 ${Object.keys(prevPairs).length} 对）`,
);

if (added.length) {
  console.error(
    "[duplication] 基线外新增孪生对（跨文件重复，规范 §12.12）：\n" +
      added.map(listLine).join("\n") +
      "\n  判据：两份实现逐行重合 ≥" +
      MIN_SIMILARITY * 100 +
      "%。修法是把共享逻辑抽到一个模块（两份各自只留自己的差异），\n" +
      "  而不是「两边一起改」。若确认是巧合，请调高阈值或把文件登记进豁免清单。",
  );
  process.exit(1);
}

if (fixed.length) {
  const msg =
    `[duplication] ${fixed.length} 对孪生已被消除（治理有进展）：\n` +
    fixed.map((k) => `  · ${k}`).join("\n") +
    "\n  建议执行 node scripts/check-code-duplication.cjs --update 收紧基线。";
  if (STRICT) {
    console.error(msg + "\n  --strict 模式：未收紧基线即失败。");
    process.exit(1);
  }
  console.log(msg);
}

console.log("[duplication] OK");
