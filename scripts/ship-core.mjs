#!/usr/bin/env node
/**
 * ship-core.mjs —— `pnpm ship` 的**纯判定层**（规范 §13.6）。
 *
 * 这一层只做一件事：**把外部执行者（平台 build / PR / git 输出）的原文读成三态结论**，
 * 不产生副作用。拆出来不是为了行数好看，而是因为它的输入是**外部形状** ——
 * 平台改字段、加一档状态、把 `data` 从对象换成数组，红都该落在这一层，
 * 而不是落在「编排有没有按顺序走」那一半上。两层的判据因此各自独立：
 * `tests/ship.test.ts` 判这里的取数，`ship.mjs` 的 `main()` 判顺序。
 *
 * 三条贯穿本层的纪律（与 `ship.mjs` 文件头同一条）：
 *   · 只读 `data.*`，**绝不**读信封上的 `status`（那是 HTTP 状态码，与流水线无关）；
 *   · 「取不到」一律回 `null` / `unknown`，**不猜方向** —— 空数组会被读成
 *     「查过了，里面没有我的」，而 null 读成「没拿到列表」，后者才是事实；
 *   · 不抛异常：畸形输入走到 `unknown` 那一档，由调用方退 2。
 */
import fs from "node:fs";
import path from "node:path";

import { resolveGitDir } from "./git-dir.mjs";

/** 退出码三态（与 `premerge-check.mjs` 逐字同口径）。 */
export const CODE = { GREEN: 0, RED: 1, NOT_RUN: 2 };

/** 阶段顺序表。**可反转**：新增/摘掉一段只改这张表 + 对应的 `run*`，不动判决逻辑。
 * `clean-branch` 排在最后：它要的是「合并已经验真」这件事，而那是 `merge` 那一段的产物。 */
export const PHASES = [
  "preflight",
  "commit",
  "push",
  "pull-request",
  "poll",
  "verdict",
  "merge",
  "close-issue",
  "clean-branch",
];

/** build 的终态集合（其余一律当「还没完」）。 */
const TERMINAL = new Set([
  "success",
  "failed",
  "error",
  "cancelled",
  "canceled",
]);
/** build 里「在跑 / 排队」的形态。 */
const RUNNING = new Set(["running", "pending", "queued", "waiting", "created"]);

/**
 * 合并多个阶段的退出码：**`2` 压过 `1`，`1` 压过 `0`**。
 *
 * @param {number[]} codes 已跑过的各段结论
 * @returns {number} 合并后的进程退出码
 */
export function combineShipCodes(codes) {
  if (codes.includes(CODE.NOT_RUN)) return CODE.NOT_RUN;
  if (codes.includes(CODE.RED)) return CODE.RED;
  return CODE.GREEN;
}

/**
 * 解析命令行。未知旗标**不静默忽略** —— 拼错的旗标会被读成「没要那个动作」，
 * 而这里最贵的误读是「以为会合、其实没合」或反之。
 *
 * @param {string[]} argv 参数（不含 node 与脚本名）
 * @returns {{message:string|null,messageFile:string|null,title:string|null,branch:string|null,adds:string[],merge:boolean,closeIssue:boolean,cleanBranch:boolean,reap:boolean,dryRun:boolean,wait:boolean,only:string|null,unknown:string[]}} 解析结果
 */
export function parseArgs(argv) {
  /** @type {{message:string|null,messageFile:string|null,title:string|null,branch:string|null,adds:string[],merge:boolean,closeIssue:boolean,cleanBranch:boolean,reap:boolean,dryRun:boolean,wait:boolean,only:string|null,unknown:string[]}} */
  const out = {
    message: null,
    messageFile: null,
    title: null,
    branch: null,
    adds: [],
    merge: false,
    closeIssue: false,
    cleanBranch: false,
    reap: false,
    dryRun: false,
    wait: true,
    only: null,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--merge") out.merge = true;
    else if (a === "--close-issue") out.closeIssue = true;
    else if (a === "--clean-branch") out.cleanBranch = true;
    else if (a === "--reap") out.reap = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--no-wait") out.wait = false;
    else if (a === "--message" || a === "-m") out.message = argv[++i] ?? "";
    else if (a === "--message-file") out.messageFile = argv[++i] ?? "";
    else if (a === "--title") out.title = argv[++i] ?? "";
    else if (a === "--branch") out.branch = argv[++i] ?? "";
    else if (a === "--add") out.adds.push(argv[++i] ?? "");
    else if (a.startsWith("--message="))
      out.message = a.slice("--message=".length);
    else if (a.startsWith("--message-file="))
      out.messageFile = a.slice("--message-file=".length);
    else if (a.startsWith("--title=")) out.title = a.slice("--title=".length);
    else if (a.startsWith("--branch="))
      out.branch = a.slice("--branch=".length);
    else if (a.startsWith("--add=")) out.adds.push(a.slice("--add=".length));
    else if (a.startsWith("--only=")) out.only = a.slice("--only=".length);
    else out.unknown.push(a);
  }
  return out;
}

/**
 * 一行文字里点名的 issue 号（`#2070` / `(#2070)` 两种写法都认，按出现顺序去重）。
 *
 * ⚠️ **只许喂 squash 那一行的「标题本体」，不许喂拼完 PR 号的那一整行**：
 * `mergeAndVerify` 发给平台的是 `${title} (#${number})`，而那个尾数是 **PR 号**
 * （本仓 PR 号与 issue 号共用一套编号空间，`#2110` 既是一条 PR、也可能正好是
 * 某个人的 issue）。拿整行去提号就会把「关掉这个 PR」读成「关掉那张 issue」——
 * 而那是一张别人正在用的单子。
 *
 * @param {string} text 标题本体
 * @returns {number[]}
 */
export function issueNumbersFromText(text) {
  /** @type {number[]} */
  const out = [];
  for (const m of String(text ?? "").matchAll(/#\s?(\d{2,})/g)) {
    out.push(Number(m[1]));
  }
  return [...new Set(out)];
}

/**
 * 「这一格该不该关、以什么码落」—— 判断与效应分开，才判得动最危险的那一档。
 *
 * 三条口径，方向都是「宁可没做，不可做了还谎称做了」：
 *   · **只跟在验真的合并之后**。`mergeAndVerify` 的回读是两件独立事实
 *     （PR 的 `is_merged` + 碎片真在主干顶端）；没走到那一步就关单，等于把一张
 *     还没落地的单子标成完成 —— 那正是 §11.23 那一族（声明与事实矛盾）在这里的形状。
 *   · 要求了但这一跳没合并 ⇒ **2（没跑起来）并说明**，不是静默跳过。分跳跑
 *     （`--no-wait` → 轮询 → `--merge`）的人在最后一跳才该带这个旗标；把它误带在
 *     轮询那一跳上，屏幕上仍会落「全绿到终态」，而那一格根本没动过 —— 2 压过 0
 *     就是为了让这种误带当场读得出来。
 *   · 标题里没有号 ⇒ 也按 2，并说出「喂进去的是哪一行」。编一个号、或猜分支名里
 *     那串数字，都比不上句实话。
 *
 * @param {{requested: boolean, landedVerified: boolean, title: string}} input
 * @returns {{act: boolean, code: number | null, numbers: number[], reason: string}}
 */
export function decideCloseIssue({ requested, landedVerified, title }) {
  if (!requested) {
    return {
      act: false,
      code: null,
      numbers: [],
      reason: "未要求关单（--close-issue）。",
    };
  }
  if (!landedVerified) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      numbers: [],
      reason:
        "这一跳没有**验真的合并**（合并是显式动作，且要回读到 is_merged + 碎片在主干顶端）" +
        " ⇒ 单子不能标成完成",
    };
  }
  const numbers = issueNumbersFromText(title);
  if (numbers.length === 0) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      numbers: [],
      reason: `落地那一行的标题本体里没有 (#号)：「${title}」`,
    };
  }
  return { act: true, code: null, numbers, reason: "" };
}

/**
 * 「这次要不要先把分支建出来」—— 判断与效应分家（与 `decideCloseIssue` 同一形状）。
 *
 * 四条口径：
 *   · **名字只能由人给**。`feat/…`、`fix/<issue号>-…` 是本仓习惯，不是脚本能推的事实；
 *     从 issue 标题或提交信息里"造"一个名字，等于替这次变更决定它对外叫什么（§13.10.9
 *     同一条纪律：机械的那一半归脚本，判断的那一半归人）。
 *   · **只补那一格拒绝的**：这一格原本只会打印「先 `git checkout -b …`」然后退 1，
 *     于是脚本在「人还没分支」的时刻是旁观者。给了 `--branch` 才动 ref。
 *   · **不把人正在干的活搬走**：已经在**另一条**分支上时停（退 2）—— 那种情形里"建分支"
 *     多半是打错了旗标，而 `git checkout -b` 会把工作树与未提交改动一起带走。
 *   · **幂等**：已经在同名分支上就是「已经做过」，不动 ref、不落红。
 *
 * @param {{requested?: string | null, current: string, existsLocal?: boolean, existsRemote?: boolean}} input
 * @returns {{requested: boolean, act: boolean, code: number | null, branch: string, reason: string}}
 */
export function decideCreateBranch({
  requested = null,
  current,
  existsLocal = false,
  existsRemote = false,
}) {
  const name = (requested || "").trim();
  if (!name) {
    return {
      requested: false,
      act: false,
      code: null,
      branch: "",
      reason: "未要求建分支（--branch）。",
    };
  }
  if (name === "master" || name === "HEAD") {
    return {
      requested: true,
      act: false,
      code: CODE.RED,
      branch: name,
      reason: `分支名是「${name}」⇒ 停：本仓不许直连主干（硬规则 6），换一个名字。`,
    };
  }
  if (current === name) {
    return {
      requested: true,
      act: false,
      code: CODE.GREEN,
      branch: name,
      reason: `已经在 ${name} 上 ⇒ 这一格是幂等（不动 ref）。`,
    };
  }
  if (existsLocal || existsRemote) {
    return {
      requested: true,
      act: false,
      code: CODE.NOT_RUN,
      branch: name,
      reason:
        `${name} 已经存在（${existsLocal ? "本地" : "远端"} ref 查得到）⇒ 不覆盖、不切换：` +
        "接着那条分支干就先 `git checkout " +
        name +
        "` 再跑；要新开一条就换一个名字。",
    };
  }
  if (current && current !== "master" && current !== "HEAD") {
    return {
      requested: true,
      act: false,
      code: CODE.NOT_RUN,
      branch: name,
      reason:
        `当前在 ${current} 上，而 --branch 指的是 ${name} ⇒ 停：` +
        "本脚本不在分支之间搬工作树（那一步该由人看着未提交的改动做）。",
    };
  }
  return { requested: true, act: true, code: null, branch: name, reason: "" };
}

/**
 * 「这次跑完要不要把分支清掉」—— 同样只跟在**验真的合并**之后。
 *
 * 为什么默认关、且必须有 `landed.verified`：合并之后本地那条分支是这些提交**唯一的对象**
 * （squash 落进主干的是另一笔），删错了只能靠 reflog 或平台 PR 找回。而 `ship` 在合并那一跳
 * 已经拿到两件独立事实（PR 的 `is_merged` + 碎片真在主干顶端），只有拿着这两件才谈得上删。
 *
 * 只删**这一次跑的那条分支**：「把所有已合并分支一次清掉」需要另一套判据（squash 形态下
 * `git branch -d` 的祖先判据恒假，实测六条已合并分支全部不肯删），那不在本脚本的动作面里。
 *
 * @param {{requested: boolean, landedVerified: boolean, branch: string}} input
 * @returns {{act: boolean, code: number | null, branch: string, reason: string}}
 */
export function decideCleanBranch({ requested, landedVerified, branch }) {
  if (!requested) {
    return {
      act: false,
      code: null,
      branch: "",
      reason: "未要求清理分支（--clean-branch）。",
    };
  }
  if (!landedVerified) {
    return {
      act: false,
      code: CODE.NOT_RUN,
      branch,
      reason:
        "这一跳没有**验真的合并**（is_merged + 碎片在主干顶端）⇒ 本地那条分支是这些提交" +
        "唯一的对象，不许删",
    };
  }
  const name = (branch || "").trim();
  if (!name || name === "master" || name === "HEAD") {
    return {
      act: false,
      code: CODE.NOT_RUN,
      branch: name,
      reason: `要删的分支名不可用（「${name || "(空)"}」）⇒ 不猜名字、不删别的东西`,
    };
  }
  return { act: true, code: null, branch: name, reason: "" };
}

/**
 * 一份 `changelog.d/` 碎片的首行（按形态门禁的口径，就是段落标题那一行）。
 *
 * 读不到回**空串**：那是「没有读到」，不是「读到空段落」—— 调用方要按「判不了」
 * 处理，不许把它升级成一条否定（`0-x.md` 这类路径在工作树之外、或还没写）。
 * 刻意**不导出**：本模块内两处用它（PR 正文与「单子」读数），对外没有第三个消费者。
 *
 * @param {string} root 仓库根
 * @param {string} rel 碎片相对路径（`changelog.d/408-x.md`）
 * @returns {string}
 */
function fragmentHead(root, rel) {
  try {
    return String(
      fs.readFileSync(path.join(root, rel), "utf8").split("\n", 1)[0],
    ).trim();
  } catch {
    return "";
  }
}

/**
 * 「这次变更挂在哪张单子上」—— **只读数，不拦**。
 *
 * 三条口径，方向都是「把没挂单念出来，而不是逼出一个号」：
 *   · **判的是段落，不是号**：`## Fixed` 意味着这次在改一个缺陷，而那张单子就是
 *     问题报告的本体（症状 / 读数 / 根因），所以它应当在动手**之前**存在；
 *     `## Added` / `## Changed` 这类本来没有诉求单可立的变更，`0-` 那条出口照旧可用
 *     （§13.10.8 第 2 条：「不写」是可核的，「写错」不可核 —— 挂错号会让两张单同时坏）。
 *   · **不是闸**：本函数一次也不参与退码。做成硬闸的必然后果是「为了让读数念出个号，
 *     随手挂一张最近开着的单子」，那正是 §13.10.8 记的那次事故，而这一格本来就
 *     **没有任何判据会红**（号只是个字符串，谁都能填）。
 *   · **读不到就不判**：首行取不到段落标题时按「判不了」处理 —— 宁可不念这一句，
 *     也不要凭一份读不到的文件指控人「没立案」。
 *
 * @param {{root: string, fragments?: string[]}} input 读数字段
 * @returns {{numbers: number[], anonymous: string[], anonymousFixed: string[], lines: string[]}}
 *   `numbers` 是去重后的单号（按出现顺序），`anonymousFixed` 是「段落 Fixed 而号是 0」的那几份
 */
export function ticketReading({ root, fragments = [] }) {
  /** @type {number[]} */
  const numbers = [];
  /** @type {string[]} */
  const anonymous = [];
  /** @type {string[]} */
  const anonymousFixed = [];
  for (const rel of fragments) {
    const name = path.basename(rel);
    const m = /^#?(\d+)-/.exec(name);
    // 不是 `<号>-<slug>.md` 形态的文件（目录说明 `README.md` 之类）没有号这一格可判。
    if (!m) continue;
    if (Number(m[1]) === 0) {
      anonymous.push(name);
      const section = /^#{1,6}\s*([A-Za-z]+)/.exec(fragmentHead(root, rel));
      if ((section?.[1] ?? "") === "Fixed") anonymousFixed.push(name);
    } else {
      numbers.push(Number(m[1]));
    }
  }
  const uniq = [...new Set(numbers)];
  const otherAnonymous = anonymous.length - anonymousFixed.length;
  const lines = [
    `[ship] 单子：${uniq.length ? uniq.map((n) => `#${n}`).join(" ") : "（无）"}` +
      ` · 无号碎片 ${anonymous.length} 份 —— 取自碎片的文件名与首行段落，` +
      "**这一格是读数，不改退码**",
  ];
  if (anonymousFixed.length > 0) {
    lines.push(
      `[ship] ${anonymousFixed.join("、")} 的段落是 \`## Fixed\` 而号是 \`0\` ⇒ ` +
        "**这次在改缺陷，却没有单子**。按 §13.10.9 先立案再动手：那张单就是问题报告的" +
        "本体（症状 / 读数 / 根因），不是给已经写完的改动凑一个编号。",
    );
    lines.push(
      "[ship] 建单的出口（本脚本不替你按下去，也不替你写正文）：" +
        '`cnb issues create-issue --repo <组织>/<仓库> --title "…" --body-file <正文文件>`',
    );
  }
  if (otherAnonymous > 0) {
    lines.push(
      `[ship] 另 ${otherAnonymous} 份无号碎片的段落不是 \`Fixed\` ⇒ §13.10.8 第 2 条` +
        "那条 `0-` 出口照旧可用，这里不报违规。",
    );
  }
  return { numbers: uniq, anonymous, anonymousFixed, lines };
}

/**
 * PR 标题 / squash 那一行的取数 —— 只从给它的读数里推，不起进程。
 *
 * 为什么不是 `git log -1 --pretty=%s`：那一格取的是**这条分支当前顶端**那一笔，而本仓
 * 两条已上主干的行就是被它写坏的 —— 「先把 master 合进来再 `--merge`」把主干那一行写成
 * `Merge branch 'master' into fix/…`（#2057），「最后补一笔碎片」把它写成
 * `docs(changelog): 碎片按合流后的实际落地面重写`（#2055）。squash 之后读者看到的标题
 * 与这次变更的内容无关，而评审的第一件事就是读标题。
 *
 * 优先级（每一档都是可反转的一处，加旗标不改其余）：
 *   ① `--title` —— 人是权威：标题是判断，不该由拓扑决定；
 *   ② 这条分支相对主干带进来的**第一笔非常规提交** —— 一次 PR 一件事，那件事在
 *      分支开口那一笔就说清了；后面的碎片补笔 / 复核样本都是它的尾巴；
 *   ③ HEAD 那一笔 —— 分支上只剩合并节点时的退路，**读得出是退的**；
 *   ④ 空串 —— 两处都没有，交回空由调用方按「没跑起来」处理（不许编一个标题，
 *      也不许把 `--title ""` 发给平台建出一条没有标题的 PR）。
 *
 * @param {{subjects?: string[], head?: string, explicit?: string | null}} input
 *   `subjects` 是按 `git log --no-merges --reverse` 排好的分支自带提交 subject
 * @returns {{title: string, source: "flag" | "branch-first" | "head" | "none"}} 标题与它的来源
 */
export function deriveTitle({ subjects = [], head = "", explicit = null }) {
  const flag = (explicit || "").trim();
  if (flag) return { title: flag, source: "flag" };
  const first = subjects.map((s) => (s || "").trim()).filter(Boolean)[0] ?? "";
  if (first) return { title: first, source: "branch-first" };
  const h = (head || "").trim();
  if (h) return { title: h, source: "head" };
  return { title: "", source: "none" };
}

/**
 * 从 `git remote get-url origin` 里取 `org/repo`。
 *
 * 支持 https 与 ssh 两种形态；取不到就回 `null`，由调用方判「没跑起来」而不是
 * 猜一个仓库名 —— 猜错的代价是把 PR 开到别的仓库上。
 *
 * @param {string} remoteUrl `get-url` 的原文
 * @returns {string | null} 形如 `moon-read/comfy-app-t3`
 */
export function parseSlug(remoteUrl) {
  const s = (remoteUrl || "").trim().replace(/\/+$/, "");
  if (!s) return null;
  const m = s.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? (m[1] ?? null) : null;
}

/**
 * 「远端叫什么、主干基线是哪条」的推导 —— 唯一一份。
 *
 * 为什么要有这一件：这一版此前两处**写死 `origin`**（`git remote get-url origin` 与
 * `git diff origin/master...HEAD -- changelog.d`）。远端名与默认分支**都是每台克隆
 * 机器自己的事实**（`docs/audits/2026-10-12-architecture-risk-review.md` R12-01 记的
 * 正是这一格：并行检出里实测见过 `cnb`，而本检出 `git remote -v` 只有 `origin`）
 * ⇒ 写死哪一边都会在另一边失败。后果不是「少一句提示」：
 * 两条 git 命令都**失败**，而失败在这里长得与「答案为空」一模一样 ——
 * 碎片那一查拿到空串 ⇒ preflight 判「没有 changelog.d 碎片」⇒ **`pnpm ship` 在那台
 * 检出上从第一次跑起就没工作过**，且报的还是一条听起来正当的理由。
 *
 * ── 「上游」与「主干」不是同一件事（这一版栽过的第二格）──────────────
 *
 * `@{u}` 回答的是「这条分支在跟踪谁」。而 `git push -u origin feat/x` 把上游设成
 * **这条分支自己在远端的副本**（`origin/feat/x`）—— 于是拿 `@{u}` 当基线就是
 * `feat/x...HEAD`＝**自己与自己比** ⇒ 恒空 ⇒ 碎片那一查报 0 份 ⇒
 * 「每次推送之后重新跑都被拒」，而 `pnpm ship --merge` 正是推送之后的那一次跑。
 * 所以顺序是「先问它是不是自己」，再退回主干那三条事实。
 *
 * 四档来源，顺序有理由：
 *   ① `@{u}` **且它的分支段不是本地分支自己** —— 那是人显式设的比较目标
 *      （往 release 线开 PR 就是这一形），最贴事实，不许被默认分支顶掉；
 *   ② `refs/remotes/<远端>/HEAD` —— 远端默认分支，git 本地就有这条符号引用，零网络；
 *   ③ 唯一远端 + `<远端>/master` —— 新建分支还没上游、且这台克隆没设过 remote HEAD
 *      时的合理推法，**打印时标明是推的**（默认分支不叫 master 时它会偏，但偏了会被
 *      下面那条「基线引用不存在 ⇒ 退 2」的判据当场抓住，不会静默变成「没有碎片」）；
 *   ④ 多个远端且没有上游 ⇒ 交回 `origin`（历史习惯），再没有就给 `null` ——
 *      调用方必须按「没有执行者」处理，不许拿空 diff 冒充结论。
 *
 * @param {{
 *   upstream?: string | null,
 *   remotes?: string[],
 *   localBranch?: string | null,
 *   remoteHead?: string | null,
 * }} input 四条读数（后两条可缺）
 * @returns {{remote: string | null, base: string | null, source: "upstream" | "remote-head" | "sole-remote" | "origin" | "none"}}
 */
export function resolveUpstream({
  upstream,
  remotes = [],
  localBranch = null,
  remoteHead = null,
}) {
  const named = remotes.map((r) => (r || "").trim()).filter(Boolean);
  const u = (upstream || "").trim();
  const slash = u.indexOf("/");
  const remoteFromUpstream = slash > 0 ? u.slice(0, slash) : null;
  const upstreamBranch = slash > 0 ? u.slice(slash + 1) : "";
  if (remoteFromUpstream && upstreamBranch) {
    /* 上游分支段 == 本地分支名 ⇒ 那是这条分支在远端的副本，不是比较目标。
     * `localBranch` 取不到时按①处理：那是「不知道」，不是「相等」，
     * 不该把一份缺的读数升级成一条否定。 */
    const selfCopy = Boolean(localBranch) && upstreamBranch === localBranch;
    if (!selfCopy) {
      return {
        remote: remoteFromUpstream,
        base: u,
        source: "upstream",
      };
    }
    const trunk = trunkFromRemoteHead(remoteFromUpstream, remoteHead);
    if (trunk)
      return { remote: remoteFromUpstream, base: trunk, source: "remote-head" };
    return {
      remote: remoteFromUpstream,
      base: `${remoteFromUpstream}/master`,
      source: "sole-remote",
    };
  }
  const sole =
    named.length === 1
      ? (named[0] ?? null)
      : named.includes("origin")
        ? "origin"
        : null;
  if (!sole) return { remote: null, base: null, source: "none" };
  const trunk = trunkFromRemoteHead(sole, remoteHead);
  if (trunk) return { remote: sole, base: trunk, source: "remote-head" };
  return {
    remote: sole,
    base: `${sole}/master`,
    source: named.length === 1 ? "sole-remote" : "origin",
  };
}

/**
 * 从 `refs/remotes/<远端>/HEAD` 那条符号引用里取出主干 ref。
 *
 * 只认「前缀对得上这个远端」的那一条：拿另一台远端的默认分支当基线，比对的是
 * 别的仓库的历史，而这一格的失败形态又是一条空 diff（不是报错）。
 *
 * @param {string} remote 远端名
 * @param {string | null | undefined} remoteHead `git symbolic-ref` 的原文
 * @returns {string | null} 形如 `cnb/master`；取不到时 null
 */
function trunkFromRemoteHead(remote, remoteHead) {
  const prefix = `refs/remotes/${remote}/`;
  const s = (remoteHead || "").trim();
  if (!s.startsWith(prefix)) return null;
  const branch = s.slice(prefix.length);
  return branch ? `${remote}/${branch}` : null;
}

/**
 * **只**读 build JSON 的 `data.status`。
 *
 * 入参声明成 `any` 是诚实的：它解析的是外部平台的 JSON，形状不由本仓决定，
 * 而本函数的职责恰恰是**在形状不对时给出 `unknown`（⇒ 退 2）而不是抛**。
 * 期望的形状是 `{ status:number, data:{ status:string } }` —— 注意取的是 `data.status`。
 *
 * @param {any} json `cnb … -v` 解析结果
 * @returns {{state:"green"|"red"|"running"|"unknown",raw:string|null}} 判决用的中间态
 */
export function readBuildVerdict(json) {
  const raw =
    json && json.data && typeof json.data.status === "string"
      ? json.data.status
      : null;
  // ⚠️ 这里**故意不看** `json.status`：那是 HTTP 信封（200 只说明「问到了」）。
  if (raw === null) return { state: "unknown", raw: null };
  const low = raw.toLowerCase();
  if (low === "success") return { state: "green", raw };
  if (TERMINAL.has(low)) return { state: "red", raw };
  if (RUNNING.has(low)) return { state: "running", raw };
  return { state: "unknown", raw };
}

/**
 * 在**并行**的 build 列表里挑出属于本次 sha 的那一条。
 *
 * 同一台节点上会同时有多条 `pull_request` build（实测撞过两条并存），而列表项里
 * **没有 PR 号**可锚 —— 唯一可靠的归属键是 `sha`。取不到就回 `null`（⇒ 阶段判
 * 「没跑起来」），**不许**退化成「拿最新那条」：那等于把别人的绿灯读成自己的。
 *
 * @param {any[] | null | undefined} builds 平台返回的列表（外部形状，逐条判字段）
 * @param {string} sha 本次要归属的 commit sha
 * @returns {{sn:string,createTime:string} | null} 命中的 build（多条取最新）
 */
export function pickBuildForSha(builds, sha) {
  if (!Array.isArray(builds) || !sha) return null;
  /** @type {{sn:string,createTime:string}[]} */
  const hit = [];
  for (const b of builds) {
    if (
      b &&
      typeof b.sha === "string" &&
      b.sha.toLowerCase() === sha.toLowerCase() &&
      b.event === "pull_request" &&
      typeof b.sn === "string"
    ) {
      hit.push({ sn: b.sn, createTime: String(b.createTime || "") });
    }
  }
  if (hit.length === 0) return null;
  hit.sort((x, y) => y.createTime.localeCompare(x.createTime));
  return hit[0] ?? null;
}

/**
 * 「这一眼与上一眼是不是同一件事」的签名 —— 轮询用它判**有没有在动**，不判绿不绿。
 *
 * 为什么需要它：预算 45 分钟是按墙钟烧的，而实测烧完之后常见的是「20 次读数一模一样」
 * （按 sha 还没解析到 build，或平台把 build 排在队列里没动）。那种情况下每 20 秒念一遍
 * 同一句话，最后落 exit 2 —— 等待本身没有换来任何新事实，而屏幕上看不出来。
 * 签名取**四件原值**：`sn` / `data.status` / pipeline 的「完成数-总数」/ **stage 的
 * 「完成数-总数」**；任何一件变了都算「在动」，计数器归零。
 *
 * ⚠️ 后一件是 2026-10-22 补的，因为它补的是**一句被现场推翻的话**：本仓的 PR 流水线是
 * **一条 pipeline、三十几个 stage** 的拓扑（实测 `cnb-7d9-1k5h9edct`：`pipelinesStatus`
 * 只有 1 个条目、`stages` 有 33 个），所以 `done-total` 整跑都停在 `0-1` —— 只看 pipeline 级
 * 计数的版本会把一条**正在推进**的流水线（28/33 格已完成）读成「连着 10 眼一模一样」而掐掉。
 * stage 级计数才是这条拓扑上唯一会动的量；而运行中的那一格 `duration` 是占位值 `0`
 * （同一眼 `cnb-7d9-1k5h9edct` 里在跑的那格就是 `dur=0`，平台按格缓冲），所以也不能拿时长当进度。
 *
 * @param {any} json `cnb build get-build-status -v` 的解析结果（外部形状）
 * @param {string} sn 这一眼归属的 build sn（列表里取到的那条）
 * @returns {string} 形如 `cnb-xxx-yyy/success/1-1+12/33`；没解析到 build 时形如 `(未解析到 build)/?/0-0+0/0`
 */
export function buildSignature(json, sn = "") {
  const d = (json && json.data) || null;
  const status = d && typeof d.status === "string" ? d.status : "(取不到 data)";
  const entries =
    d && d.pipelinesStatus && typeof d.pipelinesStatus === "object"
      ? Object.values(d.pipelinesStatus)
      : [];
  const total = entries.length;
  const done = entries.filter(
    (p) =>
      p && typeof p.status === "string" && !RUNNING.has(p.status.toLowerCase()),
  ).length;
  /* stage 级：把每条 pipeline 的 `stages[]` 汇起来数完成格。缺 `stages`（外部形状不完整）
   * 时按 0 计，签名照样稳定可比 —— 这里不替平台补一个「大概在进行」的形状。
   * ⚠️ 判「完成」比 pipeline 级多排除一个 `start`：平台那一层的词汇里**运行中的那一格就叫
   * `start`**（且它的 `duration` 是占位 `0`，见上面那段），照 `RUNNING` 那份集合会把它数成
   * 已完成 —— 于是「pending → start」这一步推进在签名里看不见，正是要防的那种念法。 */
  let stageTotal = 0;
  let stageDone = 0;
  for (const p of entries) {
    /** @type {{ status?: unknown }[]} */
    const stages = p && Array.isArray(p.stages) ? p.stages : [];
    stageTotal += stages.length;
    stageDone += stages.filter(
      (s) =>
        s &&
        typeof s.status === "string" &&
        !RUNNING.has(s.status.toLowerCase()) &&
        s.status.toLowerCase() !== "start",
    ).length;
  }
  return `${sn || "(未解析到 build)"}/${status}/${done}-${total}+${stageDone}/${stageTotal}`;
}

/**
 * 读 PR JSON 的判决字段（同样只读 `data.*`）。
 *
 * @param {{data?:{number?:number|string,mergeable_state?:string,blocked_on?:string,is_merged?:boolean,state?:string}} | null} json 解析结果
 * @returns {{number:number|null,mergeableState:string,blockedOn:string,isMerged:boolean,state:string}} 归一后的字段
 */
export function readPullVerdict(json) {
  const d = (json && json.data) || {};
  return {
    number: d.number === undefined ? null : Number(d.number),
    mergeableState: String(d.mergeable_state ?? "unknown"),
    blockedOn: String(d.blocked_on ?? ""),
    isMerged: d.is_merged === true,
    state: String(d.state ?? "unknown"),
  };
}

/**
 * 从 `cnb pulls list-pulls -v` 的 JSON 里按 head 分支名找已存在的 PR（幂等用）。
 *
 * @param {any} json 解析结果（外部形状，可能是裸数组也可能是 `{data:[…]}`）
 * @param {string} branch 源分支名（不含 `refs/heads/`）
 * @returns {number | null} 命中则给 PR 号
 */
export function findPullForBranch(json, branch) {
  const raw = json && json.data;
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.data)
      ? raw.data
      : [];
  for (const p of list) {
    const ref = String((p && p.head && p.head.ref) || "");
    if (ref === `refs/heads/${branch}`) return Number(p.number);
  }
  return null;
}

/**
 * 把 `changelog.d/` 里的碎片标题拼成 PR 正文的**事实部分**。
 *
 * 只搬「盘上已有的字」：段落标题 + 碎片文件名。不写因果、不写「已验证」那类声明
 * （`check-commit-claims.mjs` 会拿提交树复核句式，而 PR 正文迟早会被抄进合并信息）。
 *
 * @param {{root:string,fragments:string[],diffstat:string}} input 量到的事实
 * @returns {string} 正文
 */
export function buildPullBody({ root, fragments, diffstat }) {
  const lines = ["## 本 PR 带的变更碎片（`changelog.d/`）", ""];
  for (const f of fragments) {
    // 首行的读法只有一处（`fragmentHead`）：两处各读各的，就会开始对同一份碎片给两种答案。
    lines.push(`- \`${f}\` → ${fragmentHead(root, f) || "(读不到)"}`);
  }
  lines.push(
    "",
    "## 改动量（`git diff --stat` 对上游）",
    "",
    "```",
    diffstat || "(空)",
    "```",
    "",
  );
  lines.push(
    "> 本段由 `pnpm ship` 拼装，内容全部是它当场量到的事实（碎片标题与 diffstat）。",
    "> 判断、读数与因果请写在下面的正文里 —— 脚本不代写，也不替你签。",
  );
  return lines.join("\n");
}

/**
 * 识别「这条提交信息已经被 `pnpm run` 压成一行」的形状 —— 只判形状，不判内容。
 *
 * 形状从哪来的（本仓实测，两个出口行为不同）：
 *   · `pnpm exec node -e …  "一行<换行>二行"` ⇒ 收到**真换行**；
 *   · `pnpm ship --message "一行<换行>二行"`（即 `pnpm run ship`）⇒ node 手里已成
 *     字面量 `\n`，屏幕上那条回显 `node scripts/ship.mjs "--message" "一行\n二行"` 就是证据。
 * 后果不是「排版难看」：整条信息变成**一行 subject**，而 PR 标题取的就是
 * `git log -1 --pretty=%s` —— 实测那样一份标题被平台拒（响应可解析、`data` 里没有号）。
 *
 * 判据故意保守：**必须**同时满足「没有真换行」与「出现字面量 `\n`」。
 * 单行且不含 `\n` 的正常提交信息不受影响；真换行在的信息（`--message-file` 读出来的、
 * `pnpm exec` 传进来的）也不受影响。代价是一种误判：一行散文里恰好写了字面量 `\n`
 * 且没有真换行 —— 那会被拦下，而拦下的话术直接给出两条出口，不是死路。
 *
 * @param {string | null | undefined} msg 拿到的提交信息原文
 * @returns {boolean} 命中改写形状时为 true
 */
export function looksNewlineMangled(msg) {
  if (!msg) return false;
  return !msg.includes("\n") && msg.includes("\\n");
}

/**
 * `--dry-run` 的命令计划。它打印的就是真跑时会执行的同一份 argv ——
 * 这是量具自证：计划与执行分叉，说明有人在两处各写一遍（`tests/ship.test.ts`
 * 拿「模块+工具对同集合」逐条对账钉着这件事）。
 *
 * ⚠️ 它**不**保证恒退 0：dry-run 免掉的是「执行写动作」，不免掉「报出阻塞」。
 * 正在 `master` 上、或缺 `changelog.d/` 碎片时照样退 1 —— 一个会藏掉阻塞事实的
 * 预览比不预览更糟。
 *
 * @param {{branch:string,sha:string,slug:string,adds:string[],hasMessage:boolean,merge:boolean,closeIssue?:boolean,cleanBranch?:boolean,reap?:boolean,createBranch?:string|null,remote?:string|null,baseBranch?:string|null}} st 当前状态
 * @returns {string[]} 逐条命令
 */
export function planCommands(st) {
  const p = [];
  const remote = st.remote || "origin";
  const trunk = st.baseBranch || "master";
  /* 建分支排在最前面：它是 `--branch` 唯一能改变形状的一格（不在分支上时，后面每一跳
   * 的分支名都取自它）。给了旗标才出现 —— 与合并/关单同一档：默认那份计划里没有这一步。 */
  if (st.createBranch) p.push(`git checkout -b ${st.createBranch}`);
  p.push("git rev-parse --abbrev-ref HEAD");
  p.push("git status --porcelain");
  /* 碎片那一查的**两条**取数都要在计划里出现：执行面是「分支相对主干已提交的 ∪
   * 还没提交的」（#2034 收到并集后就没有 `git ls-files` 这一查了）。计划里留着那条
   * 已经没人执行的命令，等于让 dry-run 教给读者一个取数面 —— 而它恰恰是那次误判的
   * 来源（`ls-files` 数的是目录存量 118 份，恒真）。 */
  p.push(`git diff --name-only ${remote}/${trunk}...HEAD -- changelog.d`);
  p.push("git status --porcelain -- changelog.d");
  p.push("node scripts/check-deps-freshness.mjs");
  for (const a of st.adds) p.push(`git add -- ${a}`);
  if (st.hasMessage) p.push("git commit --message=<提交信息原文>");
  /* 远端名与主干分支都来自解析（`resolveUpstream`），不写死 `origin` / `master` ——
   * 两处都是每台克隆自己的事实，写死时计划与执行两头一起错。 */
  p.push(`git push -u ${remote} ${st.branch}`);
  p.push(`cnb pulls list-pulls --repo ${st.slug} --state open -v`);
  p.push(
    `cnb pulls post-pull --repo ${st.slug} --base ${trunk} --head ${st.branch} --head-repo ${st.slug} --title … --body-file <git目录>/comfy-ship-tmp/ship-pr-body-<pid>.tmp -v`,
  );
  p.push(`cnb build get-build-logs --repo ${st.slug} -v`);
  p.push(`cnb build get-build-status --repo ${st.slug} --sn <sn> -v`);
  p.push(`cnb pulls get-pull --repo ${st.slug} --number <n> -v`);
  if (st.merge)
    p.push(
      `cnb pulls merge-pull --repo ${st.slug} --number <n> --merge-style squash --commit-title "… (#<n>)" -v`,
    );
  /* 阶段 7 也是**伸手改世界**的那一类，所以它在计划里必须看得见 —— 与合并同一档：
   * 不显式给 `--close-issue` 就不出现。`get-issue` 那一条是回读（独立一问），
   * 它不在 WRITE_SHAPES 里，但同样要出现在计划中，否则 dry-run 教的执行面是缺一块的。 */
  if (st.closeIssue) {
    p.push(
      `cnb issues update-issue --repo ${st.slug} --number <n> --state closed --state-reason completed -v`,
    );
    p.push(`cnb issues get-issue --repo ${st.slug} --number <n> -v`);
  }
  /* 清理那一跳的**四条**都要出现在计划里：两条是动作，两条是回读。只写动作不写回读，
   * dry-run 就把「回执即结论」这个形状教给读者 —— 而这一族从不采信回执。 */
  if (st.cleanBranch) {
    p.push(`git push ${remote} --delete ${st.branch}`);
    p.push(`git ls-remote --heads ${remote} ${st.branch}`);
    p.push(`git branch -D ${st.branch}`);
    p.push(`git show-ref --verify --quiet refs/heads/${st.branch}`);
  }
  /* 收尾回收也在计划里看得见。pid 是当场从归属判据取的，所以这一行按**形状**写 ——
   * 计划教的是「这一跳会发哪类命令、收完还要回读哪一句」，不是假装预先知道 pid。 */
  if (st.reap) {
    p.push(
      "node scripts/reap-process.mjs <pid>（逐个；pid 只取 runningAppInstances 里 via port 那批）",
    );
    p.push(
      "再读一次 runningAppInstances 作为回读 —— 回读说还在 ⇒ 红；via session ⇒ 这一格不收、落 2",
    );
  }
  return p;
}

/**
 * 读 pre-push 落的合并前证明（机器本地、**不入库**，见 `premerge-proof.mjs`）。
 *
 * @param {string} root 仓库根
 * @param {(cwd?:string)=>string | null} [resolve] git 目录解析器 —— 默认那份唯一实现；
 *   调用方注入了自己的解析器时**必须一起传进来**，否则这一格读的是这台机器的真实 `.git`
 * @returns {{headSha?:string,upstreamSha?:string,verifiedAt?:string,baselineRed?:string[]} | null} 取不到回 null
 */
export function readProof(root, resolve = resolveGitDir) {
  /* git 目录的解析不在这里重做 —— 唯一实现见 `scripts/git-dir.mjs`。
   * 这里此前自己判「`.git` 是文件就当指针读」，只覆盖 worktree 那一种，
   * `GIT_DIR` 与裸仓库一个都不认；手写一份弱化的同一件事，比不写更难被发现。
   *
   * `resolve` 是这一次跑**已经注入的那一份**解析器：证明的读取也归它管，否则
   * 注入只覆盖临时文件那一半，另一半点的是这台机器真实的 `.git` —— 「同一次跑里
   * git 目录指哪儿」就会有两套答案（用例里表现为本地绿、节点红）。 */
  const gitDir = resolve(root);
  if (!gitDir) return null;
  try {
    return JSON.parse(
      fs.readFileSync(path.join(gitDir, "comfy-premerge-proof.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * `cnb build get-build-logs -v` 的 data 形状在版本间有两种（裸数组 / `{data:[…]}`）。
 * 两种都收，取不到就回 null —— **不回空数组**：空数组会被 `pickBuildForSha` 读成
 * 「列表拿到了、里面没有我的」，而 null 读成「没拿到列表」，后者才是「没跑起来」。
 *
 * @param {any} json 解析结果
 * @returns {any[] | null} 列表或 null
 */
export function asArray(json) {
  const d = json && json.data;
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  return null;
}
