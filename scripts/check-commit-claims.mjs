#!/usr/bin/env node
/**
 * check-commit-claims.mjs — 「提交信息里的声明 ⇄ 那次提交的事实」的核对器
 * （规范 §11.23 那一族的**新载体**：声明写在提交信息里；§13.6.2 的 `--base` 链是它的执行者）。
 *
 * ── 立案现场 ──────────────────────────────────────────────────────────
 *
 * `ad81a912`（PR #1580 的 squash）的提交信息自称：
 *
 *   > `master` 新增的 §13.5.13 / §13.6.3 两节与各处插记照旧保留
 *
 * 而那次提交的树里那两节**一次都不出现**（`git show ad81a912:<真规范文件> | grep -c` = 0），
 * 62 份文件被退回。这句话从写下到进 `master`，**经过的每一道关都不看它**：平台侧是
 * squash 合并、不跑本地钩子，`#623` 之后也没有 CI 兜底（§13.5.3 / §13.6.2）。
 *
 * 它**不是**「判据在场、没人敲它」（§11.23.1 第一种入口），是**声明本身没有读者** ——
 * 写下一句关于本次 diff 的话，而没有任何东西读它。§11.23 的口径正是为此而写：
 * 声明写得出来不算数，读的人在跑才算。
 *
 * ── 判什么（只判可机械核对的句式，零自然语言理解）──────────────────────
 *
 * 三种句式，各自对应「在那次提交的树上」一次纯 grep / 一次 diff 名单查询：
 *
 *   ① **章节保留** — `§<号> … （照旧）保留` / `§<号> … 不出现`：
 *      该章节标题在**本次提交的树里**存不存在。实测现场就是这一条。
 *   ② **路径没动** — `<路径> … （一个字/一条）没动` / `… 不动`：
 *      该路径在**本次提交的 diff 名单**里出不出现。
 *   ③ **计数归零** — `<门禁标签|脚本路径>… <N> 处 … （收到|降到|归）0`：
 *      跑那条门禁，读它的行数是不是 0。**必须点名执行者**（没有执行者的「读数是 0」
 *      无从复算，猜一个等于误报一片 —— §11.23.4 / §12.18）。
 *
 * **声明是「本次提交的树」上的断言，不是「现在的工作区」**：句子说的是「保留」，
 * 而保留与否只能对着那一版树判；对着工作区判会把「后来又改了」读成「当时说反话」。
 * 所以核对一律走 `git show <commit>:<path>` 与 `git show --name-only <commit>`。
 *
 * ── 它不判什么（都写进 §13.6.2 了，别在这里加回来）────────────────────
 *
 *   · **不核对全文** —— 那是自然语言理解，代价高、误报一片，且会把「把发生了什么事
 *     写清楚」变成**一个要绕过的东西**（§12.18 说的造第二个轮子）；
 *   · **不判「某处声明该不该有」** —— 收益判断，要实测（§11.23.4）。
 *
 * ── 它跑在哪儿（这是与「钩子判据」最不同的一点）────────────────────────
 *
 * **不在 `.githooks/pre-commit`**。丢失发生在平台侧 squash 那一刻，**本地钩子连形态
 * 都看不到**（实测：`ad81a912` / `bdabd26f` / `b9bedd37` 在 `master` 上都是**单亲**，
 * 提交信息里却带 `Merge origin/master into …` 字样 —— `check-merge-parents` 判的
 * 「声明是合并就必须真有两个父」在 squash 之后判不出来，因为单亲是它的**正常形态**）。
 *
 * 它挂在 **`base-check` 那条链上**（合并前 / 事后盘点，人点一次就跑一次）：
 * 要判「某句声明 ⇄ 那次提交的树」，必须手上有那次提交的事实，而那正是 `base-check`
 * 已经在算的东西（干净快照 + 上游引用）。挂在那里**零新通道**（§13.6.2 / §13.5.4 的
 * 「按需召唤」那一层：不点不跑）。
 *
 * 用法：
 *   node scripts/check-commit-claims.mjs --commit <rev>        # 核对某次提交（默认 HEAD）
 *   node scripts/check-commit-claims.mjs --range <rev>..HEAD    # 核对一段（逐条提交）
 *   node scripts/check-commit-claims.mjs --commit <rev> --json  # 机器可读
 *   node scripts/check-commit-claims.mjs --list --commit <rev>  # 只列声明，不判（盘点用）
 *   node scripts/check-commit-claims.mjs --report            # 同上（与 §11.23.5 里
 *                                                          # 「只列命中、不判失败」那个入口名一致）
 *
 * ⚠️ **不带参数就是只审 HEAD 一笔**，而「审 HEAD 一笔」当不了合并前的那道判据
 * （ISSUE #2070）：假声明长在批次里较早那笔上时，推送那一刻审的是最新一笔 ⇒ 漏过；
 * 合并之后 HEAD 前进 ⇒ 再没有第二个执行者回头重放。所以**执行者一律交一段区间**：
 * `premerge-check.mjs` 的 `claims` 段交 `<分叉点>..HEAD`（= 本次带进来的那一批），
 * 平台侧 PR 那一格跑的是同一个入口（`node scripts/premerge-check.mjs --only=claims`）。
 * 区间里没有提交（`base == HEAD`）时打一句「无可审，不是判过」并退 **0** ——
 * 那与「spec 写错 / 不是 git 检出」的 **2** 是两件事，别混（§13.6.2）。
 *
 * 退出码：`0` = 声明的**事实**已复算（有反事实声明时会同时打印出来）；`1` = 发现了
 * 与事实矛盾的声明；`2` = 核对过程本身失败（不是 git 检出 / 取不到那个提交 / 句式解析
 * 失灵）—— 与「声明说反话」分开，因为后者是本脚本要**报告**的事实。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

/**
 * 在检出处跑一条 git 命令；失败时回 `null`（由调用点决定这是不是致命）。
 *
 * @param {string[]} args
 * @returns {string | null}
 */
function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/* ── 句式：三种，都只认「能一次 grep / 一次名单查询答出来」的形状 ────── */

/**
 * 哪份文件承载「章节号 ⇄ 标题」的对应。
 *
 * **不写死具体章节**（那是要核的对象），只写「章节标题长什么样住在哪」：
 * 规范正文的标题形态是 `#### 13.5.13 依赖新鲜度：…` / `### 11.23 声明 ⇄ 读者：…`。
 * 扫全部规范文档而不是点名一份 —— 章节号与文件的对应关系是内容，不是本判据的知识。
 */
const STANDARDS_DIR = "docs/standards";

/**
 * ① 章节保留声明（**两种语序**）。
 *
 * 语序 A（`§<号> … 保留`，实测立案现场就是这一形态）：
 *   · `§13.5.13 / §13.6.3 两节与各处插记照旧保留`
 *   · `§13.6.3 两节照旧保留`
 *
 * 语序 B（`保留 … §<号>`）：
 *   · `并保留 master 新增的 §11.24 与声明⇄读者表三行`
 *   · `保留 §11.15，生成物经 pnpm doc:render 重新生成`
 *
 * ── 窗口里只许出现「连接物」，这是这条判据唯一的口径 ──────────────────
 *
 * 第一版用 `§<号>[^\n]{0,60}?保留` 这种自由窗口，在真历史上跑出 **8 处误报**：
 *   · `§16.2.4.57）。 「双击重命名」保留` —— 那个「保留」说的是双击，不是这一节；
 *   · `§11.14，本 PR 在文末新增 §11.15，两侧无实质重叠。 保留` —— 跨了句号；
 *   · `§2.7.1 裁决 layout 动画存量 8 处为「全部保留` —— 同上。
 * 误报的判据活不过一次评审（§11.18.4），所以窗口收紧成**只许连接物**：
 * 并列的其它 `§`号、章节名词（节/章/条/处）、并列连接词（与和及、/）、
 * `master` / `新增` / `的` / `照旧` / `插记`。别的一律不认 —— **宁可漏，不可误报**。
 *
 * 语序 A 里 `§` 与关键词之间的窗口；语序 B 同理（保留 → `§`）。
 */
const SECTION_CONNECTOR =
  String.raw`(?:[\s/、与和及]|§\s*[0-9]+(?:\.[0-9]+)*|两|三|四|各|一|处|节|章|条|插记|照旧|原文|该|这|那|的|新增|master)`;

/** 语序 A：`§<号>` …（连接物）… `保留` / `不出现`。 */
const SECTION_KEEP_AFTER_RE = new RegExp(
  `§\\s*([0-9]+(?:\\.[0-9]+)*)${SECTION_CONNECTOR}*(照旧保留|仍保留|保留|不出现)`,
  "g",
);

/** 语序 B：`保留` …（连接物）… `§<号>`（只认「保留」，`不出现` 不会出现在这个语序）。 */
const SECTION_KEEP_BEFORE_RE = new RegExp(
  `保留${SECTION_CONNECTOR}*(?:master${SECTION_CONNECTOR}*)?§\\s*([0-9]+(?:\\.[0-9]+)*)`,
  "g",
);

/**
 * 同一句里并列的多个章节号（`§13.5.13 / §13.6.3 两节…照旧保留`）要**各算一条**。
 *
 * 为什么不能只取正则抓到的那一个：实测 `ad81a912` 的那句话里**两个**章节都没了，
 * 而只报一个会让「这一句说反了」看起来只涉及一半 —— 声明是一条，但被它点名的章节
 * 是两个，各自都要有自己的读数（「N 处里只查了 1 处」正是本判据要拦的那种静默少查）。
 *
 * 取的是**匹配片段**里的全部 `§`号；语序 A 里最后那个 `§` 是**被保留的那个**，
 * 前面的并列项同属这一句的宾语，所以一起判（它们都该在）。
 */
const SECTION_HEAD_RE = /§\s*([0-9]+(?:\.[0-9]+)*)/g;

/** 声明里出现「不出现」时，断言是**反向**的（章节必须缺席）。 */
const SECTION_ABSENT_HINT = /不出现/;

/**
 * ② 路径没动声明。
 *
 * 形态：`<路径> … 一个字没动` / `<路径> … 一条没动`。
 *
 * ── 候选先按形状收，再由「该提交的树里有没有这个路径」定案 ──────────────
 *
 * 只按形状收是**不够的**：实测 `60/68.75/75rem = 从前的 960/1100/1200，一个数字都没动`
 * 会被形状匹配读成一条路径声明（段首是数字），而它说的是 CSS 宽度值 —— 这条在 400 次
 * 提交里**零真命中、一处假红**，正是「宁可漏，不可误报」要砍掉的那类。
 * 所以定案的条件是：**该候选在该提交的树里真的存在**（整条命中，或 `public/**` 这种
 * 通配按前缀命中）。不存在的候选一律**不构成声明**（连报都不报）—— 散文里提到
 * 一个不存在的「路径」不可能是「它没动」这个断言。
 */
const PATH_UNTOUCHED_RE =
  /(?:^|[\s（(「、,，])((?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)+[A-Za-z0-9_.*/-]*[A-Za-z0-9_.*-]|[A-Za-z0-9][A-Za-z0-9_.-]*\.[A-Za-z0-9]+)([^\n]{0,30}?)(一个字没动|一条没动|没动过|不动了|没动)/g;

/**
 * ③ 计数归零声明 —— **必须点名执行者**。
 *
 * 形态：`<门禁标签 或 scripts/x.cjs> … <N> 处 … 收到 0`。
 * 只要「N 处收到 0」而不点名执行者的，**一律不判**：读数是 0 这件事只有在知道
 * 「谁的读数」时才能复算，猜一个门禁等于误报一片（§11.23.4 的「不做」那一档）。
 */
const COUNT_ZERO_RE =
  /((?:scripts\/[\w.-]+\.(?:cjs|mjs))|(?:[\w-]+[\u4e00-\u9fa5]*))\s*(?:的|里)?\s*(\d+)\s*处[^\n]{0,40}?((?:收到|降到|归|收)\s*0)/g;

/* ── 事实取证：一律对着「那次提交的树」，不碰工作区 ──────────────────── */

/**
 * `git show <commit> --name-only` 的文件名单（即「本次提交动了哪些文件」）。
 *
 * @param {string} commit
 * @returns {Set<string> | null}
 */
function commitFiles(commit) {
  /* `-c core.quotePath=false`：路径要原样（同本文件 `sectionInTree()` 那条，机制见
   * `scripts/changed-scope.mjs` 的文件头「口径 ④」—— git 默认把非 ASCII 路径转义加引号，
   * 本仓有 38 份文件名带非 ASCII 的文件，全在 `docs/` 下）。 */
  const out = git(["-c", "core.quotePath=false", "show", "--name-only", "--format=", commit]);
  if (out === null) {
    return null;
  }
  return new Set(
    out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
}

/**
 * 该提交的树里，有没有承载章节 `<num>` 的标题。
 *
 * ── 为什么扫**整棵规范目录**，而不是「这次改了哪些文档」──────────────────
 *
 * 第一版只扫 `commitFiles(commit)` 里那份名单，理由是「省几次 `git show`」。
 * 实测它**方向反了**：`§x.y 照旧保留` 说的是「这一节还在」——而当这次提交**根本没碰**
 * 那份文档时，那一节当然还在（从父提交继承），偏偏它不在「改过的文件」名单里，
 * 于是被读成「一次都不出现」⇒ **假红**。实测这一条在 400 次提交里贡献了 2 处
 * 假红（`0c38dce0` 的 §11.24、`c9f349ca` 的 §11.15 —— 两节都好好地在树里）。
 * 而真正立案的 `ad81a912` 恰好**改了**那份文档 —— 也就是说「只扫改动文件」这条
 * 捷径只对「已发生的那一次事故」成立，对正常提交全错（典型 §11.18.4 的误报）。
 *
 * 所以扫的是 `git ls-tree <commit>` 给出的**那一版树**里全部规范文档（21 份，
 * 实测代价可忽略）。对着**树**判而不是对着工作区判这条不变：`git show <commit>:<path>`
 * 读的是那一版 blob，后来的补写不会把「当时说反话」洗掉。
 *
 * @param {string} commit
 * @param {string} num 形如 `13.6.3`
 * @returns {{ok: boolean, files: string[]}} 命中该标题的文件（空 = 那节不在）
 */
function sectionInTree(commit, num) {
  /* `-c core.quotePath=false` 是**必须的**：`git ls-tree` 默认把非 ASCII 路径按 C 风格
   * 转义加引号（实测输出是 `"docs/standards/11-\346\265\213..."`），于是下面那条
   * `startsWith("docs/standards/")` 一条都命中不了 —— 名单**静默变成 0 份**，每一句
   * 「保留」都被读成「一次都不出现」。实测这一手在 400 次提交上贡献了 4 处假红
   * （两个提交各 2 节），而输出看起来完全正常（§11.23.1 第二种入口：判据自己静默降级）。 */
  const listing = git([
    "-c",
    "core.quotePath=false",
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    STANDARDS_DIR,
  ]);
  if (listing === null) {
    return { ok: false, files: [] };
  }
  const docs = listing
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.startsWith(`${STANDARDS_DIR}/`) && f.endsWith(".md"));
  /* **地板**：规范目录一份都读不出 = 上面那条解析退化了，不是「这一节不在」。
   * 判据不许静默降级（§11.23.3 的同族口径）—— 报 `ok: false` 让人看见。 */
  if (docs.length === 0) {
    return { ok: false, files: [] };
  }
  /* 标题形态：`#… 13.6.3 ` —— 号后面必须是空白，免得 `13.6.30` 命中 `13.6.3`。 */
  const re = new RegExp(`^#+\\s+${num.replaceAll(".", String.raw`\.`)}\\s`, "m");
  const hits = [];
  for (const f of docs) {
    const body = git(["show", `${commit}:${f}`]);
    if (body !== null && re.test(body)) {
      hits.push(f);
    }
  }
  return { ok: true, files: hits };
}

/**
 * 该提交的树里有没有这个路径（整条命中，或 `x/**` / `x/` 这种前缀命中）。
 *
 * 同 `sectionInTree`：`-c core.quotePath=false` 必须带（非 ASCII 路径默认被转义加引号，
 * 名单会静默变空）。
 *
 * @param {string} commit
 * @param {string} target
 * @returns {boolean}
 */
function pathExistsInTree(commit, target) {
  const listing = git(["-c", "core.quotePath=false", "ls-tree", "-r", "--name-only", commit]);
  if (listing === null) {
    return false;
  }
  const prefix = target.replace(/\*+$/, "");
  for (const f of listing.split("\n")) {
    const file = f.trim();
    if (!file) {
      continue;
    }
    if (file === target || file === prefix || file.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * 跑一条门禁并读它的**行数**（只看输出里有多少非空行，不解释语义）——
 * 计数归零声明的取证。判不准（标签解析不出）时回 `null`，由调用点读成
 * 「无从复算」而不是「声明说反话」。
 *
 * @param {string} target 门禁标签或脚本路径
 * @returns {{count: number} | null}
 */
function gateLineCount(target) {
  const argv = /\.(cjs|mjs|js)$/.test(target) ? ["node", target] : [target];
  const cmd = argv[0];
  if (cmd === undefined) {
    return null;
  }
  try {
    const out = execFileSync(cmd, argv.slice(1), {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { count: out.split("\n").filter((l) => l.trim()).length };
  } catch {
    /* 读不出读数（脚本不存在 / 它自己红了）—— 交给调用点判成「无从复算」。 */
    return null;
  }
}

/* ── 抽取 + 核对 ─────────────────────────────────────────────────────── */

/**
 * 一条「可机械核对的声明」。
 *
 * @typedef {object} Claim
 * @property {"section" | "path" | "count"} kind
 * @property {string} raw 触发它的原句（报错时把它贴回去，人看得见是哪一句）
 * @property {string} target 被点名的对象（章节号 / 路径 / 门禁标签）
 * @property {boolean} [expectAbsent] `section` 专用：`不出现` 那类**反向**断言
 * @property {number} [count] `count` 专用：声明里写的那个读数
 */

/**
 * 成对引号 —— 落在其中任何一对内部的文本是**被人引用的**，不构成声明。
 *
 * 这是**吸收自本族第一版实现**的一条口径（`318ad1d3` 的 `quotedMask`），
 * 它拦的是真历史上的一处误报：`1f629434` 的信息里写着
 *
 *   > 它的提交信息还自称「master 新增的 §13.5.13 / §13.6.3 两节照旧保留」——
 *   > 实测那两节一次都不出现
 *
 * —— 那是**引用致罪那句并当场反驳它**，而那正是本机制**想要**的动作。
 * 把复述读成声明，判据会在「指出别人说反话」这个动作上报红，等于把判据自己的
 * 用途反过来罚了一遍。所以：引号内的匹配一律不认。
 *
 * 刻意**逐对配平**而不是「出现过引号就整行跳过」：实测的反例句同一行里引号外
 * 还有正文，整行跳过会把「同一行的真声明」一起漏掉，而漏得静默（§11.23.1 的病）。
 *
 * @type {Array<[string, string]>}
 */
const QUOTE_PAIRS = [
  ["\u300c", "\u300d"],
  ["\u300e", "\u300f"],
  ["\u201c", "\u201d"],
  ['"', '"'],
];

/**
 * 算出「哪些字符下标落在成对引号内部」。
 *
 * 引号可以跨行（实测：提交信息里的长引用折行写），所以输入是**拼回后的整段正文**、
 * 不是逐行。同一对引号出现嵌套时按「先开后闭」配对 —— 提交信息不是程序，够用且
 * 不会把配平算乱。
 *
 * @param {string} text
 * @returns {boolean[]} 与 text 等长，`true` = 该下标在引号内
 */
/**
 * 引号掩码：`mask[i] === true` 表示下标 `i` 落在某一对引号内部。
 *
 * @param {string} text
 * @returns {boolean[]}
 */
function quotedMask(text) {
  const mask = Array.from({ length: text.length }, () => false);
  for (const [open, close] of QUOTE_PAIRS) {
    let from = 0;
    for (;;) {
      const a = text.indexOf(open, from);
      if (a < 0) {
        break;
      }
      const b = text.indexOf(close, a + open.length);
      if (b < 0) {
        break;
      }
      const end = Math.min(b + close.length - 1, text.length - 1);
      for (let i = a; i <= end; i++) {
        mask[i] = true;
      }
      from = b + close.length;
    }
  }
  return mask;
}

/**
 * 从一份提交信息里抽出**可机械核对的声明**（不做语义理解，只做句式匹配）。
 *
 * @param {string} message
 * @param {string} commit
 * @returns {Claim[]}
 */
export function extractClaims(message, commit) {
  /** @type {Claim[]} */
  const claims = [];
  /* 只看提交信息，不看注释行（`#` 开头的那些是 git 的模板）。
   *
   * **按段落先折行**：提交信息是**手写折行**的（`git log -1 --format=%B` 原文里
   * `§13.5.13 /` 与 `§13.6.3 两节…照旧保留` 就分在两行上），逐行匹配会把
   * 同一句话里的声明与关键词切开 —— 实测漏掉的就是它（`ad81a912` 里 §13.5.13
   * 与 §13.6.3 并列，折行之后只剩后者被看见）。折行口径与 `git log --format=%B` 的
   * 展现一致：空行分段、段内按行首空白拼回，句子仍然是被写下来的那一句。 */
  const body = message
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split("\n")
        .map((l) => l.trim())
        .join(" "),
    )
    .join("\n");
  /* 引号内的匹配一律不认（口径见 `QUOTE_PAIRS` 那段）。掩码按**拼回后的** `body`
   * 算，与下面 `matchAll` 的下标同一坐标系。 */
  const mask = quotedMask(body);
  /**
   * 这个匹配的起点是不是落在引号里。
   *
   * @param {{index: number}} m
   * @returns {boolean}
   */
  const quoted = (m) => mask[m.index] === true;

  /* 语序 A 与语序 B 都是「章节保留」这一类声明 —— 同一种 kind、同一条核对，
   * 分开的只是句式（见两个正则各自的注释）。**同一句话被两个正则同时命中时去重**：
   * `保留 §11.15` 里 `§11.15` 只该算一条声明，重复报会让「说反了几处」翻倍。 */
  const sectionSeen = new Set();
  /**
   * @param {string} raw
   * @param {string} head
   * @param {boolean} absent
   */
  const pushSection = (raw, head, absent) => {
    const nums = [...head.matchAll(SECTION_HEAD_RE)].map((n) => n[1]);
    if (nums.length === 0) {
      return;
    }
    for (const num of nums) {
      if (num === undefined) {
        continue;
      }
      const key = `${raw}\u0000${num}\u0000${absent}`;
      if (sectionSeen.has(key)) {
        continue;
      }
      sectionSeen.add(key);
      claims.push({ kind: "section", raw, target: num, expectAbsent: absent });
    }
  };
  for (const m of body.matchAll(SECTION_KEEP_AFTER_RE)) {
    if (quoted(m)) {
      continue;
    }
    /* `… 不出现` 是**反向**断言（「那节一次都不出现」），与「保留」不是同一件事。 */
    pushSection(m[0], m[0], SECTION_ABSENT_HINT.test(m[2] ?? ""));
  }
  for (const m of body.matchAll(SECTION_KEEP_BEFORE_RE)) {
    if (quoted(m)) {
      continue;
    }
    pushSection(m[0], m[0], false);
  }
  /* 路径声明要过「该提交的树里存在」这一关（理由见 `PATH_UNTOUCHED_RE` 那段）。 */
  const paths = body.matchAll(PATH_UNTOUCHED_RE);
  for (const m of paths) {
    if (quoted(m)) {
      continue;
    }
    const target = m[1];
    if (target === undefined) {
      continue;
    }
    if (!pathExistsInTree(commit, target)) {
      continue;
    }
    claims.push({ kind: "path", raw: m[0].trim(), target });
  }
  for (const m of body.matchAll(COUNT_ZERO_RE)) {
    if (quoted(m)) {
      continue;
    }
    const target = m[1];
    if (target === undefined || m[2] === undefined) {
      continue;
    }
    claims.push({ kind: "count", raw: m[0], target, count: Number(m[2]) });
  }
  return claims;
}

/**
 * 一条声明的核对结果。
 *
 * @typedef {object} AuditRow
 * @property {Claim} claim
 * @property {"holds" | "contradicted" | "unverifiable"} verdict
 * @property {string} detail
 */

/**
 * 一次提交的核对结果。
 *
 * @typedef {object} Audit
 * @property {string} commit
 * @property {string} subject
 * @property {AuditRow[]} rows
 */

/**
 * 核对一条声明（**纯核对**，事实由调用点先取好传进来，好让用例两向都能钉住）。
 *
 * @param {Claim} claim
 * @param {{commit: string}} ctx
 * @returns {{verdict: "holds" | "contradicted" | "unverifiable", detail: string}}
 */
export function checkClaim(claim, { commit }) {
  if (claim.kind === "section") {
    const { ok, files } = sectionInTree(commit, claim.target);
    if (!ok) {
      return { verdict: "unverifiable", detail: "取不到该提交的文件名单" };
    }
    const present = files.length > 0;
    const wantPresent = !claim.expectAbsent;
    if (present === wantPresent) {
      return {
        verdict: "holds",
        detail: present
          ? `§${claim.target} 在该提交的树里（${files[0]}）`
          : `§${claim.target} 确实不在`,
      };
    }
    return {
      verdict: "contradicted",
      detail: present
        ? `声明说它「不出现」，而 §${claim.target} 就在该提交的树里（${files[0]}）`
        : `声明说它「保留」，而 §${claim.target} 在该提交的树里**一次都不出现**`,
    };
  }
  if (claim.kind === "path") {
    const files = commitFiles(commit);
    if (!files) {
      return { verdict: "unverifiable", detail: "取不到该提交的文件名单" };
    }
    const hit = [...files].some(
      (f) => f === claim.target || f.startsWith(claim.target.replace(/\*+$/, "")),
    );
    return hit
      ? {
          verdict: "contradicted",
          detail: `声明说它「没动」，而它在该提交的 diff 名单里`,
        }
      : { verdict: "holds", detail: `确实不在该提交的 diff 名单里` };
  }
  if (claim.kind === "count") {
    const reading = gateLineCount(claim.target);
    if (!reading) {
      return {
        verdict: "unverifiable",
        detail: `跑不出「${claim.target}」的读数（脚本不在 / 它自己红了）`,
      };
    }
    return reading.count === claim.count
      ? { verdict: "holds", detail: `读数是 ${claim.count} 行（声明一致）` }
      : {
          verdict: "contradicted",
          detail: `声明说「${claim.count} 处收到 0」，而「${claim.target}」现在的读数是 ${reading.count} 行`,
        };
  }
  return { verdict: "unverifiable", detail: `未知的声明种类：${claim.kind}` };
}

/**
 * 核对一次提交的全部声明。
 *
 * @param {string} commit
 * @returns {Audit | null}
 */
export function auditCommit(commit) {
  const message = git(["log", "-1", "--format=%B", commit]);
  if (message === null) {
    return null;
  }
  const subject = git(["log", "-1", "--format=%s", commit]) ?? "";
  const full = git(["rev-parse", commit]);
  if (full === null) {
    return null;
  }
  /** @type {AuditRow[]} */
  const rows = [];
  for (const claim of extractClaims(message, commit)) {
    rows.push({ claim, ...checkClaim(claim, { commit }) });
  }
  return { commit: full.trim(), subject: subject.trim(), rows };
}

/**
 * 一段提交区间里的逐条提交（`<rev>..HEAD`；给单个 rev 时只审它一个）。
 *
 * ⚠️ **「取不到」与「区间里没有提交」是两种读数**，此前都折成 `[]` ⇒ 调用点只能报
 * 「取不到要审的提交」，把「这批没带新东西进来」（合法，且是合并前常见的一态）
 * 说成了过程失败。现在：spec 本身跑不动 ⇒ `null`（→ 退 2）；跑通了但 0 笔 ⇒ `[]`
 * （→ 打印「无可审」并退 0）。
 *
 * @param {string} spec
 * @returns {string[] | null}
 */
export function resolveCommits(spec) {
  const out = git(["log", "--format=%H", spec]);
  if (out === null) {
    return null;
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/* ── 输出 ────────────────────────────────────────────────────────────── */

/**
 * 打印一次提交的核对结果。
 *
 * @param {Audit} audit
 * @param {boolean} jsonOut
 */
function printAudit(audit, jsonOut) {
  if (jsonOut) {
    return;
  }
  const short = audit.commit.slice(0, 8);
  if (audit.rows.length === 0) {
    process.stdout.write(`[commit-claims] ${short} 没有可机械核对的声明\n`);
    return;
  }
  process.stdout.write(`[commit-claims] ${short} ${audit.subject}\n`);
  for (const r of audit.rows) {
    const mark = r.verdict === "holds" ? "✔" : r.verdict === "contradicted" ? "✘" : "?";
    process.stdout.write(`  ${mark} ${r.detail}\n`);
  }
}

/** @param {string[]} argv */
function main(argv) {
  const args = argv.filter((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const JSON_OUT = flags.has("--json");
  /* 「盘点档」两个入口名都认：`--list` 是本族自己的写法，`--report` 是
   * §11.23.5 里承诺给用户的那个入口名（`pnpm check:claims -- --report`）。
   * 同一个档只留一个语义（恒 exit 0、只列不判），两个名字指向它 —— 而不是
   * 让两边各写一份「只列」的实现（§12.18 复用优先）。 */
  const LIST_ONLY = flags.has("--list") || flags.has("--report");

  if (!git(["rev-parse", "--is-inside-work-tree"])) {
    process.stderr.write("[commit-claims] 当前目录不是 git 检出\n");
    return 2;
  }

  /* `--commit <rev>` / `--range <a>..<b>`：两个都是「要审哪几次提交」的写法。 */
  const commitArg = args[0] ?? "HEAD";
  const commits =
    args.length > 0 && commitArg.includes("..")
      ? resolveCommits(commitArg)
      : (() => {
          const one = git(["rev-parse", commitArg]);
          return one === null ? null : [one.trim()];
        })();

  if (commits === null) {
    process.stderr.write(`[commit-claims] 取不到要审的提交：「${commitArg}」\n`);
    return 2;
  }
  /* 区间跑通了、里面一笔都没有 —— 那是「这批没带新的提交」，不是核对失败。
   * 报成 2 会让人以为判据坏了；报成「审过 N 笔且都一致」又是假绿。 */
  if (commits.length === 0) {
    process.stdout.write(`[commit-claims] 「${commitArg}」里没有提交 —— 无可审，**不是判过**\n`);
    return 0;
  }

  const audits = [];
  for (const c of commits) {
    const audit = auditCommit(c);
    if (audit === null) {
      process.stderr.write(`[commit-claims] 取不到 ${c} 的提交信息\n`);
      return 2;
    }
    audits.push(audit);
  }

  /** @type {Array<{a: Audit, r: AuditRow}>} */
  const contradicted = audits.flatMap((a) =>
    a.rows.filter((r) => r.verdict === "contradicted").map((r) => ({ a, r })),
  );
  const unverifiable = audits.flatMap((a) => a.rows.filter((r) => r.verdict === "unverifiable"));

  if (JSON_OUT) {
    /* **`--json` 的输出是自足的一份**：结论（`contradicted` / `ok`）也在里面，
     * 消费方不必去把 stdout 与 stderr 合起来读 —— 那条路走不通（夹具与 shell 管道
     * 都会把两个流合并，于是「JSON 后面跟一段人话」变成解析失败；实测撞到过）。 */
    process.stdout.write(
      `${JSON.stringify(
        {
          commits: audits.length,
          verdict: contradicted.length > 0 ? "contradicted" : "ok",
          contradicted: contradicted.length,
          unverifiable: unverifiable.length,
          audits,
        },
        null,
        2,
      )}\n`,
    );
    return contradicted.length > 0 ? 1 : 0;
  }

  /* 人读的那一路一律把 `jsonOut` 传 `false` —— 它的第二参是「抑制输出」而不是
   * 「这是盘点档」。盘点档（`--list` / `--report`）要的恰恰是**把命中列出来**，
   * 传 `LIST_ONLY` 进去会让 `printAudit` 立刻 return ⇒ 盘点档一个字都不打印
   * （正是 §11.23.1 第二种入口：声明在跑、输出是空的）。 */
  for (const a of audits) {
    printAudit(a, false);
  }
  if (LIST_ONLY) {
    return 0;
  }

  if (contradicted.length > 0) {
    process.stderr.write(
      `[commit-claims] ${contradicted.length} 处声明与事实矛盾（规范 §11.23）：\n` +
        contradicted
          .map(
            ({ a, r }) =>
              `  · ${a.commit.slice(0, 8)}：${r.detail}\n     原句：${r.claim.raw.trim()}`,
          )
          .join("\n") +
        "\n",
    );
    return 1;
  }
  if (unverifiable.length > 0) {
    process.stdout.write(
      `[commit-claims] ${unverifiable.length} 处声明无从复算（脚本不在 / 取不到事实）—— 不构成「说反话」的证据\n`,
    );
  }
  process.stdout.write(`[commit-claims] ${audits.length} 次提交的声明都与事实一致\n`);
  return 0;
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  process.exit(main(process.argv.slice(2)));
}
