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
 * - **推了等价内容** ⇒ 托管机已推送并派发，本格落一份派发回执（`mirror-dispatch.json`，
 *   带托管机实际推送的那笔 sha —— 主列末尾的「GitHub 判决回读」认领 GitHub run 用的
 *   就是它）后**跳过推送** —— 「成功了就不在自托管跑」；
 * - **预算到点仍没等到** ⇒ 落回原有重试推送（兜底语义一个字不改，PR 可靠性不回退）。
 *
 * ## 为什么认「树」不认 sha（PR #3365 的实测现场）
 *
 * 平台给**每条流水线各自**合成 merge 提交：同两父、同树，**sha 不同** —— 实测同一条
 * PR 事件上托管机推 `550f9e58`、主格 HEAD 是 `c415c6ef`，GitHub 上两个 run 并排。
 * 所以 ref 上的 sha 永远对不上本格 HEAD，按 sha 等值匹配的等待是白等。判据改成
 * **内容等价**：ref 上出现 sha（与本格 HEAD 不同）就浅取那一笔，比 `^{tree}` 与本格
 * HEAD 的树 —— 树一致就是托管机交付了等价内容（GitHub 侧判的是同一棵树）。
 *
 * ## 边界
 *
 * 1. **本模块不判红**：两种出路（跳过 / 兜底）都是合法出路，退出码由后面的推送流程决定
 *    —— 这一层要是会红，「实验失败」就会拦合并，那不是它的职责。
 * 2. **前提取不到不在这一层交账**：令牌 / IID / HEAD 取不到时落回 `runMirror()`，由它按
 *    既定话术打「没跑起来」的三态与回执 —— 这里抢着报会把同一件事说两遍、还少一套读数。
 * 3. **ref 在但树不同**（同 PR 上一跑留下的旧值 / 别笔）不算命中：记进已验集合不重复
 *    浅取；到点后兜底推送用 `--force` 覆盖它（ref 按 IID 专属，覆盖自己的旧值正是幂等语义）。
 * 4. **双派发竞态窗是已知代价**：兜底推送进行中托管机恰好落地 ⇒ GitHub 收到两条同树的
 *    `repository_dispatch` ⇒ 两条 run。判决链按 sha 认领（见上，回执带托管机那笔），
 *    树同判同；窗口只有「最后一次回读」与「兜底推送完成」之间的那几秒。
 *
 * @module scripts/ci-mirror-hosted-await — 等托管机实验格的 refs 回读与跳过判定
 */

import { mkdirSync as realMkdirSync, writeFileSync as realWriteFileSync } from "node:fs";
import path from "node:path";

import { writeDispatchState } from "./ci-mirror-failure-report.mjs";
import {
  HOSTED_AWAIT_BUDGET_MS,
  HOSTED_AWAIT_POLL_INTERVAL_MS,
  HOSTED_VERIFY_TIMEOUT_MS,
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
 * 在托管机实验格的预算内等它的推送结果；见到等价内容（同树）就让调用方跳过推送。
 *
 * @param {{env: Record<string, string | undefined>, log: (line: string) => void}} io
 *   `env` 是进程环境（令牌 / IID 从这里来），`log` 与主流程同一通道（读数才会在同一份日志里）。
 * @param {{mkdirSync?: (dir: string, opts?: object) => void, now?: () => number, root?: string,
 *           runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>,
 *           writeFileSync?: (file: string, data: string) => void}} [extras]
 *   注入面（测试用假件；生产走缺省真身）。`root` 是派发回执的落点根（`runMirror` 同款）。
 * @returns {Promise<{skipped: boolean, why: string, sha?: string}>}
 *   `skipped: true` = 托管机已推送等价内容并派发，调用方应跳过推送（回执已由本模块落盘，
 *   `sha` = 托管机实际推送的那笔，一并带回）；`skipped: false` = 落回原有推送（`why`
 *   交代为什么没等到）。
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
      )}s 一读；见到等价内容（同树）就跳过推送 —— ISSUE #3346）`,
  );
  /* 本格 HEAD 的树：内容等价的锚。两条流水线各自合成 merge 提交（同两父 ⇒ 同树、
   * sha 不同），ref 上的 sha 对不上本格 HEAD 是**常态**而不是抖动。 */
  const localTreeRead = runGit(["rev-parse", "HEAD^{tree}"]);
  const localTree = localTreeRead.code === 0 ? localTreeRead.stdout.trim() : "";
  /** 已验过「树不等」的 ref sha：同一笔不重复浅取。 */
  const verifiedNotOurs = new Set();
  const start = now();
  let reads = 0;
  /** @type {string} */
  let lastNote;
  /** 跳过时落回执 + 返回。 */
  const skipWith = (/** @type {string} */ sha, /** @type {string} */ why) => {
    log(
      `[mirror] ✓ 等托管机：第 ${String(reads)} 读见等价内容（${why}，${
        ctx.repo
      }:${refFull} @ ${sha.slice(0, 8)}` +
        "）⇒ 托管机已推送并派发，本格跳过推送（回执照落带 sha，判决回读按那笔认领）",
    );
    writeDispatchState(
      writeFileSync,
      root,
      {
        dispatched: true,
        reason: `已由托管机实验格推送并派发（${ctx.repo}:${refFull} @ ${sha.slice(0, 8)}，树与本跑一致；--await-hosted 回读见 sha）`,
        sha,
      },
      mkdirSync,
    );
    return { skipped: true, why, sha };
  };
  /** 跳过时落回执（带托管机实际推送的那笔 sha）+ 返回。 */
  for (;;) {
    reads += 1;
    const read = runGit(["ls-remote", url, refFull], { timeout: REMOTE_READ_TIMEOUT_MS });
    if (read.code === 0) {
      const text = sanitize(`${read.stdout}\n${read.stderr}`, ctx.token);
      const refLine = text.split("\n").find((line) => line.endsWith(`\t${refFull}`));
      const refSha =
        /** @type {RegExpExecArray | null} */ (/^(?<refSha>[0-9a-f]{40})\t/.exec(refLine ?? ""))
          ?.groups?.refSha ?? "";
      if (refSha === undefined || refSha === "") {
        lastNote = "ref 还没出现（本跑还没被托管机推过）";
      } else if (refSha === ctx.headSha) {
        /* 直接同 sha（少见：平台哪天统一了合成提交）——不必比树。 */
        return skipWith(refSha, `第 ${String(reads)} 读同 sha`);
      } else if (localTree === "") {
        lastNote = `ref 在 ${refSha.slice(0, 8)}，本格 HEAD 的树取不到 ⇒ 只能等同 sha（降级）`;
      } else if (verifiedNotOurs.has(refSha)) {
        lastNote = `ref 在 ${refSha.slice(0, 8)}（已验过树不等：旧值 / 别笔）`;
      } else {
        const fetched = runGit(["fetch", "--no-tags", "--depth=1", url, refSha], {
          timeout: HOSTED_VERIFY_TIMEOUT_MS,
        });
        const remoteTreeRead =
          fetched.code === 0 ? runGit(["rev-parse", "FETCH_HEAD^{tree}"]) : null;
        const remoteTree = remoteTreeRead?.code === 0 ? remoteTreeRead.stdout.trim() : "";
        if (remoteTree !== "" && remoteTree === localTree) {
          return skipWith(refSha, `第 ${String(reads)} 读树一致`);
        }
        if (remoteTree === "") {
          lastNote = `ref 在 ${refSha.slice(0, 8)}，浅取没通（exit ${String(
            fetched.code,
          )}）⇒ 下轮再验`;
        } else {
          verifiedNotOurs.add(refSha);
          lastNote = `ref 在 ${refSha.slice(0, 8)} 但树与本跑不同（旧值 / 别笔）`;
        }
      }
    } else {
      lastNote = `这一读没通（exit ${String(read.code)}：egress 抖动 / 远端慢，预算内继续等）`;
    }
    const elapsed = now() - start;
    if (elapsed >= HOSTED_AWAIT_BUDGET_MS) {
      log(
        `[mirror] 等托管机：到点（已等 ${String(Math.round(elapsed / 1000))}s，预算 ${String(
          Math.round(HOSTED_AWAIT_BUDGET_MS / 1000),
        )}s，共读 ${String(reads)} 次）仍没见到等价内容 —— ${lastNote}` +
          " ⇒ 落回原有重试推送（兜底）",
      );
      return { skipped: false, why: `到点没见到等价内容（${lastNote}）` };
    }
    log(
      `[mirror] 等托管机：第 ${String(reads)} 读没见等价内容（${lastNote}；已等 ${String(
        Math.round(elapsed / 1000),
      )}s）⇒ ${String(Math.round(HOSTED_AWAIT_POLL_INTERVAL_MS / 1000))}s 后再读`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待（命令行/进程编排），并行没有意义
    await sleep(HOSTED_AWAIT_POLL_INTERVAL_MS);
  }
}
