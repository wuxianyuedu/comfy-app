#!/usr/bin/env node
/**
 * check-patch-coverage.mjs — 「这次 diff 里新增/改动的行有没有被测过」的**读数档**
 * （ISSUE #2687 / 规范 §11.7）。
 *
 * ── 它判什么 ────────────────────────────────────────────────────────────
 *
 * 整体 / 目录级覆盖率门槛撤档之后（ISSUE #2669），覆盖率这一维在 PR 上没有任何会红的
 * 判据；业主给的出路是 **patch coverage** —— 只量「这次 diff 的新增/改动行 ∩ 未被覆盖
 * 的行」。本工具就是那一格的**读数档**：红了要能指到「哪几行没被测」，否则它只是把
 * #2669 那种红换个尺寸。
 *
 * 三条边界（单子明令）：
 *   · **分母口径写死在这里**并被用例钉住：`src/` 下的 `.ts`/`.tsx`，**不含**
 *     测试自身（`.test.`）、声明文件（`.d.ts`）、生成物（`src/generated/`、`docs/api/`）。
 *     行 = 本次 diff 新增/改动的非空非注释行 ∩ lcov 可执行行（`DA:` 条目）——
 *     注释与空行天然不在 DA 里，交点自动剔除。
 *   · **先读数不判红**：默认退 0（哪怕 0%）；`--strict <pct>` 才按阈值判红，
 *     且**没有任何入口默认带它** —— 分母口径还没经业主拍板翻硬闸（§13.5 那批
 *     「先看清存量再清零再升硬闸」的顺序）。
 *   · **不依赖每日全量**：lcov 从哪来由调用方给（受影响链 `COMFY_PATCH_COVERAGE=1`
 *     逐块落 `coverage-patch/`；全量档落 `coverage/`）—— 本工具只读不跑。
 *
 * ── 三态退出码（与 `.githooks` / `base-check.mjs` 同口径）─────────────────
 *
 *   · `0` = 读了且给出读数（哪怕 0%——读数档不判红）；
 *   · `1` = `--strict <pct>` 在场且实覆盖率低于它（唯一会红的形状）；
 *   · `2` = 没跑起来（lcov 读不到 / base 解析不了）—— 「没结论」不许读成「绿」。
 *
 * ── 用法 ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/check-patch-coverage.mjs                       # lcov=coverage/lcov.info，base=origin/master
 *   node scripts/check-patch-coverage.mjs --lcov coverage-patch/0/lcov.info --base origin/master
 *   node scripts/check-patch-coverage.mjs --lcov-dir coverage-patch   # 多块 lcov 合并（逐行取最大命中）
 *   node scripts/check-patch-coverage.mjs --strict 80           # 显式开阈值判红
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { spawnSync } from "node:child_process";

/** 分母口径的**目录/文件排除**（写死在这里 = 口径的唯一出处；用例钉住）。
 *  纯类型/常量模块没法机械识别 —— v8 对它们要么不产 DA 条目（天然出局），要么
 *  逐文件读数里可见，不靠路径猜。 */
const DENOMINATOR_EXCLUDES = [
  /\.test\.(?:ts|tsx)$/, // 测试自己（约定形状 `foo.test.ts`）
  /\.d\.ts$/, // 声明文件
  /^src\/generated\//, // 生成物
  /^docs\/api\//, // 生成物（typedoc）
];

/** 分母口径的**包含**形状：`src/**` 的 ts/tsx（其它根不在 patch 的量程里）。 */
const DENOMINATOR_INCLUDE = /^src\/.+\.tsx?$/;

/**
 * @param {string} rel POSIX 相对路径
 * @returns {boolean} 这份文件在不在 patch 覆盖率的分母里
 */
export function inDenominator(rel) {
  return DENOMINATOR_INCLUDE.test(rel) && !DENOMINATOR_EXCLUDES.some((re) => re.test(rel));
}

/**
 * 一行算不算「值得计入分母的代码行」：空行与纯注释行剔除（v8 的 DA 条目天然不含
 * 它们，但「lcov 整份缺失」那一档没有 DA 可交，只能按行形状兜底 —— 兜底口径
 * 与 DA 交点必须一致，否则同一行在两档下算两样）。
 *
 * @param {string} line
 * @returns {boolean}
 */
function isCodeLine(line) {
  const t = line.trim();
  return t !== "" && !/^(?:\/\/|\/\*|\*|\*\/)/.test(t);
}

/**
 * 解析 `git diff --unified=0` 的输出 → 每份文件的「新增行号 → 行内容」。
 *
 * 只认 hunk 头的 `+c` 侧（格式 `-a,b +c,d`，双 `@` 与方括号是 hunk 头的字面形状，
 * 写在这里会被 checkJs 的 JSDoc 解析当类型表达式 —— TS1003，故拆词）：`b`/`d`
 * 为 0 表示该侧无行；
 * 新增文件（`--- /dev/null`）与修改文件同形处理；被删除的文件没有 `+` 侧 → 自然出局。
 * 行内容留着——「lcov 整份缺失」那一档要按行形状剔注释与空行（有 DA 交点的档由
 * DA 本身剔除，两条口径在 {@link isCodeLine} 汇合）。
 *
 * @param {string} diffText `git diff --no-color --unified=0 <base> HEAD` 的输出
 * @returns {Map<string, Map<number, string>>} POSIX 相对路径 → 新增行号 → 行内容
 */
export function parseChangedLines(diffText) {
  /** @type {Map<string, Map<number, string>>} */
  const out = new Map();
  let file = "";
  /** 新侧下一行的行号（随 hunk 头与每个 diff 行推进）。 */
  let newLine = 0;
  for (const rawLine of diffText.split("\n")) {
    if (rawLine.startsWith("+++ b/")) {
      file = rawLine.slice("+++ b/".length).trim();
      continue;
    }
    if (rawLine.startsWith("+++ ") || rawLine.startsWith("--- ")) {
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(?<newStart>\d+)(?:,(?<count>\d+))? @@/.exec(rawLine);
    if (hunk) {
      newLine = Number(hunk.groups?.newStart ?? 0);
      continue;
    }
    if (file === "") {
      continue;
    }
    if (rawLine.startsWith("+")) {
      let set = out.get(file);
      if (!set) {
        set = new Map();
        out.set(file, set);
      }
      set.set(newLine, rawLine.slice(1));
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith("-") || rawLine.startsWith("\\")) {
      continue;
    }
    // 上下文行：unified=0 下不该出现，出现则两侧同时推进（防御 diff 选项被改）。
    newLine += 1;
  }
  return out;
}

/**
 * 解析 lcov 文本 → 每份文件的「行号 → 命中数」。
 *
 * 只认 `SF:<path>` 与 `DA:<line>,<hits>` 两种记录（BRDA/FN 等不在量程里）。
 * 同一份文件在同一段里多次出现时**后写覆盖先写**（lcov 合并的正确做法是逐行取和，
 * 但这里只判 0 与非 0 —— 由 {@link mergeLcovMaps} 在多份文件之间取最大）。
 *
 * @param {string} lcovText
 * @returns {Map<string, Map<number, number>>}
 */
export function parseLcov(lcovText) {
  /** @type {Map<string, Map<number, number>>} */
  const out = new Map();
  let file = "";
  /** @type {Map<number, number> | null} */
  let lines = null;
  for (const rawLine of lcovText.split("\n")) {
    if (rawLine.startsWith("SF:")) {
      file = rawLine.slice("SF:".length).trim().replaceAll("\\", "/");
      lines = new Map();
      continue;
    }
    if (rawLine.startsWith("end_of_record")) {
      if (file && lines) {
        out.set(file, lines);
      }
      file = "";
      lines = null;
      continue;
    }
    if (rawLine.startsWith("DA:") && lines) {
      const [ln = "", hits = ""] = rawLine.slice("DA:".length).split(",");
      const lineNo = Number(ln);
      if (Number.isFinite(lineNo)) {
        lines.set(lineNo, Number(hits) || 0);
      }
    }
  }
  return out;
}

/**
 * 多份 lcov 合并：同一（文件，行）取**最大命中** —— 各块跑的是不相交的用例集合，
 * 一行被任何一块命中过即算覆盖；取和不取和都行（这里只判 0 与非 0），取最大
 * 不放大读数。
 *
 * @param {Array<Map<string, Map<number, number>>>} maps
 * @returns {Map<string, Map<number, number>>}
 */
export function mergeLcovMaps(maps) {
  /** @type {Map<string, Map<number, number>>} */
  const out = new Map();
  for (const map of maps) {
    for (const [file, lines] of map) {
      let target = out.get(file);
      if (!target) {
        target = new Map();
        out.set(file, target);
      }
      for (const [line, hits] of lines) {
        target.set(line, Math.max(target.get(line) ?? 0, hits));
      }
    }
  }
  return out;
}

/**
 * 核心计算：diff 新增行 ∩ 分母 ∩ lcov → 逐文件读数。
 *
 * 文件**不在** lcov 里（从未被任何用例加载）⇒ 它的改动代码行**全部**算未覆盖 ——
 * 「没进报告」不许长得像「测过了」。有 DA 交点的档：分母 = 代码行 ∩ DA 行
 * （注释与空行天然不在 DA 里，交点自动剔除）。
 *
 * @param {{diffText: string, lcovMaps: Array<Map<string, Map<number, number>>>}} input
 * @returns {{perFile: Array<{file: string, changed: number, uncoveredCount: number, uncoveredLines: Array<number>, missing: boolean}>, total: number, covered: number}}
 */
export function computePatchCoverage({ diffText, lcovMaps }) {
  const changed = parseChangedLines(diffText);
  const lcov = mergeLcovMaps(lcovMaps);
  /** @type {Array<{file: string, changed: number, uncoveredCount: number, uncoveredLines: Array<number>, missing: boolean}>} */
  const perFile = [];
  let total = 0;
  let covered = 0;
  for (const [file, lineMap] of changed) {
    if (!inDenominator(file)) {
      continue;
    }
    const daLines = lcov.get(file);
    const missing = daLines === undefined;
    /** 代码行（非空、非纯注释）——两条口径在 isCodeLine 汇合。 */
    const codeLines = [...lineMap.entries()].filter(([, text]) => isCodeLine(text));
    const denom = missing
      ? codeLines
      : codeLines.filter(([n]) => daLines.has(n));
    const uncoveredLines = missing
      ? codeLines.map(([n]) => n)
      : denom.filter(([n]) => (daLines.get(n) ?? 0) === 0).map(([n]) => n).sort((a, b) => a - b);
    perFile.push({
      file,
      changed: denom.length,
      uncoveredCount: uncoveredLines.length,
      uncoveredLines,
      missing,
    });
    total += denom.length;
    covered += denom.length - uncoveredLines.length;
  }
  perFile.sort((a, b) => b.uncoveredCount - a.uncoveredCount || a.file.localeCompare(b.file));
  return { perFile, total, covered };
}

/**
 * git 三点区间取 diff 文本（cwd 绑定；取不到回 `null` —— 「没结论」与「空」分开）。
 *
 * @param {string} cwd
 * @param {string} baseRef
 * @returns {string | null}
 */
function diffAgainstBase(cwd, baseRef) {
  const mb = spawnSync("git", ["merge-base", baseRef, "HEAD"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const base = mb.status === 0 ? String(mb.stdout ?? "").trim() : "";
  if (base === "") {
    return null;
  }
  const diff = spawnSync("git", ["diff", "--no-color", "--unified=0", base, "HEAD"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return diff.status === 0 ? String(diff.stdout ?? "") : null;
}

/** 输出末 N 行的截断（读数里的行号列表照同一条预算裁）。 */
/** @param {number[]} lines @param {number} [max] */
function clampList(lines, max = 12) {
  const shown = lines.slice(0, max);
  return `${shown.map((n) => `L${n}`).join("、")}${lines.length > max ? ` … 等 ${lines.length} 行` : ""}`;
}

/**
 * @param {string[]} argv
 * @param {string} [cwd]
 * @returns {number} 0 = 读数已产出；1 = --strict 且低于阈值；2 = 没跑起来
 */
export function main(argv, cwd = process.cwd()) {
  /** @param {string} name */
  const valueOf = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const baseRef = valueOf("--base") ?? "origin/master";
  const strictPct = valueOf("--strict") === undefined ? null : Number(valueOf("--strict"));
  const lcovDirArg = valueOf("--lcov-dir");
  const lcovPath = valueOf("--lcov") ?? "coverage/lcov.info";

  /** @type {Array<Map<string, Map<number, number>>>} */
  const lcovMaps = [];
  if (lcovDirArg) {
    /* **递归**收 *.info：受影响链逐块落 coverage-patch/<块号>/ 与 <块号>-retry/
     * （隔离复跑单独一份，判据对多份 lcov 逐行取最大合并 —— 复跑补上的覆盖不丢）。 */
    /** @param {string} dir @returns {string[]} */
    const walk = (dir) => {
      /** @type {string[]} */
      let found = [];
      /** @type {import("node:fs").Dirent[] | undefined} */
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return found;
      }
      for (const e of entries ?? []) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          found = [...found, ...walk(p)];
        } else if (e.name.endsWith(".info")) {
          found.push(p);
        }
      }
      return found;
    };
    const files = walk(path.resolve(cwd, lcovDirArg)).sort();
    if (files.length === 0) {
      process.stderr.write(
        `[patch-coverage] lcov 目录里没有 .info —— 没跑起来（受影响链要带 COMFY_PATCH_COVERAGE=1）。\n`,
      );
      return 2;
    }
    for (const p of files) {
      lcovMaps.push(parseLcov(fs.readFileSync(p, "utf8")));
    }
  } else {
    const p = path.resolve(cwd, lcovPath);
    if (!fs.existsSync(p)) {
      process.stderr.write(
        `[patch-coverage] lcov 读不到（${lcovPath}）—— 没跑起来，不是「没有未覆盖行」。\n` +
          "  产出方：全量档 `pnpm test:coverage`；受影响链 `COMFY_PATCH_COVERAGE=1` 落 coverage-patch/。\n",
      );
      return 2;
    }
    lcovMaps.push(parseLcov(fs.readFileSync(p, "utf8")));
  }

  const diffText = diffAgainstBase(cwd, baseRef);
  if (diffText === null) {
    process.stderr.write(
      `[patch-coverage] base 解析不了（${baseRef} 与 HEAD 的 merge-base）—— 先 fetch 再来，没结论不许读成绿。\n`,
    );
    return 2;
  }

  const { perFile, total, covered } = computePatchCoverage({ diffText, lcovMaps });
  const pct = total === 0 ? null : (covered / total) * 100;
  const missingCount = perFile.filter((f) => f.missing).length;

  process.stdout.write(
    `[patch-coverage] 分母口径：src/** 的 .ts/.tsx（不含 *.test.*、*.d.ts、src/generated、docs/api）；` +
      "行 = 本次 diff 新增/改动的代码行 ∩ lcov 可执行行（DA）\n",
  );
  process.stdout.write(
    `[patch-coverage] 改动文件 ${perFile.length} 份在分母内${
      missingCount > 0 ? `（其中 ${missingCount} 份无覆盖读数——从未被任何用例加载）` : ""
    }；改动代码行 ${total}，已覆盖 ${covered}${pct === null ? "" : ` = ${(pct).toFixed(1)}%`}\n`,
  );
  const offenders = perFile.filter((f) => f.uncoveredCount > 0);
  if (offenders.length === 0) {
    process.stdout.write("[patch-coverage] 这次 diff 的改动行全部有读数且被覆盖。\n");
  } else {
    process.stdout.write(`[patch-coverage] 未覆盖的改动行（按文件，${offenders.length} 份）：\n`);
    for (const f of offenders.slice(0, 20)) {
      process.stdout.write(
        `  · ${f.file}${f.missing ? "（读数缺失——未被加载）" : ""} —— 改动 ${f.changed} 行，未覆盖 ${f.uncoveredCount} 行：` +
          `${clampList(f.uncoveredLines)}\n`,
      );
    }
    if (offenders.length > 20) {
      process.stdout.write(`  … 其余 ${offenders.length - 20} 份同理\n`);
    }
  }
  process.stdout.write(
    `[patch-coverage] 读数档，不判红${strictPct === null ? "；分母口径经业主拍板前不开硬闸，见 #2687" : `（--strict ${strictPct} 在场才判）`}\n`,
  );
  if (strictPct !== null && pct !== null && pct < strictPct) {
    process.stderr.write(
      `[patch-coverage] --strict ${strictPct}：实覆盖 ${(pct).toFixed(1)}% 低于阈值 ⇒ 红。\n`,
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
