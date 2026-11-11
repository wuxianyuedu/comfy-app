#!/usr/bin/env node
/**
 * `ci-ga-daily-failure-issue.mjs` —— GA 镜像仓 `Daily (mirror)` 跑红时，把它变成一张 CNB 单。
 *
 * ## 补的是哪一格：判据在场、执行者不在场
 *
 * GA 每日档（`.github/workflows/daily.yml`）承接了 `全量E2E` / `单元测试` —— PR 档不跑这两格，
 * 所以它一红就是主干一天没有行为面读数。而把「红了」变成单的执行者此前只挂在 CNB 侧
 * （`.cnb.yml` 的 `每日失败立案` = `ci-daily-failure-issue.mjs`），那一格判的是 **CNB 自己的
 * 上一跑**（取 CNB build 列表 / 逐格详情），GA 这一跑不在它的读数面里。于是 GA 每日档红在
 * 「没人想起来去问」的那一天等于没发生（现场：换页漏更 E2E，靠人手动读 `gh run --log-failed`
 * 再手动立案）。这一格把那条交接补上：GA 跑红 ⇒ 自动在 CNB 出现一张按格名去重的单。
 *
 * ## 落点是**下游 job**（`needs: daily` + `if: failure()`），且自己坏掉不叠第二个红
 *
 * 它判的是**这一跑自己**（与 CNB 那一格判「上一跑」不同），但**不能跑在 `daily` 内部**：
 * 唯一的红格来源是 jobs API 的 `steps[].conclusion`，而 step 形态下那个 job 自己还在
 * `in_progress` —— 实测读回 **0 个红格**（run `42915112854`：`单元测试` 22:39:17 判 failure，
 * 立案步 22:39:17→22:39:19 就跑了，打印「红格 0 个」⇒ 零写入，#3563）。这里原先写的
 * 「jobs API 在本格运行时已把前面那些红格的 conclusion 写好了」是**未经复核的前提**，
 * 已被那一跑推翻；API 是「在飞的 job 根本不报」还是「报得慢」没有结论，而下游 job 形态
 * 在两种成因下都成立（上游已 `completed`，conclusion 是终值），所以不必先分清成因。
 * ⚠️ 别改回 step 形态，也别在 job 内部轮询等自己 completed —— 那是死锁。
 *
 * job 带 `continue-on-error: true`，脚本带 `--no-block`：这一格自己发没发出去不该反过来
 * 给本 run 叠第二个红 —— 但**不静默**，失败时把红话原样打印并给可粘贴的手工出口
 * （由用例钉住「不许改成静默 return」）。
 *
 * ## 判决链一个字都不另立（复用优先）
 *
 * 平台调用层整段复用 `ci-code-scanning-triage-platform.mjs`（它正是「GA 托管 runner 上没有
 * cnb CLI ⇒ 走 HTTP」那一格）：`ghGet` 读自身 run 的 jobs、`listOpenIssues` 取开着的单、
 * `createIssue` 建单 → 补标签 → 独立回读、`appendComment` 追加并回读、`ensureLabel` 备标签。
 * 这里只新增三件纯函数：**「哪几格算红」**（`failedStepsFromJobs`）、**「同一格不许重复建」**
 * （`titleKey` / `decideAction`）、**「正文只含事实」**（`composeBody`）。日志取数 / 渲染整段复用
 * `ci-ga-failure-logs.mjs`（它又复用 `ci-ga-logs-relay` / `ci-github-verdict-logs`），这里只接一次。
 *
 * ## 去重键是标题里的格名，不是 run 号 / sha
 *
 * 与 CNB 每日失败立案同口径：键只认 `红在「<格名>」`（`titleKey`）。run 号 / sha 进标题
 * 是为了自证「是哪一跑」，**不进键** —— 进键就等于「同一格每天都是新的一张」，那正是去重
 * 这道坎要挡的形状。同一格再次红 ⇒ 在旧单下追加一条读数，不新建（号一关，欠着的东西连
 * 可见性都没了）。人工写的单只要标题带同一串键，就自动进这一族、被同一套去重接住。
 *
 * ## 失败即零写入；取不到 ≠ 没有红
 *
 * jobs 读不到 / 读得到却没有 failure 格 / 开着的单列表取不到 —— 一律退 2「没结论」，一次都不写。
 * 「查不到已有单」不等于「没有已有单」，据它新建就是每天多一张重复单。
 * **日志取不到不进这一格**：它只让正文多一节「取不到 + 出口」，不阻断建单 —— 立案的价值是
 * 「红了看得见」，不能因为日志那一跳不通就退回没人问（与 `ci-ga-logs-relay` 同一条边界）。
 *
 * ## 机器建单只报事实，不代写因果
 *
 * 正文 = 症状 + 当场读数（run URL / sha）+ **失败日志摘录** + 「根因：未判定」+ 既有定性出口。
 * 日志摘录由 `ci-ga-failure-logs.mjs` 给：红色失败窗口（注解 + 失败 step 原始行）优先，
 * 完整日志装得下就整份贴、装不下就给窗口 + 下载端点；取不到日志如实写「取不到」并给出口，
 * 绝不写成「日志里没有失败行」。署名走
 * `machineHandle("ci-ga-daily")`（`ci-ga-daily` 打头，**不取**平台账号昵称 —— 那是人的名字）。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci-ga-daily-failure-issue.mjs                 # 读自身 run，该写就写
 * node scripts/ci-ga-daily-failure-issue.mjs --dry-run       # 只打印计划与正文，一条都不写
 * node scripts/ci-ga-daily-failure-issue.mjs --no-block      # 平台那一跳：失败也不拦路（话术照打）
 * ```
 *
 * 环境变量：
 *   · `GITHUB_TOKEN` / `GH_TOKEN` —— 读自身 run 的 jobs（内置 token 即可）
 *   · `CNB_ISSUE_TOKEN` / `CNB_TOKEN` —— 写 CNB issue（需 `repo-issue:rw` + `repo-notes:rw`）
 *   · `GITHUB_REPOSITORY`（缺省 `wuxianyuedu/comfy-app`）· `GITHUB_RUN_ID` · `GITHUB_SHA`
 *   · `CNB_REPO_SLUG`（缺省 `moon-read/comfy-app-t3`）· `CNB_API_ENDPOINT`（缺省 `https://api.cnb.cool`）
 */
import process from "node:process";

import {
  appendComment,
  createIssue,
  ensureLabel,
  ghGet,
  listOpenIssues,
} from "./ci-code-scanning-triage-platform.mjs";
import { collectFailureLogReading, renderLogReadout } from "./ci-ga-failure-logs.mjs";
import { machineHandle } from "./dev-handle.mjs";
import { commentHeader } from "./ship-ticket.mjs";

/** @typedef {import("./ci-code-scanning-triage-model.mjs").IssueRow} IssueRow */
/** @typedef {import("./ci-code-scanning-triage-model.mjs").FetchLike} FetchLike */

/** 三态退码与仓内其余档同口径（`0` 有结论 / `1` 该写的没写成 / `2` 没拿到读数）。 */
export const CODE = { DONE: 0, NO_FACT: 2, WRITE_FAILED: 1 };

/** 标题前缀 —— 它**不进键**，只有 `titleKey()` 那一段进键。 */
export const TITLE_PREFIX = "ci(ga-daily): ";

/** 优先级写死并说明：每日档红挡住的是全链唯一的行为面执行者（同 CNB 每日失败立案）。 */
export const AUTO_PRIORITY = "P1";

const DEFAULT_GH_REPO = "wuxianyuedu/comfy-app";
const DEFAULT_CNB_SLUG = "moon-read/comfy-app-t3";
const DEFAULT_CNB_BASE = "https://api.cnb.cool";

/**
 * 去重键：标题里必须带它（人工写的单只要带它，就自动进这一族）。
 *
 * @param {string} stepName 红的那一格的格名
 * @returns {string} `红在「<格名>」`
 */
export function titleKey(stepName) {
  return `红在「${stepName}」`;
}

/**
 * 标题：**哪一跑**（run 号 + sha）+ **红在哪一步**（格名）。run 号 / sha 只进标题、不进键。
 *
 * @param {{runId: string, sha: string, step: string}} input
 * @returns {string} 标题
 */
export function issueTitle({ runId, sha, step }) {
  const short = sha.slice(0, 8);
  return `${TITLE_PREFIX}run ${runId || "(无)"} · sha ${short || "(无)"} · ${titleKey(step)}`;
}

/**
 * 从 jobs API 的读数里取「红的那几格」。**纯函数**（用例直接钉它）。
 *
 * 只认 `conclusion === "failure"` 的 step：被带下去没跑的格是 `skipped`（不是红），
 * `if: failure()` / `if: always()` 的读数格自己通常 success，而立案 job 自己那三步在读取
 * 这一刻是 success / 还没有 conclusion ⇒ 都不会落进来。格名空的跳过；同名去重、保留出现顺序。
 *
 * ⚠️ 本函数**不按 job 状态过滤**：它只转述应答里已有的 conclusion。「读得到红格」这件事
 * 成立的前提是调用点落在**下游 job**（上游 `daily` 已 `completed`）—— 前提由 workflow 拓扑
 * 承担，不由这里补一层判断（#3563：跑在 `daily` 内部时同一份代码读回 0 个红格）。
 *
 * @param {any} json `GET /repos/{repo}/actions/runs/{id}/jobs` 的应答
 * @returns {string[]} 红的格名（取不到形状时给空数组，由调用方按「没结论」处置）
 */
export function failedStepsFromJobs(json) {
  const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
  /** @type {string[]} */
  const names = [];
  for (const job of jobs) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    for (const step of steps) {
      const name = String(step?.name ?? "").trim();
      if (step?.conclusion === "failure" && name !== "" && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * 这一次要做什么。**纯函数**（不碰网络）。
 *
 * @param {{existing: IssueRow[] | null, failedSteps: string[]}} input
 * @returns {{action: "no-fact" | "write", reason?: string, stages: Array<{number?: number, step: string}>}}
 */
export function decideAction({ existing, failedSteps }) {
  if (failedSteps.length === 0) {
    return {
      action: "no-fact",
      reason:
        "读得到 jobs 却没有 conclusion=failure 的格 ⇒ 不知道往哪张单上记（认不出红格 = 没结论，不是「没有红」）",
      stages: [],
    };
  }
  if (!existing) {
    return {
      action: "no-fact",
      reason:
        "开着的单列表取不到 —— 「查不到已有单」不等于「没有已有单」，据它新建就是每天多一张重复单",
      stages: [],
    };
  }
  return {
    action: "write",
    stages: failedSteps.map((step) => {
      const hit = existing.find((e) => e.title.includes(titleKey(step)));
      return hit ? { number: hit.number, step } : { step };
    }),
  };
}

/**
 * 拼正文：只有事实与出口。
 *
 * @param {{ghRepo: string, handle: string, logReadout?: string, runId: string, sha: string, step: string}} input
 * @returns {string}
 */
export function composeBody({ ghRepo, handle, logReadout = "", runId, sha, step }) {
  const runUrl = `https://github.com/${ghRepo}/actions/runs/${runId}`;
  return [
    commentHeader(handle),
    "",
    "## 症状（由 GA 每日档跑红自动立案，正文只含读数）",
    "",
    `- 镜像仓：\`${ghRepo}\` · workflow \`Daily (mirror)\``,
    `- 构建：run ${runId || "(无)"} · sha \`${sha || "(无)"}\``,
    `- 红在：**「${step}」**`,
    "",
    "## 当场读数（出处）",
    "",
    ...(logReadout ? [logReadout, ""] : []),
    `- 完整日志与失败行的出处：${runUrl}`,
    "",
    "## 根因：**未判定**",
    "",
    "这一格只把「GA 每日档红了」变成一张单，不替任何人判「是谁的错、为什么红」。定性走既有出口：",
    "",
    `- \`gh run view ${runId || "<runId>"} --repo ${ghRepo} --log-failed\` —— 取失败格的日志正文`,
    "- `node scripts/base-check.mjs <那条门禁>` —— 分清「红是我的还是主干的」（§13.6.2）",
    "- 拿不到的测量按**没有结论**处理：`2` 不算绿，也不算红",
    "",
    "> 本单由 `scripts/ci-ga-daily-failure-issue.mjs` 建（GA 侧 `if: failure()`）。",
    "> 同一格再次红时**不新建**，在这张单下追加一条读数 —— 号一关，欠着的东西连可见性都没了。",
  ].join("\n");
}

/**
 * 逐格写单（**递归**：`await` 不进循环体，同 `ci-code-scanning-triage.mjs` 的 `runActions()`）。
 *
 * 为什么必须串行：同一格「有没有旧单」的判定与建单之间不能插进第二笔写
 * （并发会让两张单同时落地）；平台限流也经不起并排打。这也是本仓不让新增
 * `no-await-in-loop` 禁用的那一条规矩。
 *
 * @param {{
 *   authorLabel: string,
 *   cnbCtx: {base: string, fetchImpl: FetchLike, slug: string, token: string},
 *   ghRepo: string,
 *   log: (s: string) => void,
 *   logReadout: string,
 *   runId: string,
 *   sha: string,
 * }} writeCtx 连接 + 这一跳的共用读数
 * @param {Array<{number?: number, step: string}>} stages 计划
 * @param {number} index 当前下标
 * @param {{failures: string[], wrote: number}} ledger 计数账（写回调用方）
 * @returns {Promise<void>}
 */
async function writeStages(writeCtx, stages, index, ledger) {
  const stage = /** @type {{number?: number, step: string} | undefined} */ (stages[index]);
  /* 越界即停：到这一步没有要写的了（递归的出口，不是防御） */
  if (!stage) {
    return;
  }
  const { authorLabel, cnbCtx, ghRepo, log, logReadout, runId, sha } = writeCtx;
  const body = composeBody({
    ghRepo,
    handle: `ci-ga-daily`,
    logReadout,
    runId,
    sha,
    step: stage.step,
  });
  if (stage.number) {
    const said = await appendComment(cnbCtx, stage.number, body, runId);
    if (said.ok) {
      ledger.wrote += 1;
      log(`[ga-daily-failure] ✓ 追加到 #${stage.number}：${titleKey(stage.step)}`);
    } else {
      ledger.failures.push(`${titleKey(stage.step)}：#${stage.number} ${said.detail}`);
    }
  } else {
    const made = await createIssue(
      cnbCtx,
      { body, priority: AUTO_PRIORITY, title: issueTitle({ runId, sha, step: stage.step }) },
      log,
      { labels: [authorLabel], logPrefix: "[ga-daily-failure]" },
    );
    if (made.ok) {
      ledger.wrote += 1;
      log(`[ga-daily-failure] ✓ 新建 #${made.number}：${titleKey(stage.step)}`);
    } else {
      ledger.failures.push(`${titleKey(stage.step)}：${made.detail}`);
    }
  }
  return writeStages(writeCtx, stages, index + 1, ledger);
}

/**
 * `FetchLike` → `typeof fetch`：把「只有 `ok`/`status`/`text()`」的应答原样包成
 * `Response`，让日志那一跳的 `requestJson` / `requestText` 能按同一形状读。
 *
 * 只在**用例注入了 `ghFetch`** 时才用：真跑时直接走 `globalThis.fetch`，
 * 不把几十 MB 的日志正文先读成字符串再包一遍。
 *
 * @param {FetchLike} f 注入件
 * @returns {typeof fetch} 适配后的 fetch
 */
function adaptFetchLike(f) {
  return async (input) => {
    const r = await f(String(input));
    return new Response(await r.text(), { status: r.status });
  };
}

/**
 * 入口。
 *
 * @param {{
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   ghFetch?: FetchLike,
 *   cnbFetch?: FetchLike,
 *   log?: (s: string) => void,
 *   logFetch?: typeof fetch,
 *   logReading?: Awaited<ReturnType<typeof collectFailureLogReading>> | null,
 * }} [io]
 * @returns {Promise<number>} `CODE` 之一（带 `--no-block` 时非零都落 0，话术照打）
 */
export async function main(io = {}) {
  const argv = io.argv ?? process.argv.slice(2);
  const env = io.env ?? process.env;
  const log =
    io.log ??
    ((s) => {
      console.log(s);
    });
  const dryRun = argv.includes("--dry-run");
  const noBlock = argv.includes("--no-block");
  const ghFetch = io.ghFetch ?? fetch;
  const cnbFetch = io.cnbFetch ?? fetch;
  /* 日志那一跳要 `typeof fetch`（`requestJson` / `requestText` 的读数面带 `json()`），
   * 而本档既有的注入件是 `FetchLike`（只有 `text()`）。给一枚适配：把那一族假件
   * 的应答原样包成 `Response`。平台那一跳没有注入件 ⇒ 直接用真 fetch，不付适配的代价。 */
  const logFetch = io.logFetch ?? (io.ghFetch ? adaptFetchLike(io.ghFetch) : fetch);

  const ghRepo = String(env.GITHUB_REPOSITORY ?? "").trim() || DEFAULT_GH_REPO;
  const cnbSlug = String(env.CNB_REPO_SLUG ?? "").trim() || DEFAULT_CNB_SLUG;
  const cnbBase = String(env.CNB_API_ENDPOINT ?? "").trim() || DEFAULT_CNB_BASE;
  const ghToken = String(env.GITHUB_TOKEN ?? env.GH_TOKEN ?? "").trim();
  const cnbToken = String(env.CNB_ISSUE_TOKEN ?? env.CNB_TOKEN ?? "").trim();
  const runId = String(env.GITHUB_RUN_ID ?? "").trim();
  const sha = String(env.GITHUB_SHA ?? "").trim();
  const handle = machineHandle("ci-ga-daily", env);

  /** @type {(code: number, why: string) => number} 退码出口：`--no-block` 只改码，不改话术。 */
  const finish = (code, why) => {
    log(`[ga-daily-failure] ${why}`);
    if (code !== CODE.DONE && noBlock) {
      log(
        `[ga-daily-failure] ※ 这一格本该以退码 ${code} 结束，但平台那一跳带 ` +
          "`--no-block`：**不拦路**。上面那句就是它的全部出口 —— 「看不见」才是这一格唯一的失效形态。" +
          `手工出口：gh run view ${runId || "<runId>"} --repo ${ghRepo} --log-failed，` +
          "再 pnpm ship --new-issue 立案。",
      );
      return CODE.DONE;
    }
    return code;
  };

  if (!ghToken || !runId) {
    return finish(
      CODE.NO_FACT,
      `读不到自身这一跑：${ghToken ? "缺 GITHUB_RUN_ID" : "缺 GITHUB_TOKEN / GH_TOKEN"} ⇒ 一次都不写。`,
    );
  }
  if (!cnbToken) {
    return finish(
      CODE.NO_FACT,
      "写不到 CNB：缺 CNB_ISSUE_TOKEN / CNB_TOKEN（需 repo-issue:rw + repo-notes:rw）⇒ 一次都不写。",
    );
  }

  const ghCtx = {
    apiBase: "https://api.github.com",
    fetchImpl: ghFetch,
    repo: ghRepo,
    token: ghToken,
  };
  const cnbCtx = { base: cnbBase, fetchImpl: cnbFetch, slug: cnbSlug, token: cnbToken };

  const jobs = await ghGet(ghCtx, `/repos/${ghRepo}/actions/runs/${runId}/jobs`);
  if (!jobs.ok) {
    return finish(CODE.NO_FACT, `jobs 读数取不到（${jobs.kind}）⇒ 没结论：${jobs.detail}`);
  }
  const failedSteps = failedStepsFromJobs(jobs.json);
  const redDetail = failedSteps.length ? `（${failedSteps.join("、")}）` : "";
  log(
    `[ga-daily-failure] run ${runId} · sha ${sha.slice(0, 8)} · 红格 ${failedSteps.length} 个${redDetail}`,
  );

  const issues = await listOpenIssues(cnbCtx);
  const existing = issues.ok ? issues.issues : null;
  if (!issues.ok) {
    log(`[ga-daily-failure] 已有单查不到（${issues.kind}）：${issues.detail}`);
  }
  const decision = decideAction({ existing, failedSteps });
  if (decision.action === "no-fact") {
    return finish(CODE.NO_FACT, `${decision.reason ?? "(没给出原因)"} ⇒ 不写。`);
  }

  /* 日志摘录：**能取到就贴，取不到只多一节读数**。它不参与「写不写单」的判定 ——
   * 立案的前提是「jobs 里有 failure 格」，不是「日志端点通」。这一跳失败时正文会如实写
   * 「取不到」并给可粘贴命令，绝不退化成「日志里没有失败行」。 */
  let reading = io.logReading ?? null;
  if (reading === null) {
    reading = await collectFailureLogReading({
      fetchImpl: logFetch,
      ghRepo,
      ghToken,
      /* 立案已经问过一次 jobs（step conclusion 认红格）：把那份原值递过去，
       * 日志这一跳只逐 job 拉 logs，不再问第二遍清单。 */
      jobsJson: jobs.json,
      log,
      runId,
    }).catch((error) => {
      log(`[ga-daily-failure] 日志读数异常（不拦立案）：${String(error)}`);
      return null;
    });
  }
  const logReadout = reading
    ? renderLogReadout(reading)
    : renderLogReadout({
        ghRepo,
        jobs: [],
        ok: false,
        reason: "日志取数这一跳异常退出",
        runId,
        text: "",
      });
  if (reading?.ok === true) {
    log(`[ga-daily-failure] 日志正文已取到 ⇒ 红色失败窗口（完整日志按预算贴）进单子正文。`);
  } else {
    log(`[ga-daily-failure] 日志正文没取到 ⇒ 正文只多一节「取不到 + 出口」，立案照写。`);
  }

  if (dryRun) {
    for (const stage of decision.stages) {
      const plan = stage.number ? `追加到 #${stage.number}` : "新建";
      log(`[ga-daily-failure] DRY-RUN：${plan} · ${issueTitle({ runId, sha, step: stage.step })}`);
    }
    log(
      `[ga-daily-failure] DRY-RUN 正文的日志段（${String(Buffer.byteLength(logReadout, "utf8"))} 字节）：`,
    );
    log(logReadout);
    return finish(CODE.DONE, `--dry-run：计划 ${decision.stages.length} 个动作，一条都没写。`);
  }

  const authorLabel = `提单人:${handle}`;
  const labelReady = await ensureLabel(cnbCtx, authorLabel, "机器自动立案（GA 每日档跑红）");
  if (!labelReady.ok) {
    return finish(
      CODE.WRITE_FAILED,
      `标签 \`${authorLabel}\` 没就绪 ⇒ 不建单（单子没有可筛的标签等于没写）：${labelReady.detail}`,
    );
  }

  const ledger = { failures: /** @type {string[]} */ ([]), wrote: 0 };
  await writeStages(
    { authorLabel, cnbCtx, ghRepo, log, logReadout, runId, sha },
    decision.stages,
    0,
    ledger,
  );
  const { failures, wrote } = ledger;
  if (failures.length > 0) {
    return finish(
      CODE.WRITE_FAILED,
      `有 ${failures.length} 处没写成（写成 ${wrote} 处）⇒ 红：${failures.join("；")}`,
    );
  }
  return finish(CODE.DONE, `立案完成（写成 ${wrote} 处，读全量 → 去重 → 写 → 回读全过）。`);
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1]?.endsWith("ci-ga-daily-failure-issue.mjs")) {
  const exit = await main();
  if (exit !== CODE.DONE) {
    process.stderr.write(
      `[ga-daily-failure] 退出码 ${exit}（0 有结论 / 1 该写的没写成 / 2 没拿到读数）\n`,
    );
  }
  process.exit(exit);
}
