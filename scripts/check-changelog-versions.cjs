#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本:待发段落的来源锚 ⇄ 条目归属(供 .githooks/pre-commit 调用)
/**
 * `check-changelog-versions.cjs` —— 「这条变更落在哪个发布版本里」有据可查
 * （规范 docs/standards/13-提交与-code-review.md §13.10.6）。
 *
 * ## 立案现场：`[Unreleased]` 与 `## [0.1.0]` 之间没有共同的时间轴
 *
 * `CHANGELOG.md` 的 `[Unreleased]` 里躺着一大批条目，而它有**两个毛病**：
 *
 *   ① **段落的边界是一句话**（「发版时把它改成版本号」），而**没有任何东西记得住
 *      它从哪儿开始**：条目从 9 月 12 日（`9321411`）一路叠到 9 月 25 日以后，
 *      而 `## [0.1.0]` 顶着 **8 月 31 日** 的日期、正文只有一句「首个版本基线」——
 *      于是读的人无法回答「这一条到底进没进 0.1.0」。
 *   ② **被后一条推翻的旧条目会留在原地**：`[Unreleased]` 的 `Added` 里至今写着
 *      「对外参数在画布上是可连线的节点（ISSUE #355）」，而该能力早已由
 *      `changelog.d/0-editor-canvas-no-param-cards.md` 推翻（那份碎片自己还专门
 *      写了「本条**取代** `[Unreleased]` 里那一节」）。**它是「并入没走完」的残迹**：
 *      推翻它的碎片一直躺在 `changelog.d/`，因为 `0-` 开头的碎片不需要 ISSUE 号、
 *      也没有任何东西提醒它「该并入了」（`merge-changelog-fragments.mjs` 只在人敲
 *      它的时候跑）。一份**推翻**别人的碎片没并入，是这份账本最坏的两种失效之一。
 *
 * ## 本判据判什么（**刻意不是「版本对不对」**）
 *
 * 版本号归发布判断（`check-app-version.cjs` 只判三处**逐字相等**，同款口径）。
 * 本判据判的是**归属可以被核验**，三件事：
 *
 *   ① **每个待发段落都带一行来源锚**（`<!-- since: <commit> — <slug> -->`）——
 *      锚写明「这一段里最早的条目是哪个提交带进来的」。没有锚 = 这一段没有时间轴，
 *      上面的毛病 ① 就回来了。
 *   ② **锚必须能在本仓库历史里解析成提交**（只认 `git cat-file` 认得下的对象）——
 *      锚是给别人复算用的，写一个日期或写一个 HEAD 都等于没有锚。
 *   ③ **条目点名的 ISSUE 号不许跨锚分裂**（双向归属核对）：同一个 ISSUE 号
 *      既出现在锚之后的 `[Unreleased]` 里、又出现在锚之前的已发布段落里 ⇒ 报出来。
 *      那才是最贵的失效形态 —— 一条变更的归属被切成两半，而两端**都没写错**。
 *
 * ## 为什么锚「必须能被解析」就够用、不去判「锚对不对」
 *
 * 「锚是不是真的等于那一段最早条目的提交」需要把每条条目与提交对上，而**条目文本
 * 与提交信息之间没有稳定映射**（条目是人写的散文，提交可能改了多条、也可能一条都没
 * 进 CHANGELOG）。拿启发式去对会在第一次「一条提交里混着多个 ISSUE」时误报一片，
 * 而误报的判据活不过一次评审（§11.18.4）。所以这一格由**写入侧**保证：
 * `merge-changelog-fragments.mjs` 只把**来自当前 HEAD 的碎片**放进带锚的那个段落，
 * 并顺手把锚刷新成「本轮新增的那一个」（见 §13.10.6 的写法侧口径）。
 * 本判据守的是**它没有静默失灵**：锚在不在、解析得开不开、归属有没有分裂。
 *
 * ## 判据自己不许静默降级（§11.23.3 同款）
 *
 * `CHANGELOG.md` 读不到 / 解析不出任何段落 / 一个待发段落都没有 ⇒ 判**失败**，
 * 不是「没有段落要查、于是放过」。同族先例太多（§11.18.3 首版 `include: []` 却退 0、
 * §13.5.12 的「报告档自称在跑」）。
 *
 * 用法:
 *   node scripts/check-changelog-versions.cjs            # 检查(进 pre-commit D 组)
 *   node scripts/check-changelog-versions.cjs --report   # 只出清单不判失败(盘点用)
 *
 * 退出码 0 = 通过,1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

/**
 * **待发段落** = 还没定版的那些:`## [Unreleased]`,外加仓库自己的
 * `## [未发布]`(历史版本里真出现过,判据认它,免得一条正当写法被误拦)。
 *
 * ⚠️ **已定版的 `## [x.y.z] - <日期>` 不算待发** —— 定版(`--release`)那一刻起,
 * 它的日期就是「这一版切在什么时候」的答案,正文里的条目已经归属了那个版本。
 * 这条口径与 `merge-changelog-fragments.mjs` 同源(那边 `--release` 把待发段落写成
 * 带日期的版本段落)。判据这里若把带日期的版本段落也算成待发,归属核对里那句
 * 「锚**之前**的已发布段落」就永远是空集 —— 那条判据会**静默失效**
 * (实测量过:把 `[0.1.0]` 当成待发段落,`earlier` 集合恒为 0)。
 */
const VERSION_RE = /^\[(\d+\.\d+\.\d+[^\]]*)\]/;
const UNRELEASED_RE = /^\[(?:unreleased|未发布)\]/i;

/** 段落锚 —— 见 §13.10.6 的写法侧口径。 */
const ANCHOR_RE = /<!--\s*since:\s*([0-9a-f]{7,40})\s*(?:—|--|-)\s*(.+?)\s*-->/;
/**
 * 形状**写歪了的**锚 —— 任何 `<!-- since: … -->`(不看内容)。
 *
 * 为什么要这一条:上面那条正则认不出歪锚,于是 `anchorLineOf()` 回 `null` ⇒ 走到
 * 「这一段没有锚」那一支 ⇒ **静默放过**。实测:把 `since: 9321411` 改成
 * `since: 2026-09-12`(日期)整份判据照样全绿 —— 而「写了但写歪」比「没写」更坏:
 * 它看上去像一条来源记录,读的人不会再去想「这里为什么没有锚」。
 * 所以「歪了」当场红,口径是**错比缺更贵**。
 */
const LOOSE_ANCHOR_RE = /<!--\s*since:/;

/** 条目里点名的 ISSUE 号 —— 与 §13.10 的写法一致(`ISSUE #1234` / `(#1234)` / `#1234`)。 */
const ISSUE_RE = /#(\d{1,5})\b/g;

const problems = [];
const report = [];

/* ── 解析 CHANGELOG 的段落结构 ───────────────────────────────── */

/**
 * 把 `CHANGELOG.md` 拆成「二级标题(版本段落) → { 标题行号, 锚, 正文 }」。
 *
 * 只在**代码围栏之外**认 `## `：正文里有引用 `## [Unreleased]` 的说明块
 * （本文件的文件头就有一处）,把它算成段落会让整份解析错位。
 *
 * @param {string} text
 * @returns {{title: string, line: number, body: string[], isPending: boolean, hasAnchor: boolean}[]}
 */
function parseSections(text) {
  const lines = text.split("\n");
  /** @type {{title: string, line: number, body: string[], isPending: boolean, hasAnchor: boolean}[]} */
  const out = [];
  let current = null;
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
    }
    if (inFence) {
      if (current) {
        current.body.push(line);
      }
      return;
    }
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      const title = m[1];
      const isPending = UNRELEASED_RE.test(title);
      current = {
        title,
        line: i + 1,
        body: [],
        isPending,
        hasAnchor: false,
      };
      out.push(current);
      return;
    }
    if (current) {
      current.body.push(line);
    }
  });
  /* 锚写在段落标题下面(或紧贴标题的那几行),只认段落开头 6 行 —— 认成「段落里的
   * 任意一行有 `<!-- since:`」会让正文里一句**讨论锚本身的**话被当成本段落的锚。 */
  for (const s of out) {
    const head = s.body.slice(0, 6);
    s.hasAnchor = head.some((l) => ANCHOR_RE.test(l));
  }
  return out;
}

/**
 * 段落里点名的 ISSUE 号集合(去重)。HTML 注释里的 `#N` 不算 —— 锚那一行本身
 * 不带号,但注释里引一句「见 §13.10.5」是常态,别把它数进来。
 * @param {string[]} body
 * @returns {Set<string>}
 */
function issuesIn(body) {
  const set = new Set();
  for (const line of body) {
    const stripped = line.replaceAll(/<!--[\s\S]*?-->/g, "");
    for (const m of stripped.matchAll(ISSUE_RE)) {
      set.add(m[1]);
    }
  }
  return set;
}

/* ── 锚必须在历史里解析得开 ─────────────────────────────────── */

/** 这个 rev 在本仓库历史里存在吗(只读 git,零网络)。 */
function resolves(rev) {
  try {
    execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 锚出现在哪一行(报错要给出行号)。
 *
 * 返回三种:合规的锚(`{rev, slug, line}`)/ 缺锚(`null`)/ **写歪了的**锚
 * (`{malformed: true, text, line}`) —— 第三种与第二种必须分开,见 `LOOSE_ANCHOR_RE`。
 * @param {{title: string, line: number, body: string[]}} section
 * @returns {{rev: string, slug: string, line: number} | {malformed: true, text: string, line: number} | null}
 */
function anchorLineOf(section) {
  for (let i = 0; i < Math.min(6, section.body.length); i++) {
    const line = section.body[i];
    const m = ANCHOR_RE.exec(line);
    if (m) {
      return { rev: m[1], slug: m[2], line: section.line + 1 + i };
    }
    if (LOOSE_ANCHOR_RE.test(line)) {
      return { malformed: true, text: line.trim(), line: section.line + 1 + i };
    }
  }
  return null;
}

/* ── 主流程 ──────────────────────────────────────────────────── */

let text = null;
try {
  text = fs.readFileSync(CHANGELOG, "utf8");
} catch (error) {
  problems.push(
    `读不到 CHANGELOG.md:${error.message} —— 本判据的对象就是它,读不到时判失败,` +
      `不按「没有段落要查」放过(§11.23.3 同款)`,
  );
}

if (text !== null) {
  const sections = parseSections(text);
  const versionSections = sections.filter((s) => VERSION_RE.test(s.title));
  const pending = sections.filter((s) => s.isPending);
  const unreleasedCount = sections.filter((s) => UNRELEASED_RE.test(s.title)).length;

  if (pending.length === 0) {
    problems.push(
      "CHANGELOG.md 里一个待发段落都没有(既没有 `[Unreleased]`、也没有未发布的" +
        " `[x.y.z] - <日期>`)—— 解析规则失灵时本判据会空转、照样报 OK(§11.23.3 同款)",
    );
  }
  if (unreleasedCount === 0) {
    problems.push(
      "CHANGELOG.md 里没有 `## [Unreleased]` 段落 —— 它不存在时,`merge-changelog-fragments.mjs`" +
        " 会直接抛错,而碎片会一直堆在 changelog.d/ 里没人并(立案现场的 ①)",
    );
  }

  /* 段落里的锚:写了的都必须解析得开(下面统一核),没写的**不拦** ——
   * 锚是「这一段从哪儿开始」的可复核记录,不是每段的必修项:新开的待发段落会在
   * **第一次并入时**由 `merge-changelog-fragments.mjs` 顺手上锚(它手上正好有那个
   * 事实),在此之前它本来就没有来源可言。写成「必须带锚」会拦下所有人,而拦下来
   * 的动作恰好是错的 —— 锚要的是**最早的那一个**提交,手抄当前 HEAD 只会让这一段
   * 看起来从今天开始(立案现场 ①)。 */

  /* 版本号的一致性:同一个版本号不许出现两次(一次定版、一次又开一个待发段落)。 */
  const seenVersions = new Map();
  for (const s of sections) {
    const m = VERSION_RE.exec(s.title);
    if (!m || !versionSections.includes(s)) {
      continue;
    }
    const ver = m[1];
    if (seenVersions.has(ver)) {
      problems.push(
        `版本号 ${ver} 在 CHANGELOG.md 里出现了两次(第 ${seenVersions.get(ver)} 行、` +
          `第 ${s.line} 行)—— 同一个版本只能定版一次,重复说明有一次定版被撤销/复制`,
      );
    } else {
      seenVersions.set(ver, s.line);
    }
  }

  /* 锚:解析得开 + 双向归属核对。 */
  for (const s of pending) {
    const anchor = anchorLineOf(s);
    if (!anchor) {
      report.push(`${s.isPending ? "待发" : "?"}\t## ${s.title}\t(无锚)`);
      continue;
    }
    if (anchor.malformed) {
      problems.push(
        `第 ${anchor.line} 行的锚形状不对:\`${anchor.text}\` —— 合规写法是` +
          ` \`<!-- since: <commit> — <slug> -->\`,其中 \`<commit>\` 必须是 ` +
          `7~40 位十六进制。**写歪比不写更贵**:它看上去像一条来源记录,读的人不会` +
          `再去想「这里为什么没有锚」,而实际一个字段都核不了(§13.10.6)`,
      );
      continue;
    }
    report.push(`${s.title}\tsince ${anchor.rev}\t${anchor.slug}`);
    if (!resolves(anchor.rev)) {
      problems.push(
        `第 ${anchor.line} 行的来源锚 \`since: ${anchor.rev}\` 在本仓库历史里解析不出提交 ——` +
          ` 锚是给别人复算用的,写一个日期或写一个不存在的短哈希等于没有锚(§13.10.6)`,
      );
      continue;
    }
    /* 归属核对:锚**之后**的待发段落点名的号,不许出现在锚**之前**的已发布段落里。
     * 「之前」= 文件里排在它下面的那些版本段落(Keep a Changelog 是倒序:新的在上)。 */
    const after = new Set(issuesIn(s.body));
    const earlier = new Set();
    for (const other of sections) {
      if (other === s || other.line < s.line) {
        continue;
      }
      if (other.isPending) {
        continue;
      }
      for (const n of issuesIn(other.body)) {
        earlier.add(n);
      }
    }
    const split = [...after].filter((n) => earlier.has(n)).sort((a, b) => Number(a) - Number(b));
    if (split.length > 0) {
      problems.push(
        `「## ${s.title}」与它**之前**的已发布段落同时点名了 ISSUE ${split
          .map((n) => `#${n}`)
          .join(" / ")} —— 同一条变更的归属被切成了两半,而两端都没写错。` +
          `\n        这是「推翻别人的条目没并入」那一族的形态(立案现场 ②):` +
          `要么把这条挪到它真正属于的那个版本里,要么把那句反向说明写成一句能被读懂的话` +
          `(「本条取代 <哪里> 的说法」),别让两份互相矛盾的记录同时留在账上(§13.10.6)。`,
      );
    }
  }
}

/* ── 输出 ────────────────────────────────────────────────────── */

if (REPORT_ONLY) {
  process.stdout.write(
    `待发段落的来源锚(${report.length} 行):\n${report.map((l) => `  ${l}`).join("\n")}\n`,
  );
  process.exit(0);
}

if (problems.length > 0) {
  console.error(`[changelog-versions] ${problems.length} 处问题(规范 §13.10.6):\n`);
  for (const p of problems) {
    console.error(`  ✗ ${p}`);
  }
  console.error(`\n待发段落与锚的写法见 docs/standards/13-提交与-code-review.md §13.10.6。`);
  process.exit(1);
}

console.log(`[changelog-versions] ✓ 待发段落的来源锚与条目归属一致(${report.length} 个段落)`);
