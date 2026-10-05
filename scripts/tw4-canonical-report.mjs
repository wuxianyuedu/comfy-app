#!/usr/bin/env node
/**
 * 全仓 Tailwind canonical 警告**汇总**（默认只读；`--write` 才落盘）。
 *
 * 判据与编辑器（`tailwindcss-language-server` 的 `suggestCanonicalClasses`）**同源**：
 * 直接调 design system 的 `canonicalizeCandidates` —— 它对每个类名回答「有没有另一
 * 种写法生成完全相同的 CSS」。因此 `!bg-subtle` → `bg-subtle!`、`break-words` →
 * `wrap-break-word`、`flex-shrink` → `shrink`、`overflow-ellipsis` → `text-ellipsis`、
 * `bg-gradient-to-r` → `bg-linear-to-r` 都会被认出来，而 `text-[13px]`（走
 * font-size、没有等价替代）不会。
 *
 * 为什么不自己维护「前缀 → 规范写法」对照表：那张表一漂就会改错量纲；这里
 * 「相不相同」由引擎判定，判据不会过期。
 *
 * 覆盖不到的一类：`[22px]` 这类**任意值**与 spacing 倍数的等价（`h-[22px]` 的 CSS
 * 是字面量 `22px`，`h-5.5` 是 `calc(var(--spacing) * 5.5)`，不逐字相同，引擎不认）。
 * 那一类由 `scripts/tw4-spacing-canonical.mjs` 负责，两者互补。
 *
 * 用法：
 *   node scripts/tw4-canonical-report.mjs          # 汇总（按建议排序）
 *   node scripts/tw4-canonical-report.mjs --json   # 机器可读
 *   node scripts/tw4-canonical-report.mjs --check  # 棘轮判定：源文件候选数不许超过基线
 *   node scripts/tw4-canonical-report.mjs --update # 治理后重写基线（须伴随下降）
 *   node scripts/tw4-canonical-report.mjs --write  # 落盘改写（跳过 .snap）
 *
 * 棘轮（ISSUE #1451 要求 2）：本工具起 Tailwind 引擎、单次约 6s，**不进 pre-commit**
 * （判的是「CSS 等价改写」而非正确性），但 03 章那句「新增一批视图文件后按需跑一次」
 * 此前**没有任何东西在守** —— 实测 storybook 那批一次性带进 96 处 `w-[30rem]`，
 * 直到手工跑才浮出来。出路 = 保留按需跑，但把「按需」变成**有判据的**：源文件
 * （测试文件不计，它们的候选是人判断的负样本）的候选总数冻结在
 * `scripts/.tw4-canonical-baseline.json`，`--check` 时只许降不许升。
 * 执行者与「为什么不进钩子」登记在 `scripts/.gate-executor-ledger.json`。
 *
 * 快照只统计不写入：类名一改，`prettier-plugin-tailwindcss` 的排序位置会跟着变，
 * 字符串替换同步不了，必须由 `vitest -u` 重生成。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { __unstable__loadDesignSystem } from "tailwindcss";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const shouldWrite = argv.includes("--write");
const withTests = argv.includes("--with-tests");
const shouldCheck = argv.includes("--check");
const shouldUpdate = argv.includes("--update");
const explicit = argv.filter((a) => !a.startsWith("--"));
const BASELINE = path.join(ROOT, "scripts", ".tw4-canonical-baseline.json");

/** 一批送进 canonicalize 的规模（首次调用要建全量 class list，约 10 秒，之后很快）。 */
const BATCH = 800;
/** 字符串字面量（普通串与模板串；模板串里的 `${…}` 作为普通片段保留）。 */
const STRING_LITERAL = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
/** 粗筛：像类名的 token 才值得问引擎（省掉把散文喂进去）。
 *
 *  注意别把字符类写窄：早先写成「尾部只允许 `! / [ ] ( ) . , % # -`」时，
 * `translate-y-[-1px]` 这种**带单位的任意值**（尾部有 `px` 的字母）会被整条丢掉，
 * 于是报告说 0 条、真机上编辑器却在提示。判据宁可宽、不可漏。 */
const MAYBE_CLASS = /^[a-zA-Z!@][^\s"'`]*$/;

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readStyle(file) {
  return { path: file, base: path.dirname(file), content: read(file) };
}

async function loadStylesheet(id, base) {
  const file =
    id === "tailwindcss"
      ? path.join(ROOT, "node_modules", "tailwindcss", "index.css")
      : path.resolve(base, id);
  return readStyle(file);
}

const globals = read(path.join(SRC, "app", "globals.css"));
if (/--spacing\s*:/.test(globals)) {
  throw new Error(
    "项目主题重定义了 --spacing：本工具的等价判据基于 Tailwind 默认 spacing，请先确认换算关系。",
  );
}

const ds = await __unstable__loadDesignSystem('@import "tailwindcss";', {
  base: ROOT,
  loadStylesheet,
});

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.tsx?$|\.css$|\.snap$/.test(entry.name)) yield full;
  }
}

/** 测试文件：里面的类名多数是**断言样本**，而负样本改了就把判据改坏了 ——
 *  真踩过：`parseZClass("z-[200]")` 本是「解析器不认任意值写法」的样本，被批量
 *  改成 `z-200` 后，同一个文件里另一行又期望 `z-200` 被解析成 200，断言自相矛盾。
 *  所以 `--write` 默认不碰测试文件（报告里单列），确认过要同步再加 `--with-tests`。 */
const isTestFile = (file) => /\.(test|spec)\.tsx?$|__tests__[\\/]/.test(file);

const files =
  explicit.length > 0
    ? explicit.map((f) => path.resolve(ROOT, f))
    : [...walk(SRC)];

/** token → 命中处 */
const occurrences = new Map();
/** 孤儿快照：没有同名测试文件，vitest 永远不会校验它（改了也没有用例兜底）。 */
const orphanSnapshots = new Set();
for (const file of files) {
  const isSnapshot = file.endsWith(".snap");
  const isOrphan = isSnapshot && !fs.existsSync(file.replace(/\.snap$/, ""));
  if (isOrphan) orphanSnapshots.add(file);
  for (const match of read(file).matchAll(STRING_LITERAL)) {
    for (const token of match[2].split(/\s+/)) {
      if (!token || !MAYBE_CLASS.test(token)) continue;
      const hits = occurrences.get(token) ?? [];
      hits.push({
        file,
        snapshot: isSnapshot,
        orphan: isOrphan,
        test: isTestFile(file),
      });
      occurrences.set(token, hits);
    }
  }
}

const tokens = [...occurrences.keys()];

/** raw → canonical。
 *
 *  逐个问而不是批量：`canonicalizeCandidates` 批量返回的数组与输入**不是逐位对应**
 *  （同一批里出现重复写法时它会重排），按索引 zip 会把 `I2V` 配成 `bg()` 这种
 *  凭空建议 —— 那正是「拿返回顺序当对应关系」踩出来的。 */
const canonical = new Map();
const startedAt = Date.now();
let done = 0;
for (const token of tokens) {
  const [value] = ds.canonicalizeCandidates([token]);
  if (value && value !== token) canonical.set(token, value);
  done += 1;
  if (done % 2000 === 0) {
    const per = (Date.now() - startedAt) / done;
    console.error(
      `  …${done}/${tokens.length}（${per.toFixed(1)}ms/个，余 ${Math.round(((tokens.length - done) * per) / 1000)}s）`,
    );
  }
}
console.error(
  `canonicalize 用时 ${Math.round((Date.now() - startedAt) / 1000)}s`,
);
/** 一条建议 = 一个 raw，连同它的命中处（孤儿快照里的不算：无人校验，改了也没用例兜底）。 */
let orphanHits = 0;
const suggestions = [];
for (const [raw, to] of canonical) {
  const hits = occurrences.get(raw).filter((h) => !h.orphan);
  orphanHits += occurrences.get(raw).length - hits.length;
  if (hits.length === 0) continue;
  const inTests = hits.filter((h) => h.test);
  suggestions.push({
    raw,
    to,
    count: hits.length - inTests.length,
    inTests: inTests.length,
    snapshots: hits.filter((h) => h.snapshot).length,
    files: [...new Set(hits.map((h) => h.file))],
    sourceFiles: [...new Set(hits.filter((h) => !h.test).map((h) => h.file))],
    testFiles: [...new Set(inTests.map((h) => h.file))],
  });
}

if (shouldWrite) {
  /** 只动字符串字面量内、且整 token 相等的出现处。 */
  const rewriteFile = (file) => {
    const before = read(file);
    const after = before.replace(STRING_LITERAL, (full, quote, content) => {
      const pieces = content.split(/(\s+)/);
      let changed = false;
      for (let i = 0; i < pieces.length; i += 2) {
        const to = canonical.get(pieces[i]);
        if (!to) continue;
        pieces[i] = to;
        changed = true;
      }
      return changed ? quote + pieces.join("") + quote : full;
    });
    if (after !== before) fs.writeFileSync(file, after);
    return after !== before;
  };
  let changed = 0;
  const targets = new Set(
    suggestions
      .flatMap((s) => (withTests ? s.files : s.sourceFiles))
      .filter((f) => !f.endsWith(".snap")),
  );
  for (const file of targets) if (rewriteFile(file)) changed += 1;
  console.error(
    `已改写 ${changed} 个文件；快照（${suggestions.reduce((n, s) => n + s.snapshots, 0)} 处）` +
      "需另跑 vitest -u 重生成。",
  );
  if (!withTests && suggestions.some((s) => s.inTests > 0)) {
    console.error(
      `测试文件里还有 ${suggestions.reduce((n, s) => n + s.inTests, 0)} 处未改` +
        "（--with-tests 才写）：正样本要同步、负样本改了会把判据改坏，得人判断。",
    );
  }
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        scannedFiles: files.length,
        candidates: tokens.length,
        suggestions: suggestions
          .map((s) => ({
            raw: s.raw,
            to: s.to,
            count: s.count,
            inTests: s.inTests,
            snapshots: s.snapshots,
            files: s.sourceFiles.map((x) => path.relative(ROOT, x)),
            testFiles: s.testFiles.map((x) => path.relative(ROOT, x)),
          }))
          .sort((a, b) => b.count - a.count),
      },
      null,
      2,
    ),
  );
} else {
  const sorted = [...suggestions].sort((a, b) => b.count - a.count);
  const mainRows = sorted.filter((s) => s.count > 0);
  const total = mainRows.reduce((n, s) => n + s.count, 0);
  console.log(
    `扫描 ${files.length} 个文件 / ${tokens.length} 个唯一候选 → ` +
      `${mainRows.length} 条 canonical 建议，共 ${total} 处\n`,
  );
  if (orphanSnapshots.size > 0) {
    console.log(
      `跳过孤儿快照 ${orphanSnapshots.size} 个（没有同名测试文件，任何用例都不会校验它，` +
        `改它没有用例兜底）：${[...orphanSnapshots].map((f) => path.relative(ROOT, f)).join("、")}` +
        ` —— 里面还有 ${orphanHits} 处\n`,
    );
  }
  for (const s of mainRows) {
    console.log(
      `  ${String(s.count).padStart(4)} 处  ${s.raw}  →  ${s.to}` +
        (s.snapshots ? `（含快照 ${s.snapshots} 处）` : ""),
    );
  }
  const testRows = sorted.filter((s) => s.inTests > 0);
  if (testRows.length > 0) {
    console.log(
      "\n测试文件里（--write 默认不改：正样本要同步、负样本改了会把判据改坏，得人判断）：",
    );
    for (const s of testRows) {
      console.log(
        `  ${String(s.inTests).padStart(4)} 处  ${s.raw}  →  ${s.to}`,
      );
      for (const f of s.testFiles)
        console.log(`        ${path.relative(ROOT, f)}`);
    }
  }
  console.log("\n按文件：");
  for (const s of sorted) {
    console.log(`  ${s.files.length} 个文件：${s.raw} → ${s.to}`);
    for (const f of s.files) console.log(`      ${path.relative(ROOT, f)}`);
  }
}

/* ── 棘轮（--check / --update）：源文件候选总数只许降不许升 ─────────────
 *
 * 记账口径 = **按源文件**（测试文件里的候选不进基线：`--write` 默认不碰它们，
 * 它们多数是断言样本，改了会把判据改坏，得人逐处判 —— 把它们计进基线等于
 * 让「人判断」变成「机器冻结」，方向反了）。
 * 之所以按候选**处数**记账而不是按 raw 种类：一处 raw 换文件、换数量都该被看见，
 * 而「零候选起步」的语义正是「任何新增都红」。
 * 排除孤儿快照与测试文件的命中，与原报告口径一致。 */

if (shouldUpdate) {
  const ledger = {};
  let total = 0;
  for (const s of suggestions) {
    for (const f of s.sourceFiles) {
      const rel = path.relative(ROOT, f);
      ledger[rel] = (ledger[rel] ?? 0) + 1;
      total += 1;
    }
  }
  const data = { total, files: ledger };
  fs.writeFileSync(BASELINE, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`棘轮基线已重写：${path.relative(ROOT, BASELINE)}（total ${total}）`);
  process.exit(0);
}

if (shouldCheck) {
  /** @type {{total: number, files: Record<string, number>}} */
  const base = fs.existsSync(BASELINE)
    ? JSON.parse(read(BASELINE))
    : { total: 0, files: {} };
  const current = {};
  for (const s of suggestions) {
    for (const f of s.sourceFiles) {
      const rel = path.relative(ROOT, f);
      current[rel] = (current[rel] ?? 0) + 1;
    }
  }
  const over = [];
  for (const [rel, n] of Object.entries(current)) {
    const allowed = base.files[rel] ?? 0;
    if (n > allowed) over.push(`${rel}：${n} 处（基线 ${allowed}）`);
  }
  const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);
  if (over.length > 0 || currentTotal > base.total) {
    console.log(
      `canonical 候选棘轮：源文件候选 ${currentTotal} 处 > 基线 ${base.total} 处\n`,
    );
    for (const line of over) console.log(`  ✗ ${line}`);
    console.log(
      `\n修法：node scripts/tw4-canonical-report.mjs --write 落盘改写（测试文件另判），` +
        `再 node scripts/tw4-canonical-report.mjs --update 收紧基线。` +
        `别为了让 --check 变绿去放宽基线 —— 棘轮是给「回潮就响」用的。`,
    );
    process.exit(1);
  }
  console.log(
    `canonical 候选棘轮：源文件候选 ${currentTotal} 处 ≤ 基线 ${base.total} 处 ✓` +
      (currentTotal < base.total ? `（比基线少 ${base.total - currentTotal} 处，可跑 --update 收紧）` : ""),
  );
  process.exit(0);
}
