#!/usr/bin/env node
// @ts-nocheck -- bundle size budget（供 pnpm build 收尾与 pnpm check:bundle 调用）
/**
 * bundle size budget —— 规范见 docs/standards/13-提交与-code-review.md §13.5.4。
 *
 * 立案现场（ISSUE #1781，从 #1777「性能优化」清单里分出来的真缺口）：
 * 清单原文写的是「在 CI 里加 bundle size budget」。**方向对，但本仓没有 CI**
 * （`.cnb.yml` 随 ISSUE #623 删除，`tests/no-platform-ci-config.test.ts` 守着它不许回来）
 * —— 于是这条判据的落点不是「阈值定多少」，而是「挂在哪、谁来跑」。
 *
 * 本仓选定的形态是 **B + C**：
 *   · **B（按需档）**：`pnpm check:bundle` —— 明确入口，不进每次提交；
 *   · **C（产物层兜底）**：挂在 `pnpm build` 收尾 —— 构建已经发生，不额外买成本。
 * 形态的完整论证（含「为什么不进 pre-commit」）见 §13.5.4。
 *
 * ── 测量口径（ISSUE 第 2 问那四条，逐条有实测答案）────────────────────
 *
 * 1. **测哪个数**：`.next/static/chunks` 下所有 client chunk 的 **gzip 后字节数之和**，
 *    外加**文件数**。ISSUE 给的另一候选（`app-build-manifest.json` 的每路由 chunk 集合）
 *    在**当前 Next 版本上已经不存在** —— `.next/` 下根本没有这个文件，最接近的
 *    `build-manifest.json` 也已空心化（`pages` 只剩一条空 `/_app`）。所以「按路由量」
 *    当前没有数据源，口径没得选。
 *    两档读数都记：**文件数比总量更敏感** —— 新依赖会被 Turbopack 拆成上百个 chunk，
 *    这个信号比总量更早（实测 shiki 探针：gzip +49.6% 的同一次，文件数 +193）。
 * 2. **抖动怎么判**：**按 basename 对齐、不用 `BUILD_ID` 路径**。Turbopack 的 chunk 名是
 *    内容哈希，且实测三次构建（热 / 热 / 冷，删过 `.next/cache`）**gzip 总计一个字节都不差、
 *    同名字节差异 0**。唯一会变的是 `.next/static/<BUILD_ID>/` 下那 3 个 manifest（随机
 *    目录名），它们合计 gzip 0.5 KB、占比 0.02% —— 且**不在本判据的测量面内**
 *    （只量 `chunks/`），所以判据不会抖。
 * 3. **放哪个基准**：与 `scripts/.file-size-baseline.json` 那批棘轮同构 —— 独立一份
 *    `scripts/.bundle-budget-baseline.json`，头部记 raw/gzip/文件数三个实测初值。
 * 4. **新依赖怎么算**：预算是**棘轮**（只许降不许升）。加一个大依赖会当场红，这是想要的
 *    （正是防劣化）；例外流程是**在 PR 里贴 before/after 两档读数 + 说明为什么值这个体积**，
 *    由评审确认后 `--update` 抬高基线 —— 见 §13.5.4 的例外流程那一节。
 *
 * ── 与 `analyze-bundle.mjs` 的分工 ───────────────────────────────
 *
 * 那份起 `@next/bundle-analyzer`（**强制 `--webpack`**）生成 HTML 报告给人看，退出码恒 0
 * ——「有人看才有用」。本判据是**机器判定档**，量的是**默认构建链（Turbopack）**的产物，
 * 两件事不混：`--webpack` 的产物形状与 Turbopack 不同，**别拿一边的读数去比另一边**。
 *
 * 用法：
 *   node scripts/check-bundle-budget.cjs            # 检查（棘轮：只许降不许升）
 *   node scripts/check-bundle-budget.cjs --update   # 治理/评审确认后重写基线（须伴随下降，
 *                                                   #   除非带 --allow-increase + 理由）
 *   node scripts/check-bundle-budget.cjs --report   # 只出清单，不判失败（盘点用）
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
const ALLOW_INCREASE = ARGS.has("--allow-increase");
const BASELINE = path.join(__dirname, ".bundle-budget-baseline.json");

/**
 * 测量面：`next build` 产出的 client chunk 目录（Turbopack 默认链）。
 *
 * 只量 `chunks/`，**不量** `.next/static/<BUILD_ID>/` 那三个 manifest ——
 * 后者的路径里带随机 BUILD_ID，且它们是 0.5 KB 量级的固定三件，进预算只会引入抖动。
 */
const CHUNKS_DIR = path.join(ROOT, ".next", "static", "chunks");

/** 只数 `.js`（chunk 的可执行形态）—— 排除 `.map` 一类旁产物，避免两份同源数据双计。 */
const CHUNK_EXT = /\.js$/;

/**
 * 扫描面的下限 —— 静默降级的地板。
 *
 * 「产物不存在」是**正常**的（本脚本守的是构建结果，不是构建本身，同
 * `check-standalone-contents.cjs`：没构建过就跳过）。但「目录在、里面文件少到不可能」
 * 是另一回事：它意味着我们量错了目录（或构建形态变了），此时给绿灯就是一条恒绿的判据。
 */
const MIN_CHUNKS = 20;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/**
 * 量当前产物：文件数 / raw 字节 / gzip 字节，外加**按 basename 对齐**的逐文件账。
 *
 * 逐文件账（basename → 字节数）是抖动口径的落点（见文件头第 2 条）：chunk 名是内容
 * 哈希，所以「同内容 → 同名」；构建之间唯一会变的是文件名集合里那三个 manifest，
 * 而它们不在本测量面内。
 *
 * @returns {{files: number, raw: number, gzip: number, entries: Record<string, {raw:number,gzip:number}>}}
 */
function measure() {
  const files = walk(CHUNKS_DIR).filter((f) => CHUNK_EXT.test(f));
  /** @type {Record<string, {raw:number,gzip:number}>} */
  const entries = {};
  let raw = 0;
  let gzip = 0;
  for (const abs of files) {
    const buf = fs.readFileSync(abs);
    /* basename 而不是相对路径：将来 chunks/ 若分区（子目录），同名的两份内容才是同一份
     * 内容的延续 —— 这条与「按内容哈希对齐」是同一个意图。 */
    const name = path.basename(abs);
    const gz = zlib.gzipSync(buf).length;
    entries[name] = { raw: buf.length, gzip: gz };
    raw += buf.length;
    gzip += gz;
  }
  return { files: files.length, raw, gzip, entries };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

function writeBaseline(m, note) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note:
      note ??
      "client chunk 体积预算（规范 §13.5.4，ISSUE #1781）。棘轮只许下降；" +
        "抬高基线必须在 PR 里贴 before/after 两档读数 + 说明为什么值这个体积（例外流程）。",
    metric: {
      scope: ".next/static/chunks（Turbopack 默认构建链，只数 .js）",
      raw: m.raw,
      gzip: m.gzip,
      files: m.files,
    },
    entries: m.entries,
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
}

/** 人类可读的字节（KB，一位小数）—— 输出里两档都打，便于贴进 PR。 */
function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

/** 汇总一处差异（新增 / 变大 / 消失），供 --update 的拒涨与检查输出的公共部分用。 */
function diffEntries(cur, base) {
  const added = [];
  const grown = [];
  const shrunk = [];
  const removed = [];
  for (const [name, v] of Object.entries(cur.entries)) {
    const b = base.entries?.[name];
    if (!b) added.push([name, v]);
    else if (v.gzip > b.gzip) grown.push([name, b.gzip, v.gzip]);
  }
  for (const [name, b] of Object.entries(base.entries ?? {})) {
    const v = cur.entries[name];
    if (!v) removed.push([name, b]);
    else if (v.gzip < b.gzip) shrunk.push([name, b.gzip, v.gzip]);
  }
  return { added, grown, shrunk, removed };
}

function main() {
  if (!fs.existsSync(CHUNKS_DIR)) {
    /* 产物不存在 ⇒ **跳过并不报错**（同 check-standalone-contents.cjs）。本判据守的是
     * 构建结果，不是构建本身；`.next` 都没构建过时给红会把「没构建」读成「体积超标」。 */
    console.log(
      "[bundle-budget] 跳过：.next/static/chunks 不存在（还没跑过 next build）—— " +
        "本判据守的是构建结果，不是构建本身。",
    );
    return 0;
  }

  const now = measure();
  if (now.files < MIN_CHUNKS) {
    console.error(
      `[bundle-budget] ✗ 测量面退化：.next/static/chunks 只有 ${now.files} 个 .js，` +
        `低于下限 ${MIN_CHUNKS} —— 我们量错目录了（或构建形态变了），给绿灯等于一条恒绿的判据。`,
    );
    return 1;
  }

  const base = readBaseline();
  const line = `[bundle-budget] 当前：文件数 ${now.files} · raw ${kb(now.raw)} · gzip ${kb(now.gzip)}`;

  if (REPORT_ONLY) {
    console.log(line);
    if (base) {
      console.log(
        `  基线：文件数 ${base.metric.files} · raw ${kb(base.metric.raw)} · gzip ${kb(base.metric.gzip)}` +
          `（生成于 ${base.generatedAt}）`,
      );
    } else {
      console.log("  基线：不存在（先跑 --update 落一份实测初值）");
    }
    console.log("[bundle-budget] --report 模式：只出清单，不判失败 ✓");
    return 0;
  }

  if (UPDATE) {
    const before = base?.metric;
    const grew = before && now.gzip > before.gzip;
    const moreFiles = before && now.files > before.files;
    /* 拒涨：与 check-overlay-z.cjs / check-file-structure.cjs 那批棘轮同口径 ——
     * 「--update 只许降」。例外流程（加依赖）必须显式带 --allow-increase，逼出一个
     * 「有人在 PR 里认过账」的动作，而不是让 --update 默默把预算抬高。 */
    if (before && (grew || moreFiles) && !ALLOW_INCREASE) {
      console.error(
        `[bundle-budget] 拒绝抬高基线：gzip ${kb(before.gzip)} → ${kb(now.gzip)}、` +
          `文件数 ${before.files} → ${now.files}（棘轮只许下降）。\n` +
          "  新增依赖若确实是想要的，请在 PR 里贴 before/after 两档读数 + 说明为什么值这个体积，" +
          "评审确认后带 --allow-increase 重跑（规范 §13.5.4 的例外流程）。",
      );
      return 1;
    }
    writeBaseline(now);
    console.log(
      `[bundle-budget] 基线已更新（${path.relative(ROOT, BASELINE)}）：` +
        `${before ? `gzip ${kb(before.gzip)} → ${kb(now.gzip)}、文件数 ${before.files} → ` : ""}` +
        `${now.files}${ALLOW_INCREASE && before ? "（--allow-increase：已认过账）" : ""}`,
    );
    return 0;
  }

  if (!base) {
    console.error(
      "[bundle-budget] 基线文件缺失：先执行 node scripts/check-bundle-budget.cjs --update",
    );
    return 1;
  }

  const { added, grown } = diffEntries(now, base);
  const problems = [];
  if (now.gzip > base.metric.gzip) {
    problems.push(
      `gzip 总量上升：${kb(base.metric.gzip)} → ${kb(now.gzip)}（+${kb(now.gzip - base.metric.gzip)}）`,
    );
  }
  if (now.files > base.metric.files) {
    problems.push(
      `chunk 文件数上升：${base.metric.files} → ${now.files}（+${now.files - base.metric.files}）`,
    );
  }

  console.log(line);
  console.log(
    `  基线：文件数 ${base.metric.files} · raw ${kb(base.metric.raw)} · gzip ${kb(base.metric.gzip)}` +
      `（生成于 ${base.generatedAt}）`,
  );

  if (problems.length) {
    console.error("[bundle-budget] 违规（阻断）：\n  " + problems.join("\n  "));
    if (added.length) {
      console.error(`  新增 chunk ${added.length} 个，最大的 5 个：`);
      for (const [name, v] of added
        .sort((a, b) => b[1].gzip - a[1].gzip)
        .slice(0, 5)) {
        console.error(`    · ${name}（gzip ${kb(v.gzip)}）`);
      }
    }
    if (grown.length) {
      console.error(`  变大的 chunk ${grown.length} 个，增幅最大的 5 个：`);
      for (const [name, b, v] of grown
        .sort((a, b) => b[2] - b[1] - (a[2] - a[1]))
        .slice(0, 5)) {
        console.error(`    · ${name}（gzip ${kb(b)} → ${kb(v)}）`);
      }
    }
    console.error(
      "  规范见 docs/standards/13-提交与-code-review.md §13.5.4；\n" +
        "  这是预算、不是禁令：确认这个体积值得，就在 PR 里贴 before/after 两档读数 + 说明，" +
        "评审确认后带 --allow-increase 重跑 --update；否则先把它压回去。",
    );
    return 1;
  }

  console.log("[bundle-budget] ✓ 在预算内（棘轮只许下降，未收紧只提示）");
  return 0;
}

process.exit(main());
