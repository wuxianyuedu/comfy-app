#!/usr/bin/env node
/**
 * `ci-dependabot-triage.mjs` —— 把 GitHub Dependabot alerts 按**依赖**聚合成
 * CNB issue（每日 03:00 一次 + 手动一次）。#4168：Dependabot alerts 与 code
 * scanning 一样自动提单。
 *
 * ## 它补的那一格
 *
 * GitHub 侧的 Dependabot 每天在盯依赖，告警躺在 `security/dependabot` 里 ——
 * 那是**另一套账号**的页面，本仓的日常入口（CNB issue）看不到它。「有告警」与
 * 「有人去修」之间没有交接。这一格与 `ci-code-scanning-triage.mjs`（code
 * scanning 那族）同一套口径、Dependabot 自己的形状。
 *
 * ## 六个口径（与 code scanning 那族逐条同源）
 *
 * 1. **一包一单**：按 `ecosystem/name` 聚合。同一包的多条 advisory 是同一个
 *    修法（升到首个修复版）；逐 advisory 建单等于让同一个修法在 N 张单里各说一遍。
 * 2. **去重键是标题里的 `dependabot: <ecosystem>/<name>`**，不是 alert number、
 *    也不是 GHSA id。告警修好再复发会换新的 number；GHSA 是 advisory 的身份，
 *    而同一个包先后出多条 advisory 该进同一张单（一次升版全收）。
 * 3. **告警消失不自动关单**。刷新正文（标注该包已无 open 告警）+ 追加评论 +
 *    打 `dependabot:cleared` 标签，关单留给人。
 * 4. **失败即零写入**。告警列表取不到、只拿到部分页、已有单列表取不到 ——
 *    一律不建、不刷、不评论，只在日志与 job summary 里说明。
 * 5. **401 / 403 / 限流 / 5xx 重试两次仍失败 ⇒ 红**，且话术点名缺哪一项权限
 *    （GitHub 侧 `security-events: read` 同时覆盖两族；CNB 侧 `repo-issue:rw` /
 *    `repo-notes:rw`）。
 * 6. **建单后必须补标签 + 独立回读**（`create-issue --labels` 实测不落地）。
 *
 * ## 为什么走 HTTP 而不是 `cnb` CLI
 *
 * 这一格跑在 GitHub 托管 runner 上，宿主 PATH 上没有 `cnb`。CNB 侧调用复用
 * `ci-code-scanning-triage-platform.mjs` 的既有出口（同一套 token 形状：
 * GitHub secret `CNB_ISSUE_TOKEN` 注入成同名 env，回落 `CNB_TOKEN`）。
 *
 * ## 用法
 *
 * ```text
 * node scripts/ci/ci-dependabot-triage.mjs              # 上网问两边，该写就写
 * node scripts/ci/ci-dependabot-triage.mjs --dry-run    # 只打印计划与正文，一条都不写
 * ```
 *
 * 环境变量：
 *   · `GH_TOKEN` / `GITHUB_TOKEN` —— 读 GitHub Dependabot alerts（需 `security-events: read`）
 *   · `CNB_ISSUE_TOKEN` / `CNB_TOKEN` —— 写 CNB issue（需 `repo-issue:rw` + `repo-notes:rw`）
 *   · `GITHUB_REPOSITORY`（缺省 `wuxianyuedu/comfy-app`）
 *   · `CNB_REPO_SLUG`（缺省 `moon-read/comfy-app-t3`）
 *   · `CNB_API_ENDPOINT`（缺省 `https://api.cnb.cool`）
 *   · `GITHUB_STEP_SUMMARY`（有就写一份读数，没有就只打日志）
 */
import fs from "node:fs";
import process from "node:process";

import {
  AUTHOR_HANDLE,
  CLEARED_LABEL,
  FAMILY_LABEL,
  aggregateByPackage,
  beijingTime,
  composeClearedBody,
  managedIssues,
  planActions,
  renderUpdateComment,
} from "./ci-dependabot-triage-model.mjs";
import { fetchDependabotAlerts } from "./ci-dependabot-triage-platform.mjs";
import {
  RETRIES,
  appendComment,
  cnbCall,
  createIssue,
  ensureLabel,
  listOpenIssues,
  updateBody,
} from "./ci-code-scanning-triage-platform.mjs";

/** @typedef {import("./ci-dependabot-triage-model.mjs").FetchLike} FetchLike */
/** @typedef {import("./ci-dependabot-triage-model.mjs").Action} Action */

/** 三态退码与仓内其余档同口径（`0` 有结论 / `1` 该写的没写成 / `2` 没拿到读数）。 */
export const CODE = { DONE: 0, WRITE_FAILED: 1, NO_FACT: 2 };

const DEFAULT_GH_REPO = "wuxianyuedu/comfy-app";
const DEFAULT_CNB_SLUG = "moon-read/comfy-app-t3";
const DEFAULT_CNB_BASE = "https://api.cnb.cool";

/** 本族两枚标签的说明（ensureLabel 的缺省描述是 code scanning 那族的，这里显式给）。 */
const LABEL_DESCRIPTIONS = /** @type {Record<string, string>} */ ({
  [FAMILY_LABEL]: "GitHub Dependabot 告警",
  [CLEARED_LABEL]: "该依赖已无 open 告警（留给人确认后关单）",
});

/**
 * 一次动作的计数账（`main` 收尾时念出来）。
 * @typedef {{created: number, updated: number, cleared: number, unchanged: number, failures: string[], details: string[]}} ActionLedger
 */

/**
 * 顺序执行计划里的动作（递归：`await` 不进循环体）。
 *
 * 为什么顺序而不并发：同一依赖的两张单不该同时创建（并发会让「查不到已有单」的
 * 那次判断与另一次建单撞上）；而平台限流也经不起多路并发。
 *
 * @param {{fetchImpl: FetchLike, token: string, base: string, slug: string}} ctx CNB 连接
 * @param {Action[]} actions 计划动作
 * @param {number} index 当前动作下标
 * @param {{at: string, ledger: ActionLedger, log: (s: string) => void}} io
 *   递归共用的三件套：本跑时刻、计数账、日志口。
 * @returns {Promise<void>}
 */
async function runActions(ctx, actions, index, io) {
  const { at, ledger, log } = io;
  const action = actions[index];
  if (!action) {
    return;
  }
  if (action.kind === "create") {
    const made = await createIssue(ctx, action, log, {
      labels: [`提单人:${AUTHOR_HANDLE}`, FAMILY_LABEL],
      logPrefix: "[dependabot]",
    });
    if (made.ok) {
      ledger.created += 1;
      ledger.details.push(`新建 #${made.number}：${action.title}`);
    } else {
      ledger.failures.push(`${action.pkg}：${made.detail}`);
    }
    return runActions(ctx, actions, index + 1, io);
  }
  const number = Number(action.number ?? 0);
  if (action.kind === "update") {
    const wrote = await updateBody(ctx, number, action.body ?? "");
    if (!wrote.ok) {
      ledger.failures.push(`${action.pkg}：${wrote.detail}`);
      return runActions(ctx, actions, index + 1, io);
    }
    if (!wrote.changed) {
      ledger.unchanged += 1;
      return runActions(ctx, actions, index + 1, io);
    }
    const comment = renderUpdateComment({ pkg: action.pkg, count: action.count, at });
    const said = await appendComment(ctx, number, comment.body, comment.marker);
    if (said.ok) {
      ledger.updated += 1;
      ledger.details.push(`刷新 #${number}：${action.title}`);
    } else {
      ledger.failures.push(`${action.pkg}：#${number} 正文已刷新，但${said.detail}`);
    }
    return runActions(ctx, actions, index + 1, io);
  }
  /* clear：读旧正文 → 这一格「已无 open 告警」已经写进去了就跳过 → 否则刷新 + 评论 + 标签 */
  const detail = await cnbCall(ctx, "GET", `issues/${number}`, { retries: RETRIES });
  if (!detail.ok) {
    ledger.failures.push(`${action.pkg}：读 #${number} 的旧正文失败：${detail.detail}`);
    return runActions(ctx, actions, index + 1, io);
  }
  const previous = String(detail.json?.body ?? detail.json?.data?.body ?? "");
  if (previous.includes(action.marker ?? "")) {
    ledger.unchanged += 1;
    return runActions(ctx, actions, index + 1, io);
  }
  const nextBody = composeClearedBody(previous, action.section ?? "");
  const wrote = await updateBody(ctx, number, nextBody);
  if (!wrote.ok) {
    ledger.failures.push(`${action.pkg}：${wrote.detail}`);
    return runActions(ctx, actions, index + 1, io);
  }
  const comment = renderUpdateComment({ pkg: action.pkg, count: 0, at });
  const said = await appendComment(ctx, number, comment.body, comment.marker);
  if (!said.ok) {
    ledger.failures.push(`${action.pkg}：#${number} 正文已刷新，但${said.detail}`);
    return runActions(ctx, actions, index + 1, io);
  }
  const tagged = await cnbCall(ctx, "POST", `issues/${number}/labels`, {
    body: { labels: [CLEARED_LABEL] },
  });
  if (!tagged.ok) {
    ledger.failures.push(
      `${action.pkg}：#${number} 已刷新，但打 \`${CLEARED_LABEL}\` 失败：${tagged.detail}`,
    );
    return runActions(ctx, actions, index + 1, io);
  }
  ledger.cleared += 1;
  ledger.details.push(`标注已清零 #${number}：${action.pkg}（未关单，留给人确认）`);
  return runActions(ctx, actions, index + 1, io);
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
 *   summaryPath?: string | null,
 *   now?: () => Date,
 * }} [io]
 * @returns {Promise<number>} `CODE` 之一
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
  const ghFetch = io.ghFetch ?? fetch;
  const cnbFetch = io.cnbFetch ?? fetch;
  const ghRepo = String(env.GITHUB_REPOSITORY ?? "").trim() || DEFAULT_GH_REPO;
  const cnbSlug = String(env.CNB_REPO_SLUG ?? "").trim() || DEFAULT_CNB_SLUG;
  const cnbBase = String(env.CNB_API_ENDPOINT ?? "").trim() || DEFAULT_CNB_BASE;
  const ghToken = String(env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "").trim();
  const cnbToken = String(env.CNB_ISSUE_TOKEN ?? env.CNB_TOKEN ?? "").trim();
  const now = io.now ? io.now() : new Date();
  const nowIso = now.toISOString();
  const at = `${nowIso.replace("T", " ").slice(0, 16)}Z · ${beijingTime(nowIso)}`;

  /** @type {string[]} */
  const summary = [];
  /**
   * 收尾：日志 + job summary + 退码。
   * @param {number} code 三态码
   * @param {string} headline 一句话结论
   * @param {string[]} [details] 逐条读数
   * @returns {number}
   */
  const finish = (code, headline, details = []) => {
    log(`[dependabot] ${headline}`);
    for (const line of details) {
      log(`[dependabot]   ${line}`);
    }
    summary.push(
      "## Dependabot 巡检",
      "",
      `- 结论：${headline}`,
      ...details.map((d) => `- ${d}`),
      "",
    );
    const path = io.summaryPath === undefined ? env.GITHUB_STEP_SUMMARY : io.summaryPath;
    if (path) {
      try {
        fs.appendFileSync(path, `${summary.join("\n")}\n`, "utf8");
      } catch {
        log("[dependabot] job summary 没写成（读数仍在日志里）");
      }
    }
    return code;
  };

  if (!ghToken) {
    return finish(CODE.NO_FACT, "读不到 GitHub 告警：没有 GH_TOKEN / GITHUB_TOKEN ⇒ 一次都不写。", [
      "缺的凭据：builtin GITHUB_TOKEN（workflow 需 `permissions: security-events: read`）或细粒度 PAT",
    ]);
  }
  if (!cnbToken) {
    return finish(CODE.NO_FACT, "写不到 CNB：没有 CNB_ISSUE_TOKEN / CNB_TOKEN ⇒ 一次都不写。", [
      "缺的凭据：GitHub secret `CNB_ISSUE_TOKEN`（注入成同名 env），需 `repo-issue:rw` + `repo-notes:rw`",
    ]);
  }

  const ghCtx = {
    fetchImpl: ghFetch,
    token: ghToken,
    repo: ghRepo,
    apiBase: "https://api.github.com",
  };
  const cnbCtx = { fetchImpl: cnbFetch, token: cnbToken, base: cnbBase, slug: cnbSlug };

  const alertsResult = await fetchDependabotAlerts(ghCtx);
  if (!alertsResult.ok) {
    return finish(
      CODE.NO_FACT,
      `告警读数不完整（${alertsResult.kind}）⇒ 一次都不写：查不到 ≠ 没有告警。`,
      [
        alertsResult.detail,
        `已取到 ${alertsResult.partial} 条（只到部分页，不构成「某包已清零」的依据）`,
      ],
    );
  }
  const issuesResult = await listOpenIssues(cnbCtx);
  if (!issuesResult.ok) {
    return finish(
      CODE.NO_FACT,
      `已有单查不到（${issuesResult.kind}）⇒ 一次都不写：查不到已有单 ≠ 没有已有单。`,
      [issuesResult.detail],
    );
  }

  const actions = planActions({
    alerts: alertsResult.alerts,
    existing: issuesResult.issues,
    ghRepo,
    at,
  });
  const groups = aggregateByPackage(alertsResult.alerts);
  const headline =
    `open 告警 ${alertsResult.alerts.length} 条 · ${groups.length} 个依赖 · ` +
    `manifest 覆盖 ${new Set(alertsResult.alerts.map((a) => a.manifestPath)).size} 处`;
  log(`[dependabot] ${headline}`);
  log(
    `[dependabot] 计划：新建 ${actions.filter((a) => a.kind === "create").length} · ` +
      `刷新 ${actions.filter((a) => a.kind === "update").length} · ` +
      `标注已清零 ${actions.filter((a) => a.kind === "clear").length} · ` +
      `已有单 ${issuesResult.issues.length} 张（本族 ${managedIssues(issuesResult.issues).length} 张）`,
  );

  /** @type {string[]} */
  const details = [headline];
  if (dryRun) {
    for (const action of actions) {
      details.push(
        `${action.kind} · ${action.title}` +
          `${action.number ? ` → #${action.number}` : ""} · 正文 ${(action.body ?? action.section ?? "").length} 字`,
      );
    }
    return finish(CODE.DONE, `--dry-run：计划 ${actions.length} 个动作，一条都没写。`, details);
  }

  /* 两个标签分开写、不写成循环：任一失败都要**点名**是哪一枚没就绪。 */
  const familyLabel = await ensureLabel(cnbCtx, FAMILY_LABEL, LABEL_DESCRIPTIONS[FAMILY_LABEL]);
  if (!familyLabel.ok) {
    return finish(
      CODE.WRITE_FAILED,
      `标签 \`${FAMILY_LABEL}\` 没就绪 ⇒ 不建单（单子没有可筛的标签等于没写）。`,
      [familyLabel.detail],
    );
  }
  const clearedLabel = await ensureLabel(cnbCtx, CLEARED_LABEL, LABEL_DESCRIPTIONS[CLEARED_LABEL]);
  if (!clearedLabel.ok) {
    return finish(
      CODE.WRITE_FAILED,
      `标签 \`${CLEARED_LABEL}\` 没就绪 ⇒ 不建单（告警消失时没有可打的标记）。`,
      [clearedLabel.detail],
    );
  }

  const ledger = /** @type {ActionLedger} */ ({
    created: 0,
    updated: 0,
    cleared: 0,
    unchanged: 0,
    failures: [],
    details,
  });
  await runActions(cnbCtx, actions, 0, { at, ledger, log });
  details.push(
    `动作：新建 ${ledger.created} · 刷新 ${ledger.updated} · 标注已清零 ${ledger.cleared} · ` +
      `无变化 ${ledger.unchanged} · 失败 ${ledger.failures.length}`,
  );
  if (ledger.failures.length > 0) {
    return finish(CODE.WRITE_FAILED, `有 ${ledger.failures.length} 处没写成 ⇒ 红。`, [
      ...details,
      ...ledger.failures.map((f) => `失败：${f}`),
    ]);
  }
  return finish(CODE.DONE, "巡检完成（读全量 → 计划 → 写 → 回读全过）。", details);
}

/* 只在被直接执行时跑 main（被 import 时只暴露纯函数给用例）。 */
if (process.argv[1]?.endsWith("ci-dependabot-triage.mjs")) {
  const exit = await main();
  if (exit !== CODE.DONE) {
    process.stderr.write(
      `[dependabot] 退出码 ${exit}（0 有结论 / 1 该写的没写成 / 2 没拿到读数）\n`,
    );
  }
  process.exit(exit);
}

/* 用例与调用点只需要盯这一个入口：模型层 / 平台层的读数在这里再导出一次。 */
export {
  aggregateByPackage,
  alertLink,
  findIssueForPackage,
  issueTitle,
  managedIssues,
  packageOfTitle,
  planActions,
  renderIssueBody,
  titleKey,
} from "./ci-dependabot-triage-model.mjs";
export { fetchDependabotAlerts } from "./ci-dependabot-triage-platform.mjs";
export { classifyCnbFailure, classifyGithubFailure } from "./ci-code-scanning-triage-platform.mjs";
