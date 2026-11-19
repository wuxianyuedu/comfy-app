/**
 * ship-title.mjs — `pnpm ship` 的**标题与比对基线**那一格：PR 标题 / squash 那一行
 * 取自哪一笔，以及 `..HEAD` / `...HEAD` 的区间按哪条引用算（ISSUE #3021）。
 *
 * ── 为什么单独一件 ─────────────────────────────────────────────
 *
 * 这一段与 `ship-platform.mjs` 里那三段**不是同一个变化方向**：那边跟着「平台对我们
 * 动作的应答」动，这里跟着「标题该取哪一笔、跟哪条分支比」动。上一次它住在
 * `ship-platform.mjs` 里时，加一条「目标分支不是本地 upstream」就把那个文件推过了
 * 900 行硬闸（与 ISSUE #2258 那次拆点的同一条理由）。
 *
 * 本层只做取数与推导：不判绿不绿、不改调用方状态。推导本身仍是 `ship-core.mjs`
 * 的纯函数 `deriveTitle`，这里只负责把读数取出来并念出口。
 *
 * 唯一的例外是**标题形态合规**这一格（ISSUE #4527）：标题会原样落进 PR 页面与
 * squash 提交历史，而 #号的**认领形态**写错时（如 `（#4519/#4520）` 斜杠分隔），
 * 关单格会静默跳过 —— 合并完成、单子还开着。所以取数时顺手判形态
 * （类型前缀 / 长度 / #号认领形态），不合规当场退 2 并给修法；这不是门禁绿红，
 * 是「这份输入能不能用」。
 */
import process from "node:process";

import { claimNumbersFromTitle, issueNumbersFromText } from "./ship-close.mjs";
import { deriveTitle } from "./ship-core.mjs";
import { CODE } from "./ship-codes.mjs";

/**
 * 标题的取数（PR 标题与 squash 那一行共用这一份），并把来源念出口。
 *
 * 为什么不在调用点各写一遍 `git log -1 --pretty=%s`：那一格取的是分支**当前顶端**那一笔，
 * 于是「先把 master 合进来再 `--merge`」把主干那一行写成 `Merge branch 'master' into …`，
 * 「最后补一笔碎片」把它写成 `docs(changelog): …` —— 两条都已上了主干（#2057 / #2055）。
 * 推导本身在 `ship-core.mjs` 的 `deriveTitle`（纯函数），这里只负责取读数。
 *
 * 念出口排在返回**之前**：标题坏了要当场看得见，而不是等 squash 落进历史再回头读 log。
 *
 * @param {{
 *   run: (cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult,
 *   log: (s:string)=>void,
 *   baseRef: string | null,
 *   explicit?: string | null,
 *   platform?: string | null,
 * }} ctx
 *   `platform` 是平台上这条 PR 的现标题（只有合并那一跳回读得到，建 PR 时没有；
 *   给了它，它排在 branch-first 推导之前，ISSUE #2806）
 * @returns {{title:string,source:string}} 标题与它的来源
 */
export function pickTitle({ run, log, baseRef, explicit = null, platform = null }) {
  const subjects = baseRef
    ? run("git", [
        "log",
        "--no-merges",
        "--reverse",
        "--format=%s",
        `${baseRef}..HEAD`,
      ]).stdout.split("\n")
    : [];
  const head = run("git", ["log", "-1", "--pretty=%s"]).stdout.trim();
  const t = deriveTitle({ subjects, head, explicit, platform });
  log(
    `[ship] 标题取自 ${t.source}${baseRef ? `（比的是 ${baseRef}..HEAD）` : ""}：${
      t.title || "(空)"
    }`,
  );
  /* 空标题不进这格：那是「取数都取不到」的另一回事，由 ship-platform 既有的
   * 「取不到标题 ⇒ 不建 PR」守卫负责（消息与退码都是它的）—— 这里只判
   * 「取到了的标题形态合不合规」。 */
  const violations = t.title ? titleLintViolations(t.title) : [];
  if (violations.length > 0) {
    for (const v of violations) {
      log(`[ship] ✗ 标题不合规：${v}`);
    }
    log(
      "[ship] 标题会原样落进 PR 页面与 squash 提交历史 —— 改分支第一笔的提交说明，" +
        '或用 `--title "类型(范围): 描述（#单号）"` 重给一份合规的；ship 不代改标题。',
    );
    process.exit(CODE.NOT_RUN);
  }
  return t;
}

// ── 标题形态合规（ISSUE #4527）──────────────────────────────────────────

/** 标题长度硬上限（cnb-code-commit 技能「PR 规范 → 标题」：50 宜、72 硬上限）。 */
const TITLE_MAX = 72;

/** 认得的类型（cnb-code-commit 技能那一份 + 本仓 master 历史实际在用的 ci/style/revert/build）。 */
const TITLE_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "chore",
  "perf",
  "test",
  "ci",
  "style",
  "revert",
  "build",
];

/** `类型(范围): 描述`；`[WIP] ` 前缀（平台识别的草稿标记）允许出现在类型之前。 */
const TITLE_SHAPE_RE = new RegExp(
  `^(?:\\[WIP\\]\\s*)?(?:${TITLE_TYPES.join("|")})(?:\\([^)]*\\))?:\\s?\\S`,
);

/**
 * 标题形态违规清单（**纯函数**：空数组 = 合规）。
 *
 * 判据与出处：
 *   · 形态 `类型(范围): 描述` —— cnb-code-commit 技能「PR 规范 → 标题」；
 *   · 长度 ≤ 72（同上，硬上限）；
 *   · 每个 `#数字` 都要落在**关单逻辑认得的认领括号形态**里 —— 判定直接复用
 *     `ship-close.mjs` 的 `issueNumbersFromText` / `claimNumbersFromTitle`
 *     （同一份出处，不在这里另写一套括号正则：两套的漂移形态正是 #4524 那次
 *     「斜杠分隔 ⇒ 关单格静默跳过」的根因）。
 *
 * @param {string} title
 * @returns {string[]} 每条违规一句人话（含修法）；空数组 = 合规
 */
export function titleLintViolations(title) {
  const t = String(title ?? "").trim();
  if (t === "") {
    return ["标题为空 —— 写「类型(范围): 描述」，如 feat(ship): 支持标题合规检查"];
  }
  /** @type {string[]} */
  const out = [];
  if (t.length > TITLE_MAX) {
    out.push(`标题 ${t.length} 字符，超过 72 硬上限 —— 描述细节挪进 PR 正文`);
  }
  if (!TITLE_SHAPE_RE.test(t)) {
    out.push(
      "缺「类型(范围): 描述」前缀 —— 类型取 " +
        `${TITLE_TYPES.join("/")}，范围可选，冒号后接描述（如 fix(cli): 修正参数解析）`,
    );
  }
  /* 裸 `#号` 与斜杠分隔都不在认领形态里 —— 关单格只认括号内空格/逗号分隔的 `#号`
   * （全半角括号都行）。这里只拦「写法会让关单静默跳过」的，不拦「不提单号」的。 */
  const claimed = new Set(claimNumbersFromTitle(t));
  for (const n of issueNumbersFromText(t)) {
    if (!claimed.has(n)) {
      out.push(
        `#${n} 不在认领括号形态里 —— 关单格认的是 (#N) / （#N #M）（空格或逗号分隔，` +
          "全半角括号都行）；裸写或斜杠分隔（（#A/#B））会被静默跳过",
      );
    }
  }
  return out;
}

/**
 * 「这次比对的基线引用」：跟着 PR 的目标分支走，不跟着本地 upstream 走（ISSUE #3021）。
 *
 * 现场（PR #3017）：分支 `git push -u` 把 upstream 置成了父分支在远端的副本，
 * 而本地的 `origin/<父分支>` 停在父分支的旧点 —— 于是 `A..HEAD` 把父分支上**别人后加的**
 * 提交也算进来：标题取成别人的那一笔，diffstat 涨到 999 个文件，而平台按 `base.ref`
 * 的当前顶端算出来只有 3 个。两处区间（`..HEAD` 与 `...HEAD`）本来是同一份取数，
 * 所以这里只做一次解析。
 *
 * 三步：① 取「PR 的目标分支」（新建时就是传给 `--base` 的同一条；复用时是平台回读的
 * `base.ref`）；② 取之前先 `git fetch` 刷新这条远端跟踪引用，**过期引用正是那次的真因**；
 * ③ 刷新/解析不成就照实退回 upstream 并明念一句 —— 这一格不静默，也不猜成主干。
 *
 * @param {{run:(cmd:string,args:string[])=>import("./ship-exec.mjs").ExecResult, log:(s:string)=>void, baseRef:string|null, targetBranch:string|null, remote:string|null}} ctx
 * @returns {string|null} 拿去做 `..HEAD` / `...HEAD` 的那个引用；取不到就是 `baseRef`（可能也是 null）
 */
export function diffBaseRef({ run, log, baseRef, targetBranch, remote }) {
  const branch = (targetBranch ?? "").trim();
  if (!branch || !remote) {
    log(
      `[ship] PR 的目标分支取不到 ⇒ 比对区间退回 ${baseRef ?? "(取不到)"}：这一格没有跟随 \`base.ref\`，读数可能串味（栈式 PR 会算进上游那一段别人的提交）。`,
    );
    return baseRef;
  }
  const ref = `${remote}/${branch}`;
  /* fetch 只看它跑没跑起来，不拿退码当结论：真结论是「`ref` 解析得到吗」那一次 verify。 */
  const fetched = run("git", ["fetch", remote, branch]).status === 0;
  const usable = run("git", ["rev-parse", "--verify", "--quiet", ref]).status === 0;
  if (usable) {
    const differs = baseRef !== null && ref !== baseRef;
    /* fetch 没跑起来时**念但不阻断**：引用仍在、仍指向目标分支，一次网络抖动不必然
     * 让结论错，挡住这一跳会把离线 / 平台抽风直接变成 ship 失败；但这份本地引用可能
     * 过期（别人 force-push / 本地久未 fetch），后果要说清楚，由人决定要不要重跑。 */
    const stale =
      "（fetch 没跑起来，用的是本地那份远端跟踪引用 —— 这份引用可能过期" +
      "（别人 force-push / 本地久未 fetch）⇒ 标题与 diffstat 可能跨到别人的提交；建议重跑）";
    log(
      `[ship] 比对区间跟 PR 的目标分支：${ref}..HEAD${differs ? `（本地 upstream 是 ${baseRef}，不是目标分支）` : ""}${fetched ? "（已 fetch 刷新）" : stale}`,
    );
    return ref;
  }
  log(
    `[ship] 目标分支 ${branch} 的 ${ref} 在本地解析不到（fetch ${fetched ? "跑起来了" : "没跑起来"}）⇒ ` +
      `比对区间退回 ${baseRef ?? "(取不到)"}：这一格没有跟随 PR 的 base.ref。`,
  );
  return baseRef;
}
