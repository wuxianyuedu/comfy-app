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
 *   node scripts/tw4-canonical-report.mjs --check  # 硬闸判定：源文件候选数须为 0
 *   node scripts/tw4-canonical-report.mjs --write  # 落盘改写（跳过 .snap）
 *
 * 判定档（ISSUE #1451 要求 2 / ISSUE #1811）：本工具起 Tailwind 引擎、单次约 6s，
 * **不进 pre-commit**（判的是「CSS 等价改写」而非正确性），但 03 章那句「新增一批
 * 视图文件后按需跑一次」此前**没有任何东西在守** —— 实测 storybook 那批一次性带进
 * 96 处 `w-[30rem]`，直到手工跑才浮出来。出路 = 保留按需跑，但把「按需」变成
 * **有判据的**：源文件（测试文件不计，它们的候选是人判断的负样本）的候选数须为
 * **0**，`--check` 命中即退 1。
 *
 * **为什么是硬闸而不是棘轮**：本判据此前带一份基线（`scripts/.tw4-canonical-baseline.json`），
 * `--check` 只判「不超过基线」、`--update` 收紧。存量清零后（ISSUE #1811 的 tw4 项：
 * 一条工具侧的注释误报由 `tw4-scan-core.mjs` 的注释剥离修掉，一条真改写落在
 * `AppShell.tsx`）棘轮的两个动作都无事可做，留下的却是一条「手改那份 JSON 就能把新
 * 候选登记成已知存量」的通道 —— 那正是硬闸类本来没有的中间态（§13.6.2 的两类对照）。
 * 判据口径与扫描面一字未动，只把「有存量、逐批治理」那一层皮收掉。
 * 执行者与「为什么不进钩子」登记在 `scripts/.gate-executor-ledger.json`。
 *
 * 快照只统计不写入：类名一改，`prettier-plugin-tailwindcss` 的排序位置会跟着变，
 * 字符串替换同步不了，必须由 `vitest -u` 重生成。
 */
import fs from "node:fs";
import path from "node:path";

import { __unstable__loadDesignSystem } from "tailwindcss";

import { rewriteLiterals, stringLiterals } from "./tw4-scan-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const shouldWrite = argv.includes("--write");
const withTests = argv.includes("--with-tests");
const shouldCheck = argv.includes("--check");
const explicit = argv.filter((a) => !a.startsWith("--"));

/* JS/TS 的字符串字面量一律走 `tw4-scan-core.mjs` 的 `stringLiterals()` —— 它先在
 * **注释之外**扫描（注释里用反引号引的示例与 className 同形，不剥会让 `--check`
 * 报出不存在的候选、`--write` 去改注释）。下面这条正则只剩一个用途：`.css` / `.snap`
 * 不是 JS，没有注释语法可剥，直接按字面量粗取。 */
const LITERAL_IN_NON_JS = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
/** 粗筛：像类名的 token 才值得问引擎（省掉把散文喂进去）。
 *
 *  注意别把字符类写窄：早先写成「尾部只允许 `! / [ ] ( ) . , % # -`」时，
 * `translate-y-[-1px]` 这种**带单位的任意值**（尾部有 `px` 的字母）会被整条丢掉，
 * 于是报告说 0 条、真机上编辑器却在提示。判据宁可宽、不可漏。 */
const MAYBE_CLASS = /^[a-zA-Z!@][^\s"'`]*$/;

/** 一份样式表：Tailwind 引擎的 `loadStylesheet` 回调要还的东西（三件都是它的形状要求）。
 * @typedef {object} StyleFile
 * @property {string} path
 * @property {string} base
 * @property {string} content
 */

/** 一个类名 token 的**一处**命中。
 *
 * 建这个形状的唯一理由不是「给 tsc 交代」：`occurrences` 的 value 在四个消费点
 * （`--write`、报告、判定档、孤儿计数）上各读不同字段，过去靠隐式 any 把它们串起来，
 * 于是「把 `snapshot` 写成 `isSnapshot`」这类错要到运行时才炸。
 * @typedef {object} Hit
 * @property {string} file 命中所在文件（绝对路径）
 * @property {boolean} snapshot 落在 `.snap` 快照里（要 `vitest -u` 才同步）
 * @property {boolean} orphan 快照且没有同名测试文件（改了没有任何用例兜底）
 * @property {boolean} test 落在测试文件里（`--write` 默认不碰）
 */

/** 一条改写建议 = 一个 raw → 一个 canonical，连同它的命中统计。
 * @typedef {object} Suggestion
 * @property {string} raw
 * @property {string} to
 * @property {number} count 源文件里的处数（测试与孤儿快照都不算）
 * @property {number} inTests
 * @property {number} snapshots
 * @property {string[]} files 全部命中文件
 * @property {string[]} sourceFiles 非测试命中文件（`--write` 的默认目标）
 * @property {string[]} testFiles
 */

/** @param {string} file @returns {string} */
function read(file) {
  return fs.readFileSync(file, "utf8");
}

/** @param {string} file @returns {StyleFile} */
function readStyle(file) {
  return { path: file, base: path.dirname(file), content: read(file) };
}

/**
 * `__unstable__loadDesignSystem` 的回调：把 `@import` 的说明符落到真实文件。
 *
 * @param {string} id
 * @param {string} base
 * @returns {Promise<StyleFile>}
 */
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

/**
 * 递归列出 `dir` 下会被扫的文件（`.ts` / `.tsx` / `.css` / `.snap`）。
 *
 * 返回类型必须**写出来**：生成器递归 `yield* walk(full)` 让 tsc 无法自推
 * （TS7023「隐式 any 因为被自己的返回表达式引用」），而它给出的不是「加注解」
 * 而是「这里有个环」—— 环是真的，注解是唯一不改变行为的解。
 * @param {string} dir
 * @returns {Generator<string>}
 */
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (/\.tsx?$|\.css$|\.snap$/.test(entry.name)) {
      yield full;
    }
  }
}

/** 测试文件：里面的类名多数是**断言样本**，而负样本改了就把判据改坏了 ——
 *  真踩过：`parseZClass("z-[200]")` 本是「解析器不认任意值写法」的样本，被批量
 *  改成 `z-200` 后，同一个文件里另一行又期望 `z-200` 被解析成 200，断言自相矛盾。
 *  所以 `--write` 默认不碰测试文件（报告里单列），确认过要同步再加 `--with-tests`。
 *  @param {string} file
 *  @returns {boolean} */
const isTestFile = (file) => /\.(test|spec)\.tsx?$|__tests__[\\/]/.test(file);

const files = explicit.length > 0 ? explicit.map((f) => path.resolve(ROOT, f)) : [...walk(SRC)];

/** token → 命中处
 * @type {Map<string, Hit[]>} */
const occurrences = new Map();
/** 孤儿快照：没有同名测试文件，vitest 永远不会校验它（改了也没有用例兜底）。 */
const orphanSnapshots = new Set();
for (const file of files) {
  const isSnapshot = file.endsWith(".snap");
  const isOrphan = isSnapshot && !fs.existsSync(file.replace(/\.snap$/, ""));
  if (isOrphan) {
    orphanSnapshots.add(file);
  }
  /* 注释剥离只对 JS/TS 源文件成立：`.css` / `.snap` 里的 `//` 不是注释语法，
   * 剥它等于把真的内容吞掉（快照里更可能逐字记着一段输出）。 */
  const literals = /\.tsx?$/.test(file)
    ? stringLiterals(read(file))
    : [...read(file).matchAll(LITERAL_IN_NON_JS)].map((m) => ({
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- 正则捕获组在不参与匹配时运行时为 undefined
        content: m[2] ?? "",
      }));
  for (const match of literals) {
    for (const token of match.content.split(/\s+/)) {
      if (!token || !MAYBE_CLASS.test(token)) {
        continue;
      }
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
/** raw → canonical
 * @type {Map<string, string>} */
const canonical = new Map();
const startedAt = Date.now();
let done = 0;
for (const token of tokens) {
  const [value] = ds.canonicalizeCandidates([token]);
  if (value && value !== token) {
    canonical.set(token, value);
  }
  done += 1;
  if (done % 2000 === 0) {
    const per = (Date.now() - startedAt) / done;
    console.error(
      `  …${done}/${tokens.length}（${per.toFixed(1)}ms/个，余 ${Math.round(((tokens.length - done) * per) / 1000)}s）`,
    );
  }
}
console.error(`canonicalize 用时 ${Math.round((Date.now() - startedAt) / 1000)}s`);
/** 一条建议 = 一个 raw，连同它的命中处（孤儿快照里的不算：无人校验，改了也没用例兜底）。 */
let orphanHits = 0;
/** @type {Suggestion[]} */
const suggestions = [];
for (const [raw, to] of canonical) {
  /* 取一次而不是两次：`canonical` 的键必然是 `occurrences` 键的子集（它就是从这里
   * 逐个问出来的），但类型上看不出来 —— 第二次 `.get(raw)` 在 `Hit[] | undefined`
   * 上点 `.length` 就是要 tsc 替我信这件事。`?? []` 让「真取不到」退化成
   * 「0 处 → continue」，与原行为同一形（原来那一句会 TypeError）。 */
  const all = occurrences.get(raw) ?? [];
  const hits = all.filter((h) => !h.orphan);
  orphanHits += all.length - hits.length;
  if (hits.length === 0) {
    continue;
  }
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
  /** 只动字符串字面量内、且整 token 相等的出现处。
   * @param {string} file
   * @returns {boolean} 有没有真的改写（0 处时不落盘） */
  const rewriteFile = (file) => {
    const before = read(file);
    /* 走共享内核：注释里的示例不会被改写（`--write` 只动真会被应用的类名）。 */
    const { text: after, changed } = rewriteLiterals(before, (content) => {
      const pieces = content.split(/(\s+)/);
      let hit = false;
      for (let i = 0; i < pieces.length; i += 2) {
        /* 取出来再判：`pieces[i]` 在 noUncheckedIndexedAccess 下是 `string | undefined`，
         * 循环界保证它不是 undefined，但那是**我**知道的不是**类型**知道的 ——
         * 直接 `canonical.get(pieces[i])` 会新冒一格 TS2345（本批实测就是这么现出来的）。 */
        const piece = pieces[i];
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- 守卫为 noUncheckedIndexedAccess 收窄服务（上方注释已记），oxlint 的类型解析不含该开关
        if (piece === undefined) {
          continue;
        }
        const to = canonical.get(piece);
        if (!to) {
          continue;
        }
        pieces[i] = to;
        hit = true;
      }
      return hit ? pieces.join("") : null;
    });
    if (changed === 0) {
      return false;
    }
    fs.writeFileSync(file, after);
    return true;
  };
  let changed = 0;
  const targets = new Set(
    suggestions
      .flatMap((s) => (withTests ? s.files : s.sourceFiles))
      .filter((f) => !f.endsWith(".snap")),
  );
  for (const file of targets) {
    if (rewriteFile(file)) {
      changed += 1;
    }
  }
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
      `  ${String(s.count).padStart(4)} 处  ${s.raw}  →  ${s.to}${s.snapshots ? `（含快照 ${s.snapshots} 处）` : ""}`,
    );
  }
  const testRows = sorted.filter((s) => s.inTests > 0);
  if (testRows.length > 0) {
    console.log(
      "\n测试文件里（--write 默认不改：正样本要同步、负样本改了会把判据改坏，得人判断）：",
    );
    for (const s of testRows) {
      console.log(`  ${String(s.inTests).padStart(4)} 处  ${s.raw}  →  ${s.to}`);
      for (const f of s.testFiles) {
        console.log(`        ${path.relative(ROOT, f)}`);
      }
    }
  }
  console.log("\n按文件：");
  for (const s of sorted) {
    console.log(`  ${s.files.length} 个文件：${s.raw} → ${s.to}`);
    for (const f of s.files) {
      console.log(`      ${path.relative(ROOT, f)}`);
    }
  }
}

/* ── 判定档（--check）：源文件候选数须为 0 ───────────────────────────────
 *
 * 计数口径 = **按源文件**（测试文件里的候选不计：`--write` 默认不碰它们，它们多数
 * 是断言样本，改了会把判据改坏，得人逐处判 —— 把它们计进判定等于让「人判断」变成
 * 「机器冻结」，方向反了）。孤儿快照同样排除，与原报告口径一致。
 *
 * 硬闸形态（ISSUE #1811）：不再有基线、不再有 `--update`，命中即退 1。清零后的
 * 自证靠**默认档**（不带 flag 的那次报告）—— 见文件头那条：`--check` 的「0 处」
 * 必须能被默认档的清单复现，否则「一个永远扫不到东西的判据」也会全绿。 */

/** 源文件侧的候选：`{文件 → 处数}`。默认档那次的报告与判定用的是同一份。
 * @type {Record<string, number>} */
const current = {};
for (const s of suggestions) {
  for (const f of s.sourceFiles) {
    const rel = path.relative(ROOT, f);
    current[rel] = (current[rel] ?? 0) + 1;
  }
}
const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);

if (shouldCheck) {
  if (currentTotal > 0) {
    console.error(`canonical 候选 硬闸：源文件里有 ${currentTotal} 处可改成规范写法（须为 0）\n`);
    for (const [rel, n] of Object.entries(current).sort((a, b) => b[1] - a[1])) {
      console.error(`  ✗ ${rel}：${n} 处`);
    }
    console.error(
      `\n修法：node scripts/tw4-canonical-report.mjs --write 落盘改写` +
        `（测试文件里的候选另判 —— 正样本要同步、负样本改了会把判据改坏，加 --with-tests 前自己先看清）。`,
    );
    process.exit(1);
  }
  console.log("canonical 候选 硬闸：源文件 0 处 ✓");
  process.exit(0);
}
