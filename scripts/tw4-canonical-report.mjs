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
 *   node scripts/tw4-canonical-report.mjs --write  # 落盘改写（跳过 .snap）
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
const explicit = argv.filter((a) => !a.startsWith("--"));

/** 一批送进 canonicalize 的规模（首次调用要建全量 class list，约 10 秒，之后很快）。 */
const BATCH = 800;
/** 字符串字面量（普通串与模板串；模板串里的 `${…}` 作为普通片段保留）。 */
const STRING_LITERAL = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
/** 粗筛：像类名的 token 才值得问引擎（省掉把散文喂进去）。 */
const MAYBE_CLASS = /^[a-zA-Z!@][\w-]*(?::[^\s:]+)*[!/\[\]().,%#-]*$/;

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

const files =
  explicit.length > 0
    ? explicit.map((f) => path.resolve(ROOT, f))
    : [...walk(SRC)];

/** token → 命中处 */
const occurrences = new Map();
for (const file of files) {
  const isSnapshot = file.endsWith(".snap");
  for (const match of read(file).matchAll(STRING_LITERAL)) {
    for (const token of match[2].split(/\s+/)) {
      if (!token || !MAYBE_CLASS.test(token)) continue;
      const hits = occurrences.get(token) ?? [];
      hits.push({ file, snapshot: isSnapshot });
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
/** 一条建议 = 一个 raw，连同它的命中处。 */
const suggestions = [...canonical.entries()].map(([raw, to]) => {
  const hits = occurrences.get(raw);
  return {
    raw,
    to,
    count: hits.length,
    snapshots: hits.filter((h) => h.snapshot).length,
    files: [...new Set(hits.map((h) => h.file))],
  };
});

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
    suggestions.flatMap((s) => s.files).filter((f) => !f.endsWith(".snap")),
  );
  for (const file of targets) if (rewriteFile(file)) changed += 1;
  console.error(
    `已改写 ${changed} 个文件；快照（${suggestions.reduce((n, s) => n + s.snapshots, 0)} 处）` +
      "需另跑 vitest -u 重生成。",
  );
}

if (asJson) {
  console.log(
    JSON.stringify(
      {
        scannedFiles: files.length,
        candidates: tokens.length,
        suggestions: suggestions
          .map(({ raw, to, count, snapshots, files: f }) => ({
            raw,
            to,
            count,
            snapshots,
            files: f.map((x) => path.relative(ROOT, x)),
          }))
          .sort((a, b) => b.count - a.count),
      },
      null,
      2,
    ),
  );
} else {
  const sorted = [...suggestions].sort((a, b) => b.count - a.count);
  const total = sorted.reduce((n, s) => n + s.count, 0);
  console.log(
    `扫描 ${files.length} 个文件 / ${tokens.length} 个唯一候选 → ` +
      `${sorted.length} 条 canonical 建议，共 ${total} 处\n`,
  );
  for (const s of sorted) {
    console.log(
      `  ${String(s.count).padStart(4)} 处  ${s.raw}  →  ${s.to}` +
        (s.snapshots ? `（含快照 ${s.snapshots} 处）` : ""),
    );
  }
  console.log("\n按文件：");
  for (const s of sorted) {
    console.log(`  ${s.files.length} 个文件：${s.raw} → ${s.to}`);
    for (const f of s.files) console.log(`      ${path.relative(ROOT, f)}`);
  }
}
