#!/usr/bin/env node
/**
 * ship-args.mjs —— `pnpm ship` 的**命令行形状**：旗标怎么读、号像不像号（规范 §13.6，ISSUE #2491）。
 *
 * 为什么单独一份：`ship-core.mjs` 在加 `--as-merged` 之前已经 877 行，加上这枚旗标的两种写法
 * 与它的口径说明就是 **907 行** —— 撞上 `check-infra-file-size.cjs` 那道 900 硬闸（无基线、
 * 无 `--update`，出口只有「拆」，见 #2189 同一条纪律）。拆的位置不是随便挑的一段：
 * **这一层跟着「命令行长什么样」动**（新加一枚旗标、多认一种写法、把不合法的输入当场点名），
 * 而留在 `ship-core.mjs` 的那些跟着**外部执行者的读数形状**动（平台 build / PR / git 输出 → 三态）。
 * 两者变化方向不同，混在一起时的老毛病是 #2189 现场量过的：加一段就顶一次闸。
 *
 * 三条口径随这段代码一起搬过来，一字未改：
 *   1. **未知旗标不静默忽略** —— 拼错的旗标会被读成「没要那个动作」，而这里最贵的误读是
 *      「以为会合、其实没合」或反之；所以只有 `unknown` 这个出口，由 `ship.mjs` 决定怎么报。
 *   2. **「像不像号」只在这一处判**（`parseIssueNumberToken`）—— 各写一份正则的漂移形态是
 *      「一种写法能关、另一种不能，而两边都不报错」；PR 号与 issue 号共用编号空间，所以
 *      `--close-issue` 与 `--as-merged` 共用同一个下限（2 位）。
 *   3. **同一枚旗标的两种写法（空格 / 等号）走同一支** —— 分两支的漂移形态是
 *      「空格写法能用、等号写法被当成未知旗标」。
 *
 * @module scripts/ship-args — `pnpm ship` 的旗标解析层（纯函数，不摸世界）
 */
import { SHIP_MODES } from "./ship-mode.mjs";

/**
 * 平台构建号的形状（`cnb-<短码>-<轮次>`，实测 `cnb-68q-1k5sc5kgq`）。
 *
 * `--stage-log` 靠它分「第一段是构建号还是格名」：构建号总是以 `cnb-` 打头并带第二个
 * 连字符，而格名是中文/英文短语（`受影响用例`、`API 文档生成与自检`）或格 id（`stage-27`）。
 * 认不出形状就**整串当格名** ⇒ 走「按 HEAD 归属」那一路，最坏落点是「没找到 pull_request
 * 构建」那句明说的 2，而不是悄悄把构建号读成格名。
 */
const BUILD_SN_SHAPE = /^cnb-[a-z0-9]{2,}-[a-z0-9]{4,}$/i;

/**
 * `--mode` 的值收口：词表外 / 缺值 / 重复都进 `modeBad`，一次也不静默收下。
 *
 * 为什么不静默：拼错的模式会被读成「没要那个动作」（与未知旗标同一族最贵的误读 ——
 * 「以为会全托管跑完，其实什么都没授权」），所以哪怕值看起来眼熟也当场点名。
 * 词表是唯一出处（`ship-mode.mjs` 的 `SHIP_MODES`），这里不抄第二份。
 *
 * @param {{mode: string | null, modeBad: string[]}} out 累积中的解析结果
 * @param {string} tok 命令行上紧跟的值（可能为空串）
 * @returns {void}
 */
function setModeValue(out, tok) {
  if (tok === "") {
    out.modeBad.push(`(缺模式：可选 ${SHIP_MODES.join(" / ")})`);
    return;
  }
  if (!SHIP_MODES.includes(tok)) {
    out.modeBad.push(`词表外：${tok}（可选：${SHIP_MODES.join(" / ")}）`);
    return;
  }
  if (out.mode !== null) {
    out.modeBad.push(`重复的 --mode（前一个 ${out.mode}）`);
    return;
  }
  out.mode = tok;
}

/**
 * 一个命令行 token 是不是合法的 issue 号（`2179` 或 `#2179`）。不是就回 `null`。
 *
 * 「像不像号」只在这一处判：`--close-issue 2179` 与 `--close-issue=2179,2186` 两种写法共用它 ——
 * 各写一份正则的漂移形态是「一种写法能关、另一种不能，而两边都不报错」。
 * 两位是刻意下限：`--close-issue 1` 那种一眼就是打错的输入应当被点名，而不是被当成
 * 「存在一张一号单子」（个位数在本仓是早期真 issue，猜错的代价比多问一句高）。
 *
 * @param {string} token 命令行上的一个 token
 * @returns {number | null}
 */
export function parseIssueNumberToken(token) {
  /* `token` 来自命令行与 TAPD 链接尾段 —— **外部输入**，`string` 只是它的常规形态；
   * 兜底留给真给不出来的时候（与 `run-tests.mjs` 那边的 junit 产物同口径）。 */
  const bare = String(token ?? "").replace(/^#/, "");
  return /^\d{2,}$/.test(bare) ? Number(bare) : null;
}

/**
 * 解析命令行。未知旗标**不静默忽略** —— 拼错的旗标会被读成「没要那个动作」，
 * 而这里最贵的误读是「以为会合、其实没合」或反之。
 *
 * **`--close-issue` 的两种写法**（ISSUE #2199）：
 *   · 裸旗标 = 从本轮落地那一行的标题本体取号（#2070 那批的口径，一字未改）；
 *   · `--close-issue 2179` / `--close-issue #2179` / `--close-issue=2179,2186` = 人点名。
 *     紧跟的 token 只要不像号就停手并把它记进 `closeIssueBad` —— 既不许当未知旗标静默收下
 *     （那会被读成「没要那个动作」），也不许往后吃掉本该属于别的旗标的参数。
 *
 * **`--as-merged <PR号>`**（ISSUE #2491）：只给「只补关」那一路**供证明**，自己不做任何动作。
 * 它存在的原因是那一路原本只会反查「PR 标题里点名的 `(#号)`」，而**每日档自动立案的单子
 * 从不出现在任何 PR 标题里**（提单人是 `ci-daily`，标题是「构建 sn · 事件 · 时刻 · 红在哪一格」）——
 * 于是修法来自另一张人立的单时，那张自动单**结构上**拿不到落地证明，只能人工绕过关单。
 * 人点名这条 PR 之后，脚本仍去平台**回读那条 PR 的 `is_merged` 原值**才关 ⇒ 结论来自执行者，
 * 不来自人的断言（红线 ③：不另立判定）。号共用一套编号空间，所以复用 `parseIssueNumberToken`。
 *
 * **`--comment <号>` + `--body-file <文件>`**（ISSUE #2719）：往单子上写一条**不属于**任何状态
 * 动作的评论（回执、读数、定性说明）。正文只从文件读 —— argv 内联那一族在真机上被反引号
 * 挖过洞（`--message` 的事故同源，§13.6），所以这里不给 `-m` 那种写法。
 * `--body-file` 只服务这一条动作：`--new-issue` 的正文旗标仍叫 `--issue-body-file`（对象不同：
 * 那是单子本体，这是评论正文），两枚都不许单独出现。
 *
 * **`--pr-body-file <文件>`**：建 PR / 复用已有 PR 时**注入人写的正文**。它与
 * `--body-file`（评论）与 `--issue-body-file`（单子本体）是三个对象：这一枚写的是
 * **PR 的正文**。口径见 `ship-pull-body.mjs` 的 `buildPullBody`：给了就更新整篇
 * （人写的正文 + 自动事实段），不给就一个字节都不动 —— 不做的理由是「漂移」：
 * 「只更新自动段」会让同一份正文里的一半来自这一跑、另一半来自上一跑，读的人
 * 分不出哪句是现在的。正文只从文件读（argv 内联那一族被反引号挖过洞，§13.6）。
 *
 * **`--stage-log [<sn>] <格名|格 id>`**（ISSUE #2455）：只读取「某一格念了什么」，绿跑也能用。
 * 它后面跟的是**自由文本**（格名里有空格），所以把紧跟的非旗标 token 全收进来再拼 ——
 * 只取一个 token 的话，未加引号的 `API 文档生成与自检` 会被切成两截，反查必然落空，
 * 而落空给出的那句「这一跑没有这一格」会把人引去怀疑单子，不是怀疑命令行。
 * 首段像构建号形状（`BUILD_SN_SHAPE`）才当构建号收下，否则整串都是格名（走按 HEAD 归属）。
 *
 * **`--no-preflight-d0`**（ISSUE #3200）：关掉阶段 0 的 D0 预跑（默认开：提交之前把钩子
 * D0 组那批只读形态判据先跑一遍，所有红一次报齐，省「阶段 0 红一次、提交钩子再红一次」
 * 的往返）。它存在是因为预跑是**双付**（阶段 0 付一遍、提交钩子还会再付一遍）——
 * 不愿付的人显式关掉；提交那一刻的结论不受这枚旗标影响（钩子照判）。
 * 没有对应的肯定旗标：默认就是开的。
 *
 * @param {string[]} argv 参数（不含 node 与脚本名）
 * @returns {{message:string|null,messageFile:string|null,title:string|null,branch:string|null,adds:string[],merge:boolean,closeIssue:boolean,closeIssueNumbers:number[],closeIssueBad:string[],asMerged:number|null,asMergedBad:string[],cleanBranch:boolean,reap:boolean,allowStaged:boolean,dryRun:boolean,preflightD0:boolean,wait:boolean,whoami:boolean,claim:number|null,claimBad:string[],release:number|null,releaseBad:string[],claims:boolean,branches:boolean,newIssue:string|null,newIssueBad:string[],issueBodyFile:string|null,comment:number|null,commentBad:string[],bodyFile:string|null,prBodyFile:string|null,priority:string|null,diagnose:boolean,diagnoseSn:string|null,stageLog:boolean,stageLogSn:string|null,stageLogRef:string|null,stageLogBad:string[],ghLogs:boolean,ghLogsRef:string|null,ghLogsBad:string[],rerunCi:boolean,only:string|null,mode:string|null,modeBad:string[],unknown:string[]}} 解析结果
 */
export function parseArgs(argv) {
  /** @type {{message:string|null,messageFile:string|null,title:string|null,branch:string|null,adds:string[],merge:boolean,closeIssue:boolean,closeIssueNumbers:number[],closeIssueBad:string[],asMerged:number|null,asMergedBad:string[],cleanBranch:boolean,reap:boolean,allowStaged:boolean,dryRun:boolean,preflightD0:boolean,wait:boolean,whoami:boolean,claim:number|null,claimBad:string[],release:number|null,releaseBad:string[],claims:boolean,branches:boolean,newIssue:string|null,newIssueBad:string[],issueBodyFile:string|null,comment:number|null,commentBad:string[],bodyFile:string|null,prBodyFile:string|null,priority:string|null,diagnose:boolean,diagnoseSn:string|null,stageLog:boolean,stageLogSn:string|null,stageLogRef:string|null,stageLogBad:string[],ghLogs:boolean,ghLogsRef:string|null,ghLogsBad:string[],rerunCi:boolean,only:string|null,mode:string|null,modeBad:string[],unknown:string[]}} 解析结果 */
  const out = {
    message: null,
    messageFile: null,
    title: null,
    branch: null,
    adds: [],
    merge: false,
    closeIssue: false,
    closeIssueNumbers: [],
    closeIssueBad: [],
    asMerged: null,
    asMergedBad: [],
    cleanBranch: false,
    reap: false,
    allowStaged: false,
    dryRun: false,
    preflightD0: true,
    wait: true,
    whoami: false,
    claim: null,
    claimBad: [],
    release: null,
    releaseBad: [],
    claims: false,
    branches: false,
    newIssue: null,
    newIssueBad: [],
    issueBodyFile: null,
    comment: null,
    commentBad: [],
    bodyFile: null,
    prBodyFile: null,
    priority: null,
    diagnose: false,
    diagnoseSn: null,
    stageLog: false,
    stageLogSn: null,
    stageLogRef: null,
    stageLogBad: [],
    ghLogs: false,
    ghLogsRef: null,
    ghLogsBad: [],
    rerunCi: false,
    only: null,
    mode: null,
    modeBad: [],
    unknown: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? "";
    if (a === "--merge") {
      out.merge = true;
    } else if (a === "--whoami") {
      out.whoami = true;
    } else if (a === "--claims") {
      out.claims = true;
    } else if (a === "--branches") {
      out.branches = true;
    }
    /* `--diagnose` 的构建号是**可选**的：不给就按 HEAD 的 sha 归属（红灯现场最常用的
     * 那一形）。所以下一个 token 只在不像旗标时才当构建号收下。 */
    else if (a === "--diagnose") {
      out.diagnose = true;
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-") ? String(argv[++i] ?? "") : "";
      if (tok !== "") {
        out.diagnoseSn = tok;
      }
    } else if (a === "--new-issue") {
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-") ? String(argv[++i] ?? "") : "";
      if (tok.trim() === "") {
        out.newIssueBad.push("(缺标题)");
      } else {
        out.newIssue = tok;
      }
    } else if (a === "--issue-body-file") {
      out.issueBodyFile = argv[++i] ?? "";
    } else if (a === "--priority") {
      out.priority = argv[++i] ?? "";
    } else if (a.startsWith("--diagnose=")) {
      out.diagnose = true;
      const tok = a.slice("--diagnose=".length);
      if (tok !== "") {
        out.diagnoseSn = tok;
      }
    } else if (a === "--stage-log" || a.startsWith("--stage-log=")) {
      /* 紧跟的是**自由文本**（格名里有空格：`API 文档生成与自检`），所以把非旗标的 token
       * 全收进来再拼 —— 只取一个的话，未加引号的格名会被切成两截，反查必然落空，而落空
       * 那句「这一跑没有这一格」会把人引去怀疑单子，不是怀疑命令行。
       * 首段像构建号形状才当构建号（见 `BUILD_SN_SHAPE`）；否则整串都是格名 ⇒ 走按 HEAD 归属。 */
      out.stageLog = true;
      const toks = a.startsWith("--stage-log=") ? [a.slice("--stage-log=".length)] : [];
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")) {
        toks.push(String(argv[++i] ?? ""));
      }
      if (toks.length > 0 && BUILD_SN_SHAPE.test(toks[0] ?? "")) {
        out.stageLogSn = toks[0] ?? null;
        toks.shift();
      }
      const ref = toks.join(" ").trim();
      if (ref === "") {
        out.stageLogBad.push("(缺点名哪一格)");
      } else {
        out.stageLogRef = ref;
      }
    } else if (a === "--gh-logs" || a.startsWith("--gh-logs=")) {
      /* 与 `--diagnose` 同一档：只读、一次只做一件。目标只收**一个** token（run id
       * 或 PR 号），所以这里不像 `--stage-log` 那样吃自由文本；两种写法（空格 / 等号）
       * 共用这一支，避免「一种写法能用、另一种被当成未知旗标」。 */
      out.ghLogs = true;
      let tok = "";
      if (a.startsWith("--gh-logs=")) {
        tok = a.slice("--gh-logs=".length);
      } else if (i + 1 < argv.length) {
        const next = String(argv[i + 1] ?? "");
        if (next.startsWith("-") === false) {
          tok = next;
          i += 1;
        }
      }
      if (tok.trim() === "") {
        out.ghLogsBad.push("(缺 run id / PR 号)");
      } else if (out.ghLogsRef === null) {
        out.ghLogsRef = tok;
      } else {
        out.ghLogsBad.push(`重复的 --gh-logs（前一个 ${out.ghLogsRef}）`);
      }
    } else if (a === "--rerun-ci") {
      out.rerunCi = true;
    } else if (a.startsWith("--new-issue=")) {
      const tok = a.slice("--new-issue=".length);
      if (tok.trim() === "") {
        out.newIssueBad.push("(缺标题)");
      } else {
        out.newIssue = tok;
      }
    } else if (a.startsWith("--issue-body-file=")) {
      out.issueBodyFile = a.slice("--issue-body-file=".length);
    } else if (a.startsWith("--priority=")) {
      out.priority = a.slice("--priority=".length);
    } else if (a === "--claim" || a === "--release") {
      const isClaim = a === "--claim";
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-") ? String(argv[++i] ?? "") : "";
      const n = parseIssueNumberToken(tok);
      if (n === null) {
        if (isClaim) {
          out.claimBad.push(tok || "(缺号)");
        } else {
          out.releaseBad.push(tok || "(缺号)");
        }
      } else if (isClaim) {
        /* 第二次 `--claim` 不静默覆盖第一张：那会把「领两张」读成「领最后那张」，
         * 而屏幕上不会有任何提示。记进 bad，由执行层点名后停手。 */
        if (out.claim === null) {
          out.claim = n;
        } else {
          out.claimBad.push(`重复的 --claim（前一张 #${out.claim}）`);
        }
      } else if (out.release === null) {
        out.release = n;
      } else {
        out.releaseBad.push(`重复的 --release（前一张 #${out.release}）`);
      }
    } else if (a === "--comment") {
      /* 与 `--claim` 同一条「像不像号」判据；**不需要留痕短名** —— 写一条读数不是
       * 「谁在做什么」，未配 handle 时署名行会写「未配」，但评论照样落地。 */
      const tok =
        i + 1 < argv.length && !String(argv[i + 1]).startsWith("-") ? String(argv[++i] ?? "") : "";
      const n = parseIssueNumberToken(tok);
      if (n === null) {
        out.commentBad.push(tok || "(缺号)");
      } else if (out.comment === null) {
        out.comment = n;
      } else {
        out.commentBad.push(`重复的 --comment（前一张 #${out.comment}）`);
      }
    } else if (a === "--body-file") {
      out.bodyFile = argv[++i] ?? "";
    } else if (a === "--pr-body-file") {
      out.prBodyFile = argv[++i] ?? "";
    } else if (a === "--close-issue") {
      out.closeIssue = true;
      while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")) {
        const tok = String(argv[++i] ?? "");
        const n = parseIssueNumberToken(tok);
        if (n === null) {
          out.closeIssueBad.push(tok);
          break;
        }
        out.closeIssueNumbers.push(n);
      }
    } else if (a === "--as-merged" || a.startsWith("--as-merged=")) {
      /* 两种写法共用这一处（与 `--claim=` 同形）：分成两支的漂移形态是「空格写法能用、
       * 等号写法被当成未知旗标」，而屏幕上只会留下一句「没要那个动作」。
       * 它只给「只补关」那一路供证明，自己不做动作 ⇒ 没有 `--close-issue` 时由执行层拒掉。 */
      const tok = a === "--as-merged" ? String(argv[++i] ?? "") : a.slice("--as-merged=".length);
      const n = parseIssueNumberToken(tok);
      if (n === null) {
        out.asMergedBad.push(tok || "(缺号)");
      } else if (out.asMerged === null)
      /* 第二次不静默覆盖第一条：那会把「凭两条 PR 关」读成「凭最后那条」。 */
      {
        out.asMerged = n;
      } else {
        out.asMergedBad.push(`重复的 --as-merged（前一条 #${out.asMerged}）`);
      }
    } else if (a === "--clean-branch") {
      out.cleanBranch = true;
    } else if (a === "--reap") {
      out.reap = true;
    } else if (a === "--allow-staged") {
      /* `--add` 的暂存面默认封闭（ISSUE #3597）：点名之外、已在暂存区的文件会让这一笔
       * 退 2。这一枚是**人的显式放行**，只对「确实要一起走」打开，语义与 `--merge` 同档
       * ——不给就是不许，不给也绝不静默放行。 */
      out.allowStaged = true;
    } else if (a === "--dry-run") {
      out.dryRun = true;
    } else if (a === "--no-preflight-d0") {
      out.preflightD0 = false;
    } else if (a === "--no-wait") {
      out.wait = false;
    } else if (a === "--message" || a === "-m") {
      out.message = argv[++i] ?? "";
    } else if (a === "--message-file") {
      out.messageFile = argv[++i] ?? "";
    } else if (a === "--title") {
      out.title = argv[++i] ?? "";
    } else if (a === "--branch") {
      out.branch = argv[++i] ?? "";
    } else if (a === "--add") {
      out.adds.push(argv[++i] ?? "");
    } else if (a.startsWith("--message=")) {
      out.message = a.slice("--message=".length);
    } else if (a.startsWith("--message-file=")) {
      out.messageFile = a.slice("--message-file=".length);
    } else if (a.startsWith("--title=")) {
      out.title = a.slice("--title=".length);
    } else if (a.startsWith("--branch=")) {
      out.branch = a.slice("--branch=".length);
    } else if (a.startsWith("--add=")) {
      out.adds.push(a.slice("--add=".length));
    } else if (a.startsWith("--only=")) {
      out.only = a.slice("--only=".length);
    } else if (a === "--mode") {
      /* 空格写法：下一个 token 是模式值。词表外 / 缺值 / 重复都进 modeBad（见
       * `setModeValue`），由执行层点名后停 —— 拼错的模式不许被读成「没要那个动作」。 */
      setModeValue(out, String(argv[++i] ?? ""));
    } else if (a.startsWith("--mode=")) {
      /* 等号写法：与空格写法共用同一支，避免「一种写法能用、另一种被当成未知旗标」。 */
      setModeValue(out, a.slice("--mode=".length));
    } else if (a.startsWith("--claim=") || a.startsWith("--release=")) {
      const isClaim = a.startsWith("--claim=");
      const tok = a.slice(a.indexOf("=") + 1);
      const n = parseIssueNumberToken(tok);
      if (n === null) {
        if (isClaim) {
          out.claimBad.push(tok || "(缺号)");
        } else {
          out.releaseBad.push(tok || "(缺号)");
        }
      } else if (isClaim) {
        /* 第二次 `--claim` 不静默覆盖第一张：那会把「领两张」读成「领最后那张」，
         * 而屏幕上不会有任何提示。记进 bad，由执行层点名后停手。 */
        if (out.claim === null) {
          out.claim = n;
        } else {
          out.claimBad.push(`重复的 --claim（前一张 #${out.claim}）`);
        }
      } else if (out.release === null) {
        out.release = n;
      } else {
        out.releaseBad.push(`重复的 --release（前一张 #${out.release}）`);
      }
    } else if (a.startsWith("--pr-body-file=")) {
      out.prBodyFile = a.slice("--pr-body-file=".length);
    } else if (a.startsWith("--comment=") || a.startsWith("--body-file=")) {
      if (a.startsWith("--body-file=")) {
        out.bodyFile = a.slice("--body-file=".length);
      } else {
        const tok = a.slice("--comment=".length);
        const n = parseIssueNumberToken(tok);
        if (n === null) {
          out.commentBad.push(tok || "(缺号)");
        } else if (out.comment === null) {
          out.comment = n;
        } else {
          out.commentBad.push(`重复的 --comment（前一张 #${out.comment}）`);
        }
      }
    } else if (a.startsWith("--close-issue=")) {
      out.closeIssue = true;
      for (const tok of (a.slice("--close-issue=".length) || "").split(/[,\s]+/)) {
        if (tok === "") {
          continue;
        }
        const n = parseIssueNumberToken(tok);
        if (n === null) {
          out.closeIssueBad.push(tok);
        } else {
          out.closeIssueNumbers.push(n);
        }
      }
    } else {
      out.unknown.push(a);
    }
  }
  return out;
}
