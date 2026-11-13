/**
 * 「**与主流程互斥的单件动作**」那一段：`--whoami` / `--diagnose` / `--stage-log` /
 * `--gh-logs` / `--rerun-ci` / `--branches` / 单子的领取与结束 / 只补关。
 *
 * ## 为什么它们单独一层
 *
 * 这几种旗标有一个共同形状：**一次只做一件、也不进主流程**（不跑 preflight、不提交、
 * 不轮询）。它们挂在装配层 `ship.mjs` 里时，读的人要在「阶段顺序」中间反复跳过一整片
 * 「这一跳其实根本不往下走」的分支；而它们的变化方向也不在阶段顺序上 —— 加一个独立动作
 * 不动阶段表、改阶段顺序也不动它们。
 *
 * 搬出去的直接原因是 #2504 量的行数：`ship.mjs` 898 行（900 硬闸余量 2 行），
 * 而这一族本月的第五次「顶到闸上才发现」都落在同一个出口上 —— **拆，按职责拆**。
 *
 * ## 分派顺序就是语义
 *
 * 这一段的先后不是随意的，改动前先读每一格自己的注释：
 *
 * 1. `--whoami` 排在最前，且**不 probe cnb**（它一次也不碰平台）；
 * 2. `--diagnose` / `--stage-log` / `--branches` 各自带着「不能和谁同行」的守卫
 *    （只读读数与写动作同屏，会让人以为「看过 = 做过」）；
 * 3. 单子那格（领取 / 结束 / 列表 / 建单）排在 preflight 之前 —— 领一张单不需要
 *    干净工作树，也不该顺手合并什么；
 * 4. 「只补关」只在**没要 `--merge`** 时接管，且要平台侧的落地证明。
 */
import { CODE } from "./ship-core.mjs";
import { runBranches } from "./ship-branches.mjs";
import { closeIssues } from "./ship-close.mjs";
import { runIssueAction } from "./ship-claim.mjs";
import { runIssueComment, runNewIssue } from "./ship-issue-new.mjs";
import { runDiagnose } from "./ship-diagnose.mjs";
import { resolveGhRepo, resolveGhToken, runGhLogs } from "./ship-gh-logs.mjs";
import { runGhPrs } from "./ship-gh-prs.mjs";
import { runStageLog } from "./ship-stage-log.mjs";
import { runRerunCiStage } from "./ship-local.mjs";
import { whoamiLines } from "./ship-ticket.mjs";

/**
 * 环境变量里没有 GitHub 令牌时，回落本机 `gh` CLI 的 keyring（`gh auth token`；
 * `gh auth status` 已认证的开发机直接复用，免得为了一格只读工具再配一份 env）。
 * 取不到（gh 不在 / 未认证）就原样返回 —— 那一格自己念「跳过」。
 *
 * @param {Record<string, string | undefined>} env 进程环境
 * @param {(cmd: string, args: string[]) => {stdout: string, stderr: string, status: number, error: string | null}} run 执行者
 * @returns {Record<string, string | undefined>} 带令牌（或原样）的环境
 */
function withGhKeyringToken(env, run) {
  try {
    const token = run("gh", ["auth", "token"]).stdout.trim();
    return token === "" ? env : { ...env, GITHUB_TOKEN: token };
  } catch {
    return env;
  }
}

/**
 * 「这一跑里人还点名了哪些动作」—— 只读动作的互斥守卫共用这一份清单（排掉自己那一条）。
 *
 * 为什么要共用：`--diagnose` 与 `--stage-log` 是同一条纪律的两个入口（只读、一次只做一件），
 * 清单各抄一份的漂移形态是「新加一枚旗标时只补进其中一份」，于是那一跑会把两个动作
 * 一起接下来、屏幕上只念一个的结论（#2504 拆这一族就是为了让加动作只改一处表）。
 *
 * @param {ReturnType<typeof import("./ship-args.mjs").parseArgs>} opt 解析结果
 * @param {string} self 这一条自己的键名（不进自己那份清单）
 * @returns {string[]} 点名的旗标（人读形态）
 */
function namedActions(opt, self) {
  /** @type {Array<[string, unknown, string]>} */
  const table = [
    ["whoami", opt.whoami, "--whoami"],
    ["diagnose", opt.diagnose, "--diagnose"],
    ["stageLog", opt.stageLog, "--stage-log"],
    ["ghLogs", opt.ghLogs, "--gh-logs"],
    ["ghPrs", opt.ghPrs, "--gh-prs"],
    ["merge", opt.merge, "--merge"],
    ["closeIssue", opt.closeIssue, "--close-issue"],
    ["cleanBranch", opt.cleanBranch, "--clean-branch"],
    ["branch", opt.branch !== null && opt.branch !== undefined, "--branch"],
    ["message", opt.message !== null && opt.message !== undefined, "--message"],
    ["messageFile", opt.messageFile !== null && opt.messageFile !== undefined, "--message-file"],
    ["title", opt.title !== null && opt.title !== undefined, "--title"],
    ["add", opt.adds.length > 0, "--add"],
    ["allowStaged", opt.allowStaged === true, "--allow-staged"],
    ["only", opt.only, "--only"],
    ["reap", opt.reap, "--reap"],
    [
      "mode",
      (opt.mode !== null && opt.mode !== undefined) || (opt.modeBad ?? []).length > 0,
      "--mode",
    ],
    ["claim", opt.claim !== null && opt.claim !== undefined, "--claim"],
    ["release", opt.release !== null && opt.release !== undefined, "--release"],
    ["claims", opt.claims, "--claims"],
    ["branches", opt.branches, "--branches"],
    [
      "newIssue",
      (opt.newIssue !== null && opt.newIssue !== undefined) || opt.newIssueBad.length > 0,
      "--new-issue",
    ],
    [
      "comment",
      (opt.comment !== null && opt.comment !== undefined) || opt.commentBad.length > 0,
      "--comment",
    ],
    ["bodyFile", opt.bodyFile !== null && opt.bodyFile !== undefined, "--body-file"],
    /* `--pr-body-file` 是主流程那一段的输入（建 / 复用 PR 时注入正文），只读那几条
     * 动作没有执行者 —— 与其它主流程旗标同一档：不静默收下。 */
    ["prBodyFile", opt.prBodyFile !== null, "--pr-body-file"],
    ["rerunCi", opt.rerunCi, "--rerun-ci"],
  ];
  return table.filter(([key, on]) => on && key !== self).map(([, , label]) => label);
}

/**
 * @param {{
 *   opt: ReturnType<typeof import("./ship-args.mjs").parseArgs>,
 *   run: (cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult,
 *   log: (s: string) => void,
 *   relay: (r: {stdout: string, stderr?: string}) => void,
 *   probeCnb: () => boolean,
 *   slug: string | null,
 *   up: {remote: string | null, base: string | null, source: string},
 *   localBranch: string,
 *   root: string,
 *   handle: string,
 *   whoSource: string,
 *   explicitHandle: string | null,
 *   mkTmp: (name: string, text: string) => string | null,
 *   settle: (codes: number[]) => number,
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => void | Promise<void>,
 * }} io 全部由装配层注入 —— 本模块不自己解析命令行、不自己拼退出码。
 * @returns {Promise<{handled: true, code: number} | {handled: false, cnbOk: boolean}>}
 *   `handled` 为真表示这一跳已经结束（`code` 是退出码）；为假表示继续走主流程，
 *   同时把**这一次 probe** 的结果带出去（装配层后面还要用它，别 probe 第二遍）。
 *   `--gh-logs` 要发网络请求，所以这一层现在是异步的（其余分支照旧同步兑现）。
 */
export async function runStandaloneAction(io) {
  const {
    opt,
    run,
    log,
    relay,
    probeCnb,
    slug,
    up,
    localBranch,
    root,
    handle,
    whoSource,
    explicitHandle,
    mkTmp,
    settle,
    env,
    fetchImpl,
    sleep,
  } = io;
  /* ── `--whoami`：只读自查口（ISSUE #2204）─────────────────────
   * 手工 `cnb pulls post-pull` / `cnb issues post-issue-comment` 不经过 ship，
   * 那两条路的留痕只能靠人照着一条能粘贴的出口做。这个出口一次也不碰平台
   * （甚至不 probe cnb）、不改任何状态，所以在分支守卫与 preflight 之前就返回。 */
  if (opt.whoami) {
    for (const l of whoamiLines({ handle, source: whoSource, root, slug })) {
      log(l);
    }
    return { handled: true, code: CODE.GREEN };
  }
  const cnbOk = probeCnb();

  /* ── `--diagnose`：CI 红了之后的只读取回（ISSUE #2217，规范 §13.10.13）──
   * 排在 preflight 之前、与主流程互斥：红灯现场常常就在 master 上、工作树脏、
   * 也没有新碎片 —— 那些阻塞对「读一跑构建」不成立。它一次也不写平台。 */
  if (opt.diagnose) {
    const clashes = namedActions(opt, "diagnose");
    if (clashes.length > 0) {
      log(`[ship] [ERROR] --diagnose 只读、一次只做一件：不与 ${clashes.join(" / ")} 同跑。`);
      return { handled: true, code: CODE.NOT_RUN };
    }
    return {
      handled: true,
      code: settle([
        runDiagnose({
          run,
          log,
          slug,
          cnbOk,
          sn: opt.diagnoseSn,
          headSha: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
          dryRun: opt.dryRun,
          /* 「上一眼」的基数落在 `.git/` 下 —— 没有它，单发的 diagnose 永远只能说「还在跑」，
             说不出「一格都没推进」（ISSUE #2304）。 */
          root,
        }),
      ]),
    };
  }
  /* ── 取某一格的日志（ISSUE #2455，规范 §13.10.13）──────────────────
   * 与 `--diagnose` 同一条纪律：只读、一次只做一件、排在 preflight 之前 —— 要看绿跑
   * 某一格念了什么的人，常常正在 master 上、工作树脏、也没有碎片，那些阻塞对
   * 「读一格日志」都不成立。它一次也不写平台。 */
  if (opt.stageLog || opt.stageLogBad.length > 0) {
    const clashes = namedActions(opt, "stageLog");
    if (clashes.length > 0) {
      log(`[ship] [ERROR] --stage-log 只读、一次只做一件：不与 ${clashes.join(" / ")} 同跑。`);
      return { handled: true, code: CODE.NOT_RUN };
    }
    if (opt.stageLogBad.length > 0) {
      log(
        `[ship] [ERROR] --stage-log 没点名要读哪一格（${opt.stageLogBad.join(" / ")}）：` +
          "格名或格 id 给一个，例如 pnpm ship --stage-log 受影响用例。",
      );
      return { handled: true, code: CODE.NOT_RUN };
    }
    return {
      handled: true,
      code: settle([
        runStageLog({
          run,
          log,
          slug,
          cnbOk,
          sn: opt.stageLogSn,
          stageRef: opt.stageLogRef ?? "",
          headSha: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
          dryRun: opt.dryRun,
        }),
      ]),
    };
  }
  /* ── `--gh-logs <run-id|pr号>`：直接回读 GA 失败日志（规范 §13.6）──────────
   * 与 `--diagnose` / `--stage-log` 同一条纪律：只读、一次只做一件、排在 preflight
   * 之前。**优先从 CNB 站内读 relay 日志**（ISSUE #3437，站内、稳），缺席才走
   * GitHub API；不必等 ship 判红 —— 显式入口就是
   * 「先看一眼红在哪」。没有令牌时只念一行，不改退码。 */
  if (opt.ghLogs || opt.ghLogsBad.length > 0) {
    const clashes = namedActions(opt, "ghLogs");
    if (clashes.length > 0) {
      log(`[ship] [ERROR] --gh-logs 只读、一次只做一件：不与 ${clashes.join(" / ")} 同跑。`);
      return { handled: true, code: CODE.NOT_RUN };
    }
    if (opt.ghLogsBad.length > 0) {
      log(
        `[ship] [ERROR] --gh-logs 收的是 run id 或 PR 号（${opt.ghLogsBad.join(" / ")}）：` +
          "给一个，例如 pnpm ship --gh-logs 3195 或 pnpm ship --gh-logs run:4242。",
      );
      return { handled: true, code: CODE.NOT_RUN };
    }
    return {
      handled: true,
      code: settle([
        await runGhLogs({
          input: opt.ghLogsRef ?? "",
          /* GitHub 侧的仓库坐标与 CNB 的 `slug` 是两件事：`slug` 来自 origin
           * （`cnb.cool/<org>/<repo>`），拿去打 GitHub API 会 404。镜像仓坐标只认
           * `GITHUB_MIRROR_REPO`（缺省 `wuxianyuedu/comfy-app`）。 */
          repo: resolveGhRepo(env),
          /* CNB 侧优先读 relay 正文（ISSUE #3437）：`slug` 正是 CNB 坐标、
           * `run` 是 ship 的执行者，站内读评论/附件不需要 GitHub 令牌。 */
          cnbIo: slug ? { run, slug } : undefined,
          env,
          log,
          fetchImpl,
          sleep,
          dryRun: opt.dryRun,
        }),
      ]),
    };
  }

  /* ── `--gh-prs [状态|PR号]`：读 GitHub 仓库侧（镜像仓）的 PR 清单 / 单条详情 ──
   * 与 `--gh-logs` 同一条纪律：只读、一次只做一件、排在 preflight 之前。镜像仓
   * 那一侧的 PR（最典型：dependabot[bot] 的依赖升级）在 CNB 侧看不见 —— 这一口
   * 把它们列到台面上，带作者 / 分支 / mergeable / 网页 URL。没有令牌只念一行，
   * 不改退码。 */
  if (opt.ghPrs || opt.ghPrsBad.length > 0) {
    const clashes = namedActions(opt, "ghPrs");
    if (clashes.length > 0) {
      log(`[ship] [ERROR] --gh-prs 只读、一次只做一件：不与 ${clashes.join(" / ")} 同跑。`);
      return { handled: true, code: CODE.NOT_RUN };
    }
    if (opt.ghPrsBad.length > 0) {
      log(
        `[ship] [ERROR] --gh-prs 的值认不出（${opt.ghPrsBad.join(" / ")}）：` +
          "给 open / closed / all（缺省 open）或一个 PR 号，例如 pnpm ship --gh-prs 或 pnpm ship --gh-prs=42。",
      );
      return { handled: true, code: CODE.NOT_RUN };
    }
    return {
      handled: true,
      code: settle([
        await runGhPrs({
          filterRaw: opt.ghPrsRef ?? "",
          /* 镜像仓坐标只认 `GITHUB_MIRROR_REPO`（缺省 `wuxianyuedu/comfy-app`），
           * 不能拿 CNB origin 的 slug 顶替（打 GitHub API 一律 404）。 */
          repo: resolveGhRepo(env),
          /* 令牌三层：`GITHUB_MIRROR_TOKEN` / `GITHUB_TOKEN` 之外，本机 `gh`
           * 已认证时直接复用它的 keyring（`gh auth token`）—— 免得为了这一格
           * 只读工具再配一份 env。取不到就维持原样（那一格自己念「跳过」）。 */
          env: resolveGhToken(env) === "" ? withGhKeyringToken(env ?? {}, run) : env,
          log,
          fetchImpl,
          sleep,
          dryRun: opt.dryRun,
        }),
      ]),
    };
  }

  /* ── 「CI 失败重试」：在当前分支推一个空提交触发平台重新构建（#2289 现场踩出的需求）──
   * 平台 CI 是 push 触发的，没有「重跑按钮」：唯一能重新派生一条流水线的方式就是再推一次。
   * 这一格是**写动作**（commit + push），但只读 cnb、不创建 PR、不轮询 —— 与 `--diagnose`
   * 那种「只读」不同，也和 `--merge` 那一路互斥（排在前、直接返回）。撞红线想重跑的人，
   * 不用再去 cnbcli 翻有没有重跑入口，一句 `pnpm ship --rerun-ci` 即可。 */
  if (opt.rerunCi) {
    return {
      handled: true,
      code: settle([
        runRerunCiStage({
          up,
          branch: localBranch,
          root,
          log,
          run,
          relay,
          opt,
          /* 前置读数（ISSUE #3341）要按 sha 归属当前 head 的 build：slug 与 cnb 在场性
           * 一起传下去；取不到时那一格自己念「没有执行者」，照常执行。 */
          slug,
          cnbOk,
        }),
      ]),
    };
  }
  /* `--issue-body-file` / `--priority` 是 --new-issue 的两格输入。单独给它们等于
   * 「想建单却漏了旗标」—— 静默忽略会让这一跑退回主流程，而人以为单子建好了。 */
  if (
    (opt.issueBodyFile !== null || opt.priority !== null) &&
    (opt.newIssue === null || opt.newIssue === undefined) &&
    opt.newIssueBad.length === 0
  ) {
    log(
      "[ship] [ERROR] --issue-body-file / --priority 只跟 --new-issue 一起用；" +
        "单独给它们不会建任何单子。",
    );
    return { handled: true, code: CODE.NOT_RUN };
  }

  /* ── 分支落地读数（规范 §13.6.5，ISSUE #2427）────────────────────
   * **只读**：它一次也不删。所以它既不需要干净工作树，也不许和任何「显式动作」同行 ——
   * 一起给出会让人以为「看过 = 清过」，而红线 ①（显式动作不许被推断）反过来也成立：
   * 读数不许被推断成动作。 */
  if (opt.branches) {
    const withAction = [
      opt.merge ? "--merge" : null,
      opt.cleanBranch ? "--clean-branch" : null,
      opt.reap ? "--reap" : null,
      opt.rerunCi ? "--rerun-ci" : null,
      opt.claim === null || opt.claim === undefined ? null : "--claim",
      opt.release === null || opt.release === undefined ? null : "--release",
      opt.newIssue === null || opt.newIssue === undefined ? null : "--new-issue",
      opt.adds.length > 0 ? "--add" : null,
      opt.allowStaged === true ? "--allow-staged" : null,
      opt.claims ? "--claims" : null,
      opt.whoami ? "--whoami" : null,
      opt.only ? "--only" : null,
    ].filter(Boolean);
    if (withAction.length > 0) {
      log(
        `[ship] [ERROR] --branches 是只读读数，不能和 ${withAction.join(" / ")} 同行 —— ` +
          `要删请逐条点名，或把 --branches 单独跑一遍再决定。`,
      );
      return { handled: true, code: CODE.NOT_RUN };
    }
    return {
      handled: true,
      code: settle([
        runBranches({
          run,
          log,
          slug,
          remote: up.remote ?? "origin",
          trunk: up.base ?? "master",
        }),
      ]),
    };
  }

  /* ── 单子的领取 / 结束 / 列表（规范 §13.10.11）──────────────────
   * 三条动作都**独立于主流程**：领一张单不需要干净工作树，也不该顺手合并什么。
   * 互斥与前置（cnb / slug / 留痕）在 `runIssueAction` 里判；这里只做分派，
   * 且排在 preflight 之前 —— 否则在 master 上或没有碎片时连「领取」都跑不了。 */
  if (
    (opt.claim !== null && opt.claim !== undefined) ||
    (opt.release !== null && opt.release !== undefined) ||
    opt.claims ||
    (opt.newIssue !== null && opt.newIssue !== undefined) ||
    (opt.comment !== null && opt.comment !== undefined) ||
    (opt.bodyFile !== null && opt.bodyFile !== undefined) ||
    opt.claimBad.length > 0 ||
    opt.releaseBad.length > 0 ||
    opt.newIssueBad.length > 0 ||
    opt.commentBad.length > 0
  ) {
    return {
      handled: true,
      code: settle([
        runIssueAction({
          run,
          log,
          slug,
          cnbOk,
          handle,
          handleSource: whoSource,
          explicitHandle,
          root,
          opt,
          mkTmp,
          createIssue: runNewIssue,
          commentIssue: runIssueComment,
          dryRun: opt.dryRun,
        }),
      ]),
    };
  }

  /* ── 「只补关」那一路（ISSUE #2199）───────────────────────────
   * 人在命令行上点名的号**而本轮没要合并** ⇒ 这一跑的目的就是把早已落地、却没关掉的单子关上
   * （现场是 #2179：内容在 `1a05cd40` 上，单子还挂着）。判据用人自己给的 `--merge`，
   * 不去猜「工作树干不干净」那种间接信号：要连本次改动一起交出去，就照旧
   * `--merge … --close-issue <号>`，那时这些号跟在本轮验真的合并之后一起关。
   * 「凭什么可以关」仍由 `decideCloseIssue` 判 —— 这一路要有一份平台侧的落地证明，
   * 没有证明就退 2，而不是把单子标成完成。 */
  if (opt.closeIssue && opt.closeIssueNumbers.length > 0 && !opt.merge) {
    if (!cnbOk || !slug) {
      log(
        `[ship] 补关这一格没有执行者（${cnbOk ? "仓库 slug 取不到" : "cnb 不在"}）` +
          " ⇒ 不动任何单子，也不猜它关没关。",
      );
      return { handled: true, code: CODE.NOT_RUN };
    }
    log(
      `[ship] 本轮只补关：人点名 ${opt.closeIssueNumbers.map((n) => `#${n}`).join(" ")}` +
        " 而没要 --merge ⇒ 不跑 preflight / commit / push。",
    );
    return {
      handled: true,
      code: settle([
        closeIssues({
          run,
          log,
          slug,
          closeIssue: true,
          landed: null,
          explicit: opt.closeIssueNumbers,
          handle,
          mkTmp,
          asMerged: opt.asMerged,
          dryRun: opt.dryRun,
        }),
      ]),
    };
  }

  return { handled: false, cnbOk };
}
