/**
 * `ci-mirror-hosted-await.mjs` —— 自托管主列「GitHub 镜像同步」的**等托管机**前置
 * （ISSUE #3346，托管机镜像实验的第二半）。
 *
 * ## 它回答的那一格
 *
 * 平台池上另有一条影子流水线（`.cnb.yml` 的「GitHub 镜像同步（托管机实验）」）在同一个
 * PR 事件上跑 `--once --readout`：三跳各只试一次、不重试、退码恒 0。本模块让自托管主列
 * 那一格在推送**之前**先问一句：「托管机那条已经把本跑的内容推上去了吗？」——
 *
 * - **ref 首次出现** ⇒ 托管机已推送并派发，本格落一份派发回执（`mirror-dispatch.json`，
 *   带托管机实际推送的那笔 sha —— 主列末尾的「GitHub 判决回读」认领 GitHub run 用的
 *   就是它）后**跳过推送** —— 「成功了就不在自托管跑」；
 * - **第一读 ref 就已存在** ⇒ 上一跑的旧值（重跑场景：托管机管线会被平台 skip，不会再
 *   推）—— 旧值永远不会自己变成我们的内容，**当场落回兜底**，不等满预算；
 * - **预算到点 ref 仍没出现** ⇒ 落回原有重试推送（兜底语义一个字不改，PR 可靠性不回退）。
 *
 * ## 为什么「ref 首次出现」就可信、不需要再核验内容（两份实测读数）
 *
 * `refs/heads/cnb-pr-<IID>` 只有**两条镜像格**会写：托管机格与本格。本格在等、还没推，
 * 所以等待期间 ref 出现的那一笔**只能是托管机格推的**——它推的是它对本跑事件合成的
 * merge，与本格 HEAD 同两父、同树：
 *
 * - **#3365（全新事件）实测**：托管机 `550f9e58` vs 主格 `c415c6ef`，sha 不同、**树相同**
 *   （都是 `79406fe0`，本机拉两笔回来比过）；
 * - **#3366（重跑 + master 已前进）实测**：托管机推的树与本格**真的不同**（事件快照 vs
 *   当前 master，diff 15 文件）——那一形态在**第一读**就被「ref 已存在」拦下当场兜底，
 *   不会误跳过。
 *
 * 曾做过的浅取比树核验（`git fetch --depth=1` 取 ref 那笔回来比 `^{tree}`）因此整段退役：
 * 它走自托管 → github.com 的出网，是跳过路径里唯一还依赖这条烂出网的一跳（#3366 重跑
 * 现场 8 读全没通、#3374 现场第 6 读仍 exit -1），退役后本模块只剩 `ls-remote` 单 ref 轻读。
 *
 * ## 边界
 *
 * 1. **本模块不判红**：三种出路（跳过 / 当场兜底 / 预算兜底）都是合法出路，退出码由后面
 *    的推送流程决定 —— 这一层要是会红，「实验失败」就会拦合并，那不是它的职责。
 * 2. **前提取不到不在这一层交账**：令牌 / IID / HEAD 取不到时落回 `runMirror()`，由它按
 *    既定话术打「没跑起来」的三态与回执 —— 这里抢着报会把同一件事说两遍、还少一套读数。
 * 3. **第一读没读通 ⇒ 不敢认「fresh」**：ref 存在与否没读到，后面就算见到 ref 也分不出
 *    是托管机推的还是上一跑的旧值 —— 按保守处理落回兜底（egress 全黑的那一天本来就要
 *    兜底）。只有**读到过「ref 不存在」**之后出现的 ref 才可跳过。
 * 4. **同事件两 prepare 之间 master 恰好前进**（窗口 ≈ 1 分钟）会让两棵树差一个 master
 *    提交 —— 残余风险记在这里：跳过路径 GitHub 判的树与主格门禁跑的树差一笔；实证
 *    #3365 未发生。转正后本模块连同等待一起消失，此风险随之清零。
 * 5. **双派发竞态窗是已知代价**：兜底推送进行中托管机恰好落地 ⇒ GitHub 收到两条同树的
 *    `repository_dispatch` ⇒ 两条 run。判决链按回执/认领键的 sha 认领，树同判同。
 *
 * @module scripts/ci-mirror-hosted-await — 等托管机实验格的 refs 回读与跳过判定
 */

import { mkdirSync as realMkdirSync, writeFileSync as realWriteFileSync } from "node:fs";
import path from "node:path";

import { writeDispatchState } from "./ci-mirror-failure-report.mjs";
import {
  HOSTED_AWAIT_BUDGET_MS,
  HOSTED_AWAIT_POLL_INTERVAL_MS,
  REMOTE_READ_TIMEOUT_MS,
} from "./ci-mirror-retry-policy.mjs";
import {
  buildPushUrl,
  realRunGit,
  realSleep,
  resolveContext,
  sanitize,
} from "./ci-github-mirror-push.mjs";

/** 派发回执的落点根：与 `runMirror` 的 `ROOT` 同一出处（scripts/ 的上一级）。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 在托管机实验格的预算内等它的推送结果；ref 首次出现就让调用方跳过推送。
 *
 * @param {{env: Record<string, string | undefined>, log: (line: string) => void}} io
 *   `env` 是进程环境（令牌 / IID 从这里来），`log` 与主流程同一通道（读数才会在同一份日志里）。
 * @param {{mkdirSync?: (dir: string, opts?: object) => void, now?: () => number, root?: string,
 *           runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>,
 *           writeFileSync?: (file: string, data: string) => void}} [extras]
 *   注入面（测试用假件；生产走缺省真身）。`root` 是派发回执的落点根（`runMirror` 同款）。
 * @returns {Promise<{skipped: boolean, why: string, sha?: string}>}
 *   `skipped: true` = 托管机已推送并派发，调用方应跳过推送（回执已由本模块落盘，`sha` =
 *   托管机实际推送的那笔）；`skipped: false` = 落回原有推送（`why` 交代为什么没等到）。
 */
export async function maybeSkipViaHosted(io, extras = {}) {
  const { env, log } = io;
  const {
    mkdirSync = realMkdirSync,
    now = Date.now,
    root = ROOT,
    runGit = realRunGit,
    sleep = realSleep,
    writeFileSync = realWriteFileSync,
  } = extras;
  const ctx = resolveContext({ env, runGit });
  if (!ctx.ok) {
    return {
      skipped: false,
      why: "前提没配齐（令牌 / IID / HEAD）—— 落回 runMirror 按既定话术交账",
    };
  }
  const url = buildPushUrl(
    ctx.repo,
    ctx.token,
    String(env.GITHUB_MIRROR_USER ?? "").trim() || "oauth2",
  );
  const refFull = `refs/heads/${ctx.ref}`;
  log(
    `[mirror] 等托管机实验格：回读 ${ctx.repo}:${refFull}` +
      `（预算 ${String(Math.round(HOSTED_AWAIT_BUDGET_MS / 1000))}s、每 ${String(
        Math.round(HOSTED_AWAIT_POLL_INTERVAL_MS / 1000),
      )}s 一读；ref 首次出现（只能是托管机推的）就跳过推送 —— ISSUE #3346）`,
  );
  const start = now();
  let reads = 0;
  /** @type {string} */
  let lastNote;
  /** 读到过「ref 不存在」才敢认后面出现的 ref 是托管机推的（边界第 3 条）。 */
  let freshRef = false;
  /** 跳过时落回执（带托管机实际推送的那笔 sha）+ 返回。 */
  const skipWith = (/** @type {string} */ sha, /** @type {string} */ why) => {
    log(
      `[mirror] ✓ 等托管机：第 ${String(reads)} 读 ref 出现 @ ${sha.slice(0, 8)}（${
        ctx.repo
      }:${refFull}）` + " ⇒ 托管机已推送并派发，本格跳过推送（回执照落带 sha，判决回读按那笔认领）",
    );
    writeDispatchState(
      writeFileSync,
      root,
      {
        dispatched: true,
        reason: `已由托管机实验格推送并派发（${ctx.repo}:${refFull} @ ${sha.slice(0, 8)}；--await-hosted 回读见 sha）`,
        sha,
      },
      mkdirSync,
    );
    return { skipped: true, why, sha };
  };
  for (;;) {
    reads += 1;
    const read = runGit(["ls-remote", url, refFull], { timeout: REMOTE_READ_TIMEOUT_MS });
    if (read.code === 0) {
      const text = sanitize(`${read.stdout}\n${read.stderr}`, ctx.token);
      const refLine = text.split("\n").find((line) => line.endsWith(`\t${refFull}`));
      const refSha =
        /** @type {RegExpExecArray | null} */ (/^(?<refSha>[0-9a-f]{40})\t/.exec(refLine ?? ""))
          ?.groups?.refSha ?? "";
      if (refSha !== "") {
        if (freshRef) {
          return skipWith(refSha, `第 ${String(reads)} 读 ref 首次出现（托管机推送）`);
        }
        /* 第一读 ref 就在 = 上一跑的旧值（重跑场景：托管机管线被平台 skip，不会再推）。
         * 旧值永远不会自己变成我们的内容 —— 不等满预算，当场落回兜底（重跑现场实测 300s 白等）。 */
        log(
          `[mirror] 等托管机：第 ${String(reads)} 读 ref 已存在 @ ${refSha.slice(0, 8)}` +
            "（上一跑的旧值：重跑场景托管机格被平台 skip，不会再推）⇒ 不等满预算，落回原有重试推送（兜底）",
        );
        return {
          skipped: false,
          why: `ref 已存在（上一跑的旧值 @ ${refSha.slice(0, 8)}）—— 本跑的托管机格被平台 skip 或未重推，当场兜底`,
        };
      }
      /* 读到「ref 不存在」：从这一刻起，后面出现的 ref 只能是托管机推的（边界第 3 条）。 */
      freshRef = true;
      lastNote = "ref 还没出现（本跑还没被托管机推过）";
    } else {
      lastNote = `这一读没通（exit ${String(read.code)}：egress 抖动 / 远端慢，预算内继续等）`;
    }
    const elapsed = now() - start;
    if (elapsed >= HOSTED_AWAIT_BUDGET_MS) {
      log(
        `[mirror] 等托管机：到点（已等 ${String(Math.round(elapsed / 1000))}s，预算 ${String(
          Math.round(HOSTED_AWAIT_BUDGET_MS / 1000),
        )}s，共读 ${String(reads)} 次）ref 仍没出现 —— ${lastNote}` + " ⇒ 落回原有重试推送（兜底）",
      );
      return { skipped: false, why: `到点 ref 没出现（${lastNote}）` };
    }
    log(
      `[mirror] 等托管机：第 ${String(reads)} 读 ref 没出现（${lastNote}；已等 ${String(
        Math.round(elapsed / 1000),
      )}s）⇒ ${String(Math.round(HOSTED_AWAIT_POLL_INTERVAL_MS / 1000))}s 后再读`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待（命令行/进程编排），并行没有意义
    await sleep(HOSTED_AWAIT_POLL_INTERVAL_MS);
  }
}
