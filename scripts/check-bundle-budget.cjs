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
 * ── **开发期状态（2026-10-29 业主口径，ISSUE #2634）**：两条总量判据**暂撤** ──────
 *
 * `TOTALS_ENFORCED = false` ⇒ gzip 总量与 chunk 文件数**照量、照打、不参与判定**，
 * 退 0 但**明写「这一格今天没判」**（不许被读成「已在预算内」）。为什么是这两条、
 * 为什么不是判据本体被删：
 *
 *   · 触发点是每日档那笔 `+17.4 KB / +1 chunk`（基线 `dd8d4647` 其后 35 次主干提交）。
 *     按 §13.5.4「不是你的账，立案，别替别人签」，没有人有那 35 笔的 before/after 与
 *     「为什么值这个体积」，所以**没人签**；而不签的代价是 `每日生产构建` 恒红，
 *     把 `每日单元测试` / `每日全量E2E` / `每日 ESLint 零警告` / `每日浏览器安装`
 *     四格一起拖成 `skipped` —— 一条**预算**判据在吃掉三张**新鲜度**账（ISSUE #2114 那一族）。
 *   · 开发期客户端体积本来就在来回涨，这一格的信号价值此刻低于它挡掉的证据价值。
 *     所以撤的是**执行**，不是**量具**：读数、逐文件指纹诊断、归因（「其后 N 次提交」）
 *     一句都没少打，将来签账的人拿到的还是同一份现场。
 *   · **`--update` 的棘轮一条没动**（只许下降，抬高要 `--allow-increase`）。基线仍停在
 *     `224 / 2196.3 KB` —— 于是恢复判据那一天，开发期累计的涨幅会一次性摆在同一个
 *     对照物前面，不会被「边涨边重记基线」抹平。这一条是这次暂撤不变成隐性豁免的关键。
 *
 * **恢复条件**：出正式版前把 `TOTALS_ENFORCED` 改回 `true`（恢复之前可以先用
 * `--enforce-totals` 跑一次自查，看那一版会不会红、红在哪几笔）。登记在三处：
 * 本文件的运行读数、规范 §13.5.4、以及单子（恢复那张与 #2634 各自的名字写在下面）。
 *
 * ⚠️ 别把这次暂撤读成「预算闸可以按人临时关」：关的是**这一档判据的执行**，
 * 而它每次运行都自报「今天没判」——降档必须被说出来（§13.5.25 同一条纪律）。
 *
 * ⚠️ 但「新增内容」这个桶**不能单独打印**（ISSUE #2141）：老块内容涨几十字节就会换哈希，
 * 于是它同时是「新增」与「消失」两条 —— 只报前一半时，一笔 44 B 的小改在屏幕上长得像
 * 新增了 30 KB。两份输出（判红那一档与 `--update` / `--report` 那一档）都走 `deltaLines()`，
 * 必须把**消失合计与并排净差**一起给出来。
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
 *    然后 `--update --allow-increase` 抬高基线 —— 见 §13.5.4 的例外流程那一节。
 *    **签的是谁带进来这批字节的那个人**（ISSUE #2149）：口径原本是「评审确认后」，
 *    而「确认后」在实践里等于「等一个不知道这账是自己的路过」—— 六天内四笔账（#1988 /
 *    #2082 / #2132 / #2149）没有一笔是造成它的那条 PR 认的，全挂在主干上等下一次构建。
 *    带它合入的那条 PR 同批认，是因为**只有那里同时有**这三样：为什么加了客户端字节、
 *    before/after、以及「压回去」这条路还来不来得及。判据不因此多写一个启发式扫描器
 *    （§12.18 / 硬规则 24）—— 它只把「该谁」写在红话里。
 *
 * ── 与 `pnpm analyze` 的分工 ─────────────────────────────────────
 *
 * 那份走 Next 16 内置的 **Turbopack 分析器**（`next analyze`，#2538 起；曾用挂在
 * webpack 上的 `@next/bundle-analyzer`，已删）生成可视化报告给人看 ——「有人看才有用」。
 * 本判据是**机器判定档**，量的是默认构建链（Turbopack）的产物。两者如今**同链**，
 * 但分工不混：分析器回答「字节在哪儿、谁贡献的」，本判据回答「超没超、棘轮放不放」。
 *
 * 用法：
 *   node scripts/check-bundle-budget.cjs            # 检查（棘轮：只许降不许升）
 *   node scripts/check-bundle-budget.cjs --update   # 由造成这批字节的那条 PR 认账后重写基线
 *                                                   #   （须伴随下降，除非带 --allow-increase + 理由）
 *   node scripts/check-bundle-budget.cjs --report   # 只出清单，不判失败（盘点用）
 *   node scripts/check-bundle-budget.cjs --enforce-totals
 *                                                 #   无视开发期暂撤，按现行判据硬档跑一次
 *                                                 #   （出正式版恢复前的自查口）
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
 * 两条总量判据（gzip / chunk 文件数）当前**是否参与判定**。
 *
 * `false` = 开发期暂撤（2026-10-29 业主口径，ISSUE #2634）—— 见文件头「开发期状态」那一节：
 * 读数照量照打、归因照给、`--update` 的棘轮一条没动，只有**执行**停了，而且停会被念出来。
 * 恢复 = 改回 `true`；在此之前想硬档跑一次用 `--enforce-totals`。
 */
const TOTALS_ENFORCED = false;
const ENFORCE_TOTALS = TOTALS_ENFORCED || ARGS.has("--enforce-totals");

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
  if (res.status !== 0 || typeof res.stdout !== "string") {
    return null;
  }
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
  if (!rev || !REV_SHAPE.test(String(rev))) {
    return { kind: "missing" };
  }
  const res = spawnSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
    encoding: "utf8",
  });
  /* 不可达 / 不是本检出的仓库 ⇒ 这一档是「基线过期」（ISSUE #653 的原话：
   * 修订号通常是分支提交，合入后不再有 ref 指向，`git gc` 之后一律查不到）。 */
  return res.status === 0 ? { kind: "recorded", rev: String(rev) } : { kind: "stale" };
}

/**
 * 「记了但不可达」那一档的**第二归因通道**：按基线的 `generatedAt` 数主干上其后动过
 * 客户端源码的提交，并带回最近几笔的标题（ISSUE #2082 的现场）。
 *
 * 为什么这条走得通：`baselineRev` 记的几乎总是**分支提交**，而本仓是 squash 合并 ——
 * 分支一删就没有 ref 指向它，`git gc` 之后一律查不到（§12.13.3 里 ISSUE #653 那句原话，
 * 也正是 `baselineRevState()` 分出 `stale` 这一档的理由）。于是每一次判红都只能说
 * 「无法判断这批读数与基线之间源码动过几次」，而它给的下一步（「先分清该不该认账」）
 * 需要的恰恰是这份归因 —— 一句话把动作推回原地。
 * `generatedAt` 是基线里**另一个实测值**，它不依赖那枚提交还在不在，所以日期这条路
 * 在 `stale` 档上仍然量得出来。
 *
 * 量不到时回 `null`（git 不可用 / 日期形状不合法 / 不在检出里）：调用方按「没量到」说话，
 * 不拿猜的数顶上去。**判红不因此变绿** —— 补的是归因，不是判决。
 *
 * @returns {{count: number, recent: Array<{rev: string, title: string}>} | null}
 */
function commitsSinceDateTouchingSource(dateStr, limit = 5) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr ?? ""))) {
    return null;
  }
  const res = spawnSync(
    "git",
    ["log", "--since", `${dateStr} 00:00:00`, "--first-parent", "--format=%h\u001f%s", "--", "src/"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (res.status !== 0 || typeof res.stdout !== "string") {
    return null;
  }
  const rows = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const at = l.indexOf("\u001f");
      return { rev: l.slice(0, at), title: l.slice(at + 1) };
    });
  return { count: rows.length, recent: rows.slice(0, limit) };
}

/**
 * `--update` 该落的那枚修订号：**主干可达的那一枚优先**（ISSUE #2082）。
 *
 * 为什么不是直接记 HEAD：本仓 PR 走 squash 合并，记录那一刻的 HEAD 是**分支提交**，
 * 合入之后没有 ref 指向它，`git gc` 之后 `baselineRevState()` 一律判 `stale`。
 * #1988 那一刀把「压根取不到（null）」拦住了，但**形状完全合法、每一次判红却都归因不了**
 * 的这一半留了下来 —— master 上那份 `0a618c1c` 就是它长出来的样子。
 * `merge-base HEAD origin/master` 落在主干上，squash 之后仍在场，拿它当锚点，
 * 「基线之后源码动过几次」才真的数得出来。
 *
 * 问不到主干（没有 `origin/master` 这个 ref / 不在 git 检出里 / git 不可用）回 `null`，
 * 由调用方退回 HEAD —— 那仍是会消失的那一枚，所以打印里必须说清用的是哪一枚、为什么。
 *
 * @returns {string | null}
 */
function trunkReachableRev() {
  const res = spawnSync("git", ["merge-base", "HEAD", "origin/master"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") {
    return null;
  }
  const rev = res.stdout.trim();
  return REV_SHAPE.test(rev) ? rev : null;
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
  if (res.status !== 0 || typeof res.stdout !== "string") {
    return null;
  }
  const fields = res.stdout.trim().split(/\s+/).filter(Boolean);
  if (fields.length < 2) {
    return null;
  }
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
  if (!rev) {
    return null;
  }
  const res = spawnSync("git", ["rev-list", "--count", `${rev}..HEAD`], {
    encoding: "utf8",
  });
  if (res.status !== 0 || typeof res.stdout !== "string") {
    return null;
  }
  const n = Number(res.stdout.trim());
  return Number.isFinite(n) ? n : null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(abs, out);
    } else {
      out.push(abs);
    }
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
      sha: crypto.hash("sha256", buf, "hex"),
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
  if (!fs.existsSync(BASELINE)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

function writeBaseline(m, note, rev) {
  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note:
      note ??
      "client chunk 体积预算（规范 §13.5.4，ISSUE #1781）。判定看 gzip 与文件数两个总量" +
        "（raw 一并量、一并打，但不判）；逐文件账是诊断输出，按 sha256 对齐，不进基线。" +
        "棘轮只许下降，" +
        "抬高基线必须在 PR 里贴 before/after 两档读数 + 说明为什么值这个体积（例外流程）。",
    /* 读数是**哪一版源码**的产物（规范 §12.13.3）：判红时用它把「基线过期」从
     * 猜测变成事实 —— 见 `commitsSinceBaseline`。调用方给的是主干可达的那一枚
     * （`trunkReachableRev`），没给才退回 HEAD —— 见 `commitsSinceDateTouchingSource`
     * 头注里那条「squash 之后分支提交查不到」的成因。 */
    baselineRev: rev ?? headRev(),
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
  return abs < 1024 ? `${sign}${abs} B` : `${sign}${(abs / 1024).toFixed(1)} KB`;
}

/**
 * 诊断：把当前产物与基线**按内容指纹**对齐，分出四类（不参与判定）。
 *
 * - **同内容换名**：两侧指纹相同、名字不同 —— 本仓实测不发生，但口径上它「不算变化」；
 * - **新增内容**：指纹在基线里找不到 —— 这是一个**混装袋**：真多了东西，与「老块内容小改
 *   → 哈希换了名」都落在这里（后者不进 `renamed` 因为指纹变了、也不进 `grown` 因为名字变了）；
 * - **消失内容**：基线里那一块既没有同内容的现块、也没有同名的现块。缺了这一类，上一行
 *   就会被读成「新增了 30 KB」，而它其实是一笔 44 B 的小改（ISSUE #2141 的现场）——
 *   所以 `added` 与 `gone` **必须并排打印，并给出净差**（见 `addedLines()`）；
 * - **同名但变大**：名字恰好没变的那些，能直接给出「谁大了多少」。
 *
 * 基线里没有指纹（本轮之前生成的旧格式）时返回 `null`，由调用方把这一点**写在输出里**
 * —— 静默换口径会让读者拿两种语义的账互相印证。
 */
function diagnose(cur, base) {
  const baseEntries = base?.entries;
  if (!Array.isArray(baseEntries) || baseEntries.length === 0) {
    return null;
  }

  const baseBySha = new Map(baseEntries.map((e) => [e.sha, e]));
  const baseByName = new Map(baseEntries.map((e) => [e.name, e]));
  const curBySha = new Set(cur.entries.map((e) => e.sha));
  const curByName = new Set(cur.entries.map((e) => e.name));

  const renamed = [];
  const added = [];
  const grown = [];
  for (const e of cur.entries) {
    const sameContent = baseBySha.get(e.sha);
    if (sameContent) {
      /* 内容一模一样 —— 变的只是名字。 */
      if (sameContent.name !== e.name) {
        renamed.push([sameContent.name, e.name]);
      }
      continue;
    }
    const sameName = baseByName.get(e.name);
    if (sameName) {
      grown.push([e.name, sameName.gzip, e.gzip]);
    } else {
      added.push(e);
    }
  }
  const gone = baseEntries.filter((e) => !curBySha.has(e.sha) && !curByName.has(e.name));
  const sumGzip = (list) => list.reduce((a, e) => a + (e.gzip ?? 0), 0);
  return {
    renamed,
    added,
    grown,
    gone,
    addedGzip: sumGzip(added),
    goneGzip: sumGzip(gone),
  };
}

/**
 * 「新增 / 消失 / 净差」那几行 —— 两个打印点（判红那一档与 `--update` / `--report` 那一档）
 * 共用一份措辞：同一件事在两份输出里长成两个样子，就会有人拿其中一份去签字。
 *
 * 「新增 / 消失 / 净差」那几行 —— 两个打印点（判红那一档与 `--update` / `--report` 那一档）
 * 共用一份措辞：同一件事在两份输出里长成两个样子，就会有人拿其中一份去签字。
 *
 * @param {ReturnType<typeof diagnose>} d 诊断结果
 * @param {number} top 列出几个名字
 * @param {string} [indent] 额外缩进（`--update` 那一档嵌在「与基线的差异」下面，多两层）
 * @returns {string[]} 缩进好的输出行
 */
function deltaLines(d, top, indent = "") {
  const out = [];
  if (!d.added.length) {
    /* 只有消失（变小 / 换了实现）：单独说一句净差，别让它静默 —— 同一句里的
     * 「净差」在两边都要能读到，否则读者只在红的那一档看见差值、平时看不见。 */
    if (d.gone.length) {
      out.push(
        `${indent}消失内容 ${d.gone.length} 个（gzip 合计 ${kb(d.goneGzip)}）⇒ 净差 ${delta(-d.goneGzip)}（变小，不算违规）`,
      );
    }
    return out;
  }
  out.push(
    `${indent}新增内容 ${d.added.length} 个（gzip 合计 ${kb(d.addedGzip)}，指纹在基线里找不到）${
      d.gone.length
        ? `；同时消失 ${d.gone.length} 个（合计 ${kb(d.goneGzip)}）⇒ 并排净差 ${delta(d.addedGzip - d.goneGzip)}`
        : "；基线里没有配对的消失块 ⇒ 这些是真多出来的"}`,
  );
  out.push(
    `${indent}「新增」按内容指纹算 —— 老块内容小改导致换名也会落在这里；` +
      "要看的是上面那行的净差，不是最大的那个名字。",
  );
  for (const e of [...d.added]
    .sort((a, b) => b.gzip - a.gzip)
    .slice(0, top)) {
    out.push(`${indent}  · ${e.name}（gzip ${kb(e.gzip)}）`);
  }
  return out;
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
  const fmt = (m) => `文件数 ${m.files} · raw ${kb(m.raw)} · gzip ${kb(m.gzip)}`;
  const line = `[bundle-budget] 当前：${fmt(now)}`;

  if (REPORT_ONLY) {
    console.log(line);
    console.log(
      base
        ? `  基线：${fmt(base.metric)}（生成于 ${base.generatedAt}）`
        : "  基线：不存在（先跑 --update 落一份实测初值）",
    );
    const d = base ? diagnose(now, base) : null;
    if (d && (d.renamed.length || d.added.length || d.grown.length || d.gone.length)) {
      console.log("  与基线的差异（按内容指纹对齐，诊断用、不参与判定）：");
      if (d.renamed.length) {
        console.log(
          `    · 同内容换名 ${d.renamed.length} 个（不计变化）：${
            d.renamed
              .slice(0, 3)
              .map(([a, b]) => `${a} → ${b}`)
              .join("、")
            }${d.renamed.length > 3 ? " 等" : ""}`,
        );
      }
      for (const line of deltaLines(d, 3, "    ")) {
        console.log(line);
      }
      if (d.grown.length) {
        console.log(`    · 同名且变大 ${d.grown.length} 个`);
      }
    } else if (base && !d) {
      console.log("  （基线是旧格式、没有逐文件指纹：判定不受影响，只影响这段诊断）");
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
     * 「--update 只许降」。例外流程必须显式带 --allow-increase，逼出一个
     * 「有人在 PR 里认过账」的动作，而不是让 --update 默默把预算抬高。
     * 触发面过去写的是「加依赖」（ISSUE #1781 那一版想到的只有它），而六天内实到的四笔
     * **没有一笔是新依赖**，全是「给客户端加一份运行时 schema」那类代码增量 ——
     * 那句话让所有人（包括造出这笔增量的人）都不觉得这条流程是自己的。 */
    if (before && (grew || moreFiles) && !ALLOW_INCREASE) {
      console.error(
        `[bundle-budget] 拒绝抬高基线：gzip ${kb(before.gzip)} → ${kb(now.gzip)}、` +
          `文件数 ${before.files} → ${now.files}（棘轮只许下降）。\n` +
          "  这批体积若是你想要的（新依赖，或给客户端加了一份运行时 schema），" +
          "请在**造成它的那条 PR** 里贴 before/after 两档读数 + 说明为什么值这个体积，" +
          "带 --allow-increase 重跑（规范 §13.5.4 的例外流程）。",
      );
      return 1;
    }
    /* 写盘前先校验形状：`--update` 落下去的必须是 40 位十六进制。只判「不是 null」不够 ——
     * 读那一侧要拿它 `git cat-file -e` 去认「基线之后源码动过几次」，写成短哈希 / ref
     * 这类形态在那边同样是查不到，只是把失效挪到了下一步。 */
    const anchor = trunkReachableRev();
    const rev = anchor ?? headRev();
    if (!REV_SHAPE.test(String(rev))) {
      console.error(
        "[bundle-budget] 拒绝写入基线：取不到可用的当前修订号（不在 git 检出里 / git 不可用）。\n" +
          "  基线的 baselineRev 是判红时唯一能把上涨归因到「哪几次改动」的东西，" +
          "写成 null（或别的形态）等于把这笔账静默掏空。请在完整 git 检出里重跑 --update。",
      );
      return 1;
    }
    writeBaseline(now, undefined, rev);
    /* 用的是哪一枚锚点必须打出来：两种锚点的**失效方向不同**（主干那枚一直数得出，
     * HEAD 那枚在 squash 合入后不可达、只能改走日期通道），不写出来就只能事后猜。 */
    console.log(
      `[bundle-budget] 基线锚点 baselineRev=${String(rev).slice(0, 8)} —— ${
        anchor
          ? "取的是主干可达的那一枚（merge-base HEAD origin/master），squash 合入后仍数得出「其后动过几次」"
          : "本检出问不到 origin/master，退回 HEAD —— 这一枚在 squash 合入后多半不可达，届时判红改走 generatedAt 那条第二归因（ISSUE #2082）"}`,
    );
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
    /* 撤档那一档的**判决行**走 stdout，读数与归因留在 stderr（诊断本色）。
     * 这条分界不是排版：退 0 的判据在很多消费者那里只转述 stdout
     * （`quality-gate.mjs` 的绿档、`tests/helpers/gate-repo.ts` 的夹具都是这个形状），
     * 「今天没判」这句话要是只落 stderr，就会被读成「它绿了，所以没什么可看的」——
     * 那是本次暂撤最坏的失效形态（硬规则 27：效应不许只转述自己的 stdout）。 */
    if (!ENFORCE_TOTALS) {
      console.log(
        "[bundle-budget] 两条总量判据处于**开发期暂撤**状态（业主口径 2026-10-29，ISSUE #2634）" +
          "—— 下面那些涨幅是读数，**这一格今天没判**。",
      );
    }
    console.error(
      ENFORCE_TOTALS
        ? `[bundle-budget] 违规（阻断）：\n  ${problems.join("\n  ")}`
        : `[bundle-budget] 读数（不参与判定）：\n  ${problems.join("\n  ")}`,
    );
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
       * 该不该认 —— 这正是 §13.5.4 例外流程的第一步，反过来做就是把劣化记账放行。
       *
       * 话术在这里订正一处（ISSUE #2082）：旧那句把原因写成「基线过期 / 浅克隆」，而本仓
       * 的常态是前者 —— PR 走 squash 合并，那枚分支提交在合入后不再有 ref 指向，
       * `git gc` 之后在任何主干检出上都查不到。它与浅克隆无关，且**每一次判红都必然落到
       * 这一档**（master 上那份 `0a618c1c` 就是这么来的）。所以这里不再停在
       * 「无法判断」，改走 `generatedAt` 那条第二归因通道。 */
      const byDate = commitsSinceDateTouchingSource(base.generatedAt);
      const staleHead =
        `  基线修订号：${String(base.baselineRev).slice(0, 8)} 在本检出里不可达` +
        "（基线过期 —— 本仓常态是 squash 合入后那枚分支提交不再有 ref 指向，浅克隆是另一种）——\n";
      console.error(
        byDate
          ? `${staleHead
              }    改按基线日期 ${base.generatedAt} 归因：src/ 侧其后有 ${byDate.count} 次主干提交${
              byDate.recent.length
                ? `（${byDate.recent.map((r) => `${r.rev} ${r.title}`).join("；")}）`
                : ""
              }。\n${
              byDate.count > 0
                ? "    ⇒ 这批读数取自基线之后的源码，涨幅可能正是那几次改动换来的。" +
                  "**别直接 --update 重记**：先按下面逐文件诊断分清「涨了」与「换了名」，" +
                  "确认这点体积该不该认账；确认之后再带 --allow-increase 重记基线（§13.5.4 例外流程）。"
                : "    ⇒ src/ 侧其后一次提交都没有，那么这笔上涨**不是**基线之后的源码换来的。" +
                  "**别直接 --update 重记**：先看下面逐文件诊断（§13.5.4 例外流程）。"}`
          : `${staleHead
              }    基线日期那条也量不到（没有 generatedAt / 日期形状不合法 / git 不可用），` +
              `所以这批读数与基线之间源码动过几次**判断不了**。` +
              `**别直接 --update 重记**：先按下面逐文件诊断分清「涨了」与「换了名」（§13.5.4 例外流程）。`,
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
      lines.push(...deltaLines(d, 5));
      if (d.renamed.length) {
        lines.push(
          `  同内容换名 ${d.renamed.length} 个（不计变化）：${
            d.renamed
              .slice(0, 3)
              .map(([a, b]) => `${a} → ${b}`)
              .join("、")
            }${d.renamed.length > 3 ? " 等" : ""}`,
        );
      }
      if (d.grown.length) {
        lines.push(`  同名且变大 ${d.grown.length} 个，增幅最大的 5 个：`);
        for (const [name, b, v] of [...d.grown]
          .sort((a, b) => b[2] - b[1] - (a[2] - a[1]))
          .slice(0, 5)) {
          lines.push(`    · ${name}（gzip ${kb(b)} → ${kb(v)}）`);
        }
      }
      if (lines.length) {
        console.error(lines.join("\n"));
      }
    } else {
      console.error(
        "  （基线里没有逐文件指纹 —— 它是本轮之前生成的旧格式；判定不受影响，只影响这段诊断。\n" +
          "   需要它就在确认过账之后跑一次 --update。）",
      );
    }
    console.error(
      "  规范见 docs/standards/13-提交与-code-review.md §13.5.4；\n" +
        "  这是预算、不是禁令：**谁把这批客户端字节带进来的谁签** —— 在造成它的那条 PR 里贴" +
        " before/after 两档读数 + 一句为什么值这个体积，同批带 --allow-increase 重跑 --update；" +
        "否则先把它压回去。\n" +
        "  ⚠️ 认账之前先分清这笔**是不是你的**（上面那句「其后 N 次提交」就是来自证的）：" +
        "那些提交都已进主干、且没有一笔在你这条线上 ⇒ 这不是你的账，立案，别替别人签" +
        "（§13.5.4「不是你的账」那一档）。\n" +
        "  要一份平台的独立读数（不改本地账）用单跑口 `api_trigger_build`，见 §13.5.23；" +
        "认账那一次 --update 读的是本地产物。",
    );
    if (!ENFORCE_TOTALS) {
      /* 收尾这几句是本单的**判点**：撤档不许被读成通过（§13.5.25 那条「降档永远要被念出来」），
       * 也不许被读成「以后也不用管了」——恢复条件与「基线没动」这两件必须在同一次输出里。
       * 走 stdout 的理由见上面那段（退 0 的档，只转述 stdout 的消费者也得看见）。 */
      console.log(
        "[bundle-budget] 这不是「已在预算内」（那句 ✓ 今天不会出现是有意的）。\n" +
          "  恢复：出正式版前把 scripts/check-bundle-budget.cjs 的 `TOTALS_ENFORCED` 改回 true；\n" +
          "  恢复前想先看一眼会红在哪几笔：`node scripts/check-bundle-budget.cjs --enforce-totals`。\n" +
          "  基线那一份账一条没动 —— 恢复那一天，开发期累计的涨幅会一次性摆在同一个对照物前面，\n" +
          "  不会被「边涨边重记基线」抹平。",
      );
      return 0;
    }
    return 1;
  }

  console.log("[bundle-budget] ✓ 在预算内（棘轮只许下降，未收紧只提示）");
  return 0;
}

process.exit(main());
