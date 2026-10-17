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
 * ── 判定依据：总量（gzip / 文件数），逐文件账只作诊断 ──────────────────
 *
 * **判定只看两个总量（gzip / 文件数）**，不比逐文件账 —— 三个结构量都量、都打，
 * 但只有这两个参与判定：**gzip 才是「用户要下载多少」**，raw 是磁盘/内存形态，
 * 存在「raw 涨、gzip 不涨」的形态（往文件末尾塞可压缩的重复内容），判红只会制造误报。
 *
 * 判定的理由是一条实测（ISSUE #1781 的第二轮）：
 *
 * Turbopack 的 chunk 名是**内容哈希**，源码不变则名不变 —— 同环境连续两次构建、
 * 乃至 `rm -rf .next` 后的全冷构建，215 个 chunk 的文件名与 sha256 **全部一致**。
 * 所以「同内容换名」在本仓**从未被观测到**：名字不是易抖的旁支信息，它就是内容本身。
 *
 * 于是逐文件对账的唯一效果是**在基线过期时产出一串无法复核的行**：源码动过之后，
 * 旧名字既不在新产物里、又没有留下可对照的内容，读者拿到的「新增 N 个 / 变大 M 个」
 * 既推不出「谁真的变大了」，也推不出「哪个是换名」。而**总量那一档仍然是对的**
 * —— 它给的才是判据该说的话：「涨了 1074 字节」。
 *
 * 逐文件账**没有删**，但它降级为**诊断输出**（`--report` 与判红时的提示）：用
 * `sha256` 把两侧对齐，能对上的是「同一份内容换名」（不算变化），对不上的才是
 * 「新增内容」或「真变大」。判定不由它下。
 *
 * ── 测量口径（ISSUE 第 2 问那四条，逐条有实测答案）────────────────────
 *
 * 1. **测哪个数**：`.next/static/chunks` 下所有 client chunk 的 **gzip 后字节数之和**，
 *    外加 **raw 总量**与**文件数**。ISSUE 给的另一候选（`app-build-manifest.json` 的每路由
 *    chunk 集合）在**当前 Next 版本上已经不存在** —— `.next/` 下根本没有这个文件，最接近的
 *    `build-manifest.json` 也已空心化（`pages` 只剩一条空 `/_app`）。所以「按路由量」
 *    当前没有数据源，口径没得选。
 * 2. **抖动怎么判**：**不用判** —— 实测同环境三次构建（热 / 热 / 冷，含 `rm -rf .next`）
 *    逐字节一致（含文件名）。基线是**实测初值**，不是估的；它不抖，所以不需要抖动缓冲。
 * 3. **放哪个基准**：与 `scripts/.file-size-baseline.json` 那批棘轮同构 —— 独立一份
 *    `scripts/.bundle-budget-baseline.json`，**只存 raw / gzip / 文件数三个结构量**
 *    （逐文件内容指纹不进基线：那会让基线体积随 chunk 数线性膨胀，而判定并不读它）。
 * 4. **新依赖怎么算**：预算是**棘轮**（只许降不许升）。加一个大依赖会当场红，这是想要的
 *    （正是防劣化）；例外流程是**在 PR 里贴 before/after 两档读数 + 说明为什么值这个体积**，
 *    由评审确认后 `--update --allow-increase` 抬高基线 —— 见 §13.5.4 的例外流程那一节。
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
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

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
 * 后者的路径里带随机 BUILD_ID，且它们是 0.5 KB 量级的固定三件，进预算只会引入噪声。
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

/**
 * 取当前 HEAD 的修订号，写进基线供「这次读数取自哪一版源码」用。
 *
 * 它记的是**基线那一刻的源码修订号**，于是判红时能回答一个此前只能猜的问题
 * ——「涨的这点体积，是不是基线之后那几次改动换来的」。（`check-file-structure.cjs`
 * 那套同名的机制已随 R5 棘轮在 ISSUE #1811 下线；本条是独立实现、不受影响，
 * 「按行数记账的棘轮要自带修订号」这条口径留在规范 §12.13.3 的最后两段。）
 *
 * git 不可用 / 不在检出里时返回 `null`：那不构成判据，只是少一句归因。
 */
function headRev() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout.trim() || null;
}

/** 修订号的形状 —— 归因与校验都只认这一种（`--update` 写进去的必须是 40 位十六进制）。 */
const REV_SHAPE = /^[0-9a-f]{40}$/;

/**
 * 基线里那条 `baselineRev` 到底能不能用来归因（**三档，不许合并**）。
 *
 * 为什么要把「取不到」拆成两句话（ISSUE #1988 的现场，也是 §12.13.3 留给
 * 「下一个做按行数记账的棘轮的人」那条的第二句）：`null` 与「记了一个检出里
 * 不存在的提交」都只说成「取不到」，于是读者拿到的动作是一句
 * 「重跑一次 --update」—— 而对**基线过期**那一档，那恰恰是最容易做错的动作：
 * 不先分清涨的这点体积该不该认就重记基线，等于把一次劣化记账放行。
 * 两档的下一步完全不同，所以输出也必须不同。
 *
 * @returns {{kind: "recorded", rev: string} | {kind: "missing"} | {kind: "stale"}}
 */
function baselineRevState(rev) {
  if (!rev || !REV_SHAPE.test(String(rev))) return { kind: "missing" };
  const res = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
    encoding: "utf8",
  });
  /* 不可达 / 不是本检出的仓库 ⇒ 这一档是「基线过期」（ISSUE #653 的原话：
   * 修订号通常是分支提交，合入后不再有 ref 指向，`git gc` 之后一律查不到）。 */
  return res.status === 0
    ? { kind: "recorded", rev: String(rev) }
    : { kind: "stale" };
}

/**
 * 本检出的 HEAD 是不是一个**合并提交**（父提交 > 1）。
 *
 * 为什么要单开这一档：合并提交的 `HEAD` 是**这一版的祖先里没有**的提交 —— 索引里那份
 * 基线是哪一侧的数、还是解冲突时手写的，判据读不出来。此时若再套用「就是本检出的
 * HEAD」那句，归因会从「量不出」滑成「这批读数取自未提交的改动」—— 一句**看起来
 * 有依据、实际是编的**结论（§12.13.3 对棘轮的第二条：数不出来就说数不出来）。
 *
 * 取不到（不在 git 检出 / git 不可用）同样回 `null`：这一档与「只有一个父」必须分开，
 * 调用方据此决定说哪句话，而不是拿 `false` 顶替。
 *
 * @returns {boolean|null}
 */
function headIsMergeCommit() {
  /* `cwd` 必须显式给：判据自己也是被从别的目录起起来的（`pnpm build` 收尾 /
   * 子进程跑门禁自检），靠继承来的 cwd 得到的是**另一个仓库**的 HEAD。 */
  const res = spawnSync("git", ["rev-list", "--parents", "-n", "1", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  const fields = res.stdout.trim().split(/\s+/).filter(Boolean);
  if (fields.length < 2) return null;
  return fields.length > 2;
}

/**
 * 基线之后有多少次提交动过源码 —— 「基线过期」这个事实的**证据**。
 *
 * 为什么需要它（ISSUE #1781 的现场）：基线是 `086e16a0` 那一刻的**诚实读数**，
 * 但它之后合了 6 个 commit、其中 `50c1845f` 改了 17 个组件文件，体积真涨了
 * 1074 字节。在那之前，判据只能说「涨了 493 字节 gzip」—— 读者拿到这句话的第一
 * 反应是「是不是抖动 / 是不是量错了」，而不是「这是那几次改动换来的」。归因不是
 * 锦上添花：**它决定下一步是压回去还是认账**（§13.5.4 的例外流程第一步）。
 *
 * 数不出来时返回 `null`：调用方说清是哪一档，而不是拿一个猜的数顶上去（口径的来历是
 * 一次真事故，见规范 §12.13.3 的 ISSUE #653 那一段）。**分档不在这一层做** ——
 * 「压根没记」与「记了但不可达」都由 `baselineRevState()` 先认，只把认得的那一种交进来。
 *
 * @param {string|null|undefined} rev
 * @returns {number|null}
 */
function commitsSinceBaseline(rev) {
  if (!rev) return null;
  const res = spawnSync("git", ["rev-list", "--count", `${rev}..HEAD`], {
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  const n = Number(res.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

/**
 * 量当前产物：raw / gzip / 文件数三个结构量，外加**按内容指纹对齐**的逐文件账。
 *
 * 逐文件账留作诊断（见文件头「判定依据」）：`sha256` 是身份、文件名只是它的显示形态。
 * 同一份内容换了名 → 两侧指纹相同 → 不算变化；指纹对不上才是真的多了/大了。
 *
 * @returns {{files: number, raw: number, gzip: number, entries: Array<{name:string,sha:string,raw:number,gzip:number}>}}
 */
function measure() {
  const files = walk(CHUNKS_DIR).filter((f) => CHUNK_EXT.test(f));
  const entries = [];
  let raw = 0;
  let gzip = 0;
  for (const abs of files) {
    const buf = fs.readFileSync(abs);
    const gz = zlib.gzipSync(buf).length;
    entries.push({
      name: path.basename(abs),
      sha: crypto.createHash("sha256").update(buf).digest("hex"),
      raw: buf.length,
      gzip: gz,
    });
    raw += buf.length;
    gzip += gz;
  }
  /* 名字排序：输出稳定，方便人眼对比与测试断言。 */
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
      "client chunk 体积预算（规范 §13.5.4，ISSUE #1781）。判定看 gzip 与文件数两个总量" +
        "（raw 一并量、一并打，但不判）；逐文件账是诊断输出，按 sha256 对齐，不进基线。" +
        "棘轮只许下降，" +
        "抬高基线必须在 PR 里贴 before/after 两档读数 + 说明为什么值这个体积（例外流程）。",
    /* 读数是**哪一版源码**的产物（规范 §12.13.3）：判红时用它把「基线过期」从
     * 猜测变成事实 —— 见 `commitsSinceBaseline`。 */
    baselineRev: headRev(),
    metric: {
      scope: ".next/static/chunks（Turbopack 默认构建链，只数 .js）",
      raw: m.raw,
      gzip: m.gzip,
      files: m.files,
    },
    /* 逐文件内容指纹：**只服务诊断**（哪个 chunk 变大了 / 哪个只是换了名），判定不读它。
     * 存指纹而不存名字：名字就是内容哈希，存名字等于把「同一份内容的两种显示形态」记成两笔账。 */
    entries: m.entries.map((e) => ({
      name: e.name,
      sha: e.sha,
      raw: e.raw,
      gzip: e.gzip,
    })),
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(payload, null, 2)}\n`);
}

/** 人类可读的字节（KB，一位小数）—— 输出里两档都打，便于贴进 PR。 */
function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * 增量（带符号）—— 小到 0.0 KB 时 `kb()` 会把 +493 字节打成「+0.0 KB」，
 * 而「涨了 493 字节」正是判红理由本身，不许显示成零。所以增量一律补字节数。
 */
function delta(n) {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "±";
  const abs = Math.abs(n);
  return abs < 1024
    ? `${sign}${abs} B`
    : `${sign}${(abs / 1024).toFixed(1)} KB`;
}

/**
 * 诊断：把当前产物与基线**按内容指纹**对齐，分出三类（不参与判定）。
 *
 * - **同内容换名**：两侧指纹相同、名字不同 —— 本仓实测不发生，但口径上它「不算变化」；
 * - **新增内容**：指纹在基线里找不到 —— 这是「多了东西」的唯一可靠形状；
 * - **同名但变大**：名字恰好没变的那些，能直接给出「谁大了多少」。
 *
 * 基线里没有指纹（本轮之前生成的旧格式）时返回 `null`，由调用方把这一点**写在输出里**
 * —— 静默换口径会让读者拿两种语义的账互相印证。
 */
function diagnose(cur, base) {
  const baseEntries = base?.entries;
  if (!Array.isArray(baseEntries) || baseEntries.length === 0) return null;

  const baseBySha = new Map(baseEntries.map((e) => [e.sha, e]));
  const baseByName = new Map(baseEntries.map((e) => [e.name, e]));

  const renamed = [];
  const added = [];
  const grown = [];
  for (const e of cur.entries) {
    const sameContent = baseBySha.get(e.sha);
    if (sameContent) {
      /* 内容一模一样 —— 变的只是名字。 */
      if (sameContent.name !== e.name) renamed.push([sameContent.name, e.name]);
      continue;
    }
    const sameName = baseByName.get(e.name);
    if (sameName) grown.push([e.name, sameName.gzip, e.gzip]);
    else added.push(e);
  }
  return { renamed, added, grown };
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
  const fmt = (m) =>
    `文件数 ${m.files} · raw ${kb(m.raw)} · gzip ${kb(m.gzip)}`;
  const line = `[bundle-budget] 当前：${fmt(now)}`;

  if (REPORT_ONLY) {
    console.log(line);
    console.log(
      base
        ? `  基线：${fmt(base.metric)}（生成于 ${base.generatedAt}）`
        : "  基线：不存在（先跑 --update 落一份实测初值）",
    );
    const d = base ? diagnose(now, base) : null;
    if (d && (d.renamed.length || d.added.length || d.grown.length)) {
      console.log("  与基线的差异（按内容指纹对齐，诊断用、不参与判定）：");
      if (d.renamed.length) {
        console.log(
          `    · 同内容换名 ${d.renamed.length} 个（不计变化）：` +
            d.renamed
              .slice(0, 3)
              .map(([a, b]) => `${a} → ${b}`)
              .join("、") +
            (d.renamed.length > 3 ? " 等" : ""),
        );
      }
      if (d.added.length) {
        console.log(
          `    · 新增内容 ${d.added.length} 个，最大的 3 个：` +
            d.added
              .slice()
              .sort((a, b) => b.gzip - a.gzip)
              .slice(0, 3)
              .map((e) => `${e.name}（${kb(e.gzip)}）`)
              .join("、"),
        );
      }
      if (d.grown.length) {
        console.log(`    · 同名且变大 ${d.grown.length} 个`);
      }
    } else if (base && !d) {
      console.log(
        "  （基线是旧格式、没有逐文件指纹：判定不受影响，只影响这段诊断）",
      );
    }
    console.log("[bundle-budget] --report 模式：只出清单，不判失败 ✓");
    return 0;
  }

  if (UPDATE) {
    /* 修订号取不到时**不许写基线**（ISSUE #1988 的现场）。
     *
     * 失效形态是静默的：`headRev()` 在非 git 检出里返回 `null`，写出来的基线
     * 于是 `baselineRev: null` —— 判据不再报错，但那条归因**永久失效**，而它正是
     * 判红时唯一能把「涨的这点是不是那几次改动换来的」说清楚的东西（见
     * `commitsSinceBaseline` 的说明）。本仓 master 上就躺着一份这样的基线
     * （生成于 2026-10-15，修订号 `b6c3c353`，而那个提交在检出里根本不存在），
     * 此后每一跑 CI 都只报「基线修订号：取不到」—— 一条看起来在守、实际什么都没守的账。
     *
     * 所以把「写不下去」提前成一条当场能看见的拒绝：--update 只在真 git 检出里跑。 */
    if (headRev() === null) {
      console.error(
        "[bundle-budget] 拒绝写入基线：取不到当前修订号（不在 git 检出里 / git 不可用）。\n" +
          "  基线的 baselineRev 是判红时唯一能把上涨归因到「哪几次改动」的东西，" +
          "写成 null 等于把这笔账静默掏空。请在完整 git 检出里重跑 --update。",
      );
      return 1;
    }
    const before = base?.metric;
    const grew = before && now.gzip > before.gzip;
    const moreFiles = before && now.files > before.files;
    /* 拒涨：与 check-overlay-z.cjs 那批棘轮同口径 ——
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
    /* 写盘前先校验形状：`--update` 落下去的必须是 40 位十六进制。只判「不是 null」不够 ——
     * 读那一侧要拿它 `git cat-file -e` 去认「基线之后源码动过几次」，写成短哈希 / ref
     * 这类形态在那边同样是查不到，只是把失效挪到了下一步。 */
    const rev = headRev();
    if (!REV_SHAPE.test(String(rev))) {
      console.error(
        "[bundle-budget] 拒绝写入基线：取不到可用的当前修订号（不在 git 检出里 / git 不可用）。\n" +
          "  基线的 baselineRev 是判红时唯一能把上涨归因到「哪几次改动」的东西，" +
          "写成 null（或别的形态）等于把这笔账静默掏空。请在完整 git 检出里重跑 --update。",
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

  /* 判定只看**总量**（gzip / 文件数），逐文件那一档**不判**（见文件头「判定依据」）。 */
  const problems = [];
  if (now.gzip > base.metric.gzip) {
    problems.push(
      `gzip 总量上升：${kb(base.metric.gzip)} → ${kb(now.gzip)}（${delta(now.gzip - base.metric.gzip)}）`,
    );
  }
  /* raw 与 gzip 的关系：**gzip 才是「用户要下载多少」**，raw 是磁盘/内存形态。
   * 只判 gzip —— 实测存在「raw 涨、gzip 不涨」的形态（往末尾塞可压缩的重复内容），
   * 那一档不是用户可感知的劣化，判红只会制造误报。raw 仍然量、仍然打，作诊断信息。 */
  if (now.files > base.metric.files) {
    problems.push(
      `chunk 文件数上升：${base.metric.files} → ${now.files}（+${now.files - base.metric.files}）`,
    );
  }

  console.log(line);
  console.log(`  基线：${fmt(base.metric)}（生成于 ${base.generatedAt}）`);

  if (problems.length) {
    console.error("[bundle-budget] 违规（阻断）：\n  " + problems.join("\n  "));
    /* 归因先说：判红那一刻读者最该知道的是「这个读数取自哪一版源码」。
     * 缺了它，「涨了 493 字节」的第一反应必然落在「是不是抖动 / 是不是量错了」上，
     * 而不是「这是不是基线之后那几次改动换来的」—— 而后者才是下一步该回答的问题。
     * 修订号取不到 / 不可达时**说清是哪一档**：不拿猜测顶替，也不把两档混成一句
     * 「取不到」—— 两档的下一步不同（§12.13.3 留给下一个按行数记账的棘轮的第二条）。 */
    const state = baselineRevState(base.baselineRev);
    if (state.kind === "missing") {
      console.error(
        "  基线修订号：取不到（旧格式基线 / 不在 git 检出里）——\n" +
          "    无法判断这批读数与基线之间源码动过几次，先看下面逐文件诊断，或重跑一次 --update。",
      );
    } else if (state.kind === "stale") {
      /* 「记了、但那个提交在本检出里不存在」与「没记」是两档（ISSUE #1988）：
       * 后者的下一步是重记一次；前者是**基线过期**，重记之前必须先分清涨的这点体积
       * 该不该认 —— 这正是 §13.5.4 例外流程的第一步，反过来做就是把劣化记账放行。 */
      console.error(
        `  基线修订号：${String(base.baselineRev).slice(0, 8)} 在本检出里不可达（基线过期 / 浅克隆）——\n` +
          "    无法判断这批读数与基线之间源码动过几次。**别直接 --update 重记**：" +
          "先按下面逐文件诊断分清「涨了」与「换了名」，确认这点体积该不该认账；" +
          "确认之后再带 --allow-increase 重记基线（§13.5.4 例外流程）。",
      );
    } else {
      const since = commitsSinceBaseline(state.rev);
      if (since === null) {
        console.error(
          "  基线修订号：取不到 ——\n" +
            "    无法判断这批读数与基线之间源码动过几次，先看下面逐文件诊断，或重跑一次 --update。",
        );
      } else if (since > 0) {
        console.error(
          `  基线修订号：${String(base.baselineRev).slice(0, 8)}（其后本检出上有 ${since} 次提交）——\n` +
            "    这批读数取自**基线之后的源码**，涨幅可能正是那几次改动换来的：" +
            "先分清「它是不是想要的」再决定压回去还是认账（§13.5.4 例外流程）。",
        );
      } else if (headIsMergeCommit() === true) {
        /* 合并提交：`baselineRev` 恰是 HEAD 这件事在合并里**没有解释力**（见
         * `headIsMergeCommit` 的说明）。别把两档混成「取自未提交的改动」那一句。
         * 措辞**不重复**「就是本检出的 HEAD」这半句：文件头已经写明归因是「相对 HEAD」
         * 量的，这里要说的是它为什么推不出结论，而不是再念一遍前提。 */
        console.error(
          `  基线修订号：${String(base.baselineRev).slice(0, 8)}（就是本检出的 HEAD，而 HEAD 是合并提交）——\n` +
            "    记的是**合并前某一侧**的读数，而产物是合并后源码的输出，两者本就不可比。" +
            "别拿这一档判「谁涨了」：先在合并后的完整产物链上重跑一次 --update，" +
            "读数与归因同时才可信（§13.5.4 例外流程）。",
        );
      } else if (headIsMergeCommit() === null) {
        console.error(
          "  基线修订号：取不到 ——\n" +
            "    判断不出本检出的 HEAD 是不是合并提交，先看下面逐文件诊断，或重跑一次 --update。",
        );
      } else {
        console.error(
          `  基线修订号：${String(base.baselineRev).slice(0, 8)}（就是本检出的 HEAD）——\n` +
            "    基线取自同一版源码，那么这次上涨来自**未提交的改动**。",
        );
      }
    }
    const d = diagnose(now, base);
    if (d) {
      /* 诊断是**给人看的**、不参与判定：比的是内容指纹，名字换了不算变化。 */
      const lines = [];
      if (d.added.length) {
        lines.push(
          `  新增内容 ${d.added.length} 个（指纹在基线里找不到），最大的 5 个：`,
        );
        for (const e of d.added
          .slice()
          .sort((a, b) => b.gzip - a.gzip)
          .slice(0, 5)) {
          lines.push(`    · ${e.name}（gzip ${kb(e.gzip)}）`);
        }
      }
      if (d.renamed.length) {
        lines.push(
          `  同内容换名 ${d.renamed.length} 个（不计变化）：` +
            d.renamed
              .slice(0, 3)
              .map(([a, b]) => `${a} → ${b}`)
              .join("、") +
            (d.renamed.length > 3 ? " 等" : ""),
        );
      }
      if (d.grown.length) {
        lines.push(`  同名且变大 ${d.grown.length} 个，增幅最大的 5 个：`);
        for (const [name, b, v] of d.grown
          .slice()
          .sort((a, b) => b[2] - b[1] - (a[2] - a[1]))
          .slice(0, 5)) {
          lines.push(`    · ${name}（gzip ${kb(b)} → ${kb(v)}）`);
        }
      }
      if (lines.length) console.error(lines.join("\n"));
    } else {
      console.error(
        "  （基线里没有逐文件指纹 —— 它是本轮之前生成的旧格式；判定不受影响，只影响这段诊断。\n" +
          "   需要它就在确认过账之后跑一次 --update。）",
      );
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
