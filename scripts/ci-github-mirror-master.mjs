/**
 * `ci-github-mirror-master.mjs` —— 镜像格的 **push 档**（`--master`）执行面（ISSUE #2978 / #3064）。
 *
 * ## 为什么单独一份
 *
 * 它原本与 PR 档的 `runMirror()` 同住在 `ci-github-mirror-push.mjs`，而那份文件在
 * #3148 加了「派发形状落盘」之后撞上 §12.6 R5 的 900 行硬闸。切法是**按档切**：
 * `--master` 走的是另一条流水线（`master 合并复核`）、另一套上下文（没有 IID、
 * 不派发），共用面只有「推 refs → 推 LFS → 回读自证」三跳。切出去之后主文件回到闸内，
 * 调用点与导出面**一字未改**（主文件把这一个名字原样转出）。
 *
 * ## 边界
 *
 * 本文件只做编排：判据（推送失败的三类话术 / LFS 七类 / egress 重试 / 推送后回读）与话术
 * 全部来自 `ci-github-mirror-push.mjs` 与 `ci-mirror-failure-report.mjs`，这里不写第二份
 * （§12.12）。因此那些内部件在本文件里是**本地 import**，不是再导出一遍 ——
 * 导出面仍只在主文件那一份上。
 *
 * @module scripts/ci-github-mirror-master — `--master` 档的推送 + 自证编排
 */
import {
  CODE,
  buildPushUrl,
  explainRemoteProbeFailure,
  pushArgs,
  realRunGit,
  realSleep,
  resolveMasterContext,
  runGitWithRetry,
  sanitize,
} from "./ci-github-mirror-push.mjs";
/* 超时 / 次数 / 退避那一组常量单独一份；推送那一跳的墙钟预算见
 * `ci-mirror-wire-budget.mjs`（ISSUE #3252 起从推送第一刀起算，前面不再有探活）。 */
import { PUSH_MAX_ATTEMPTS, VERIFY_MAX_ATTEMPTS } from "./ci-mirror-retry-policy.mjs";
import { createWireBudget } from "./ci-mirror-wire-budget.mjs";
/* LFS 那一跳自 #3146 起单独一份（900 行闸）：它反过来要 import 主文件的判据，故主文件不转出它。 */
import { pushLfsObjects } from "./ci-mirror-lfs-push.mjs";
import { verifyLfsObjects, verifyPushedRef } from "./ci-mirror-push-verify.mjs";
/* 推送前的远端更新闸（ISSUE #3252）：单发读一次远端 ref，只在这一档挂（PR 档不加）。 */
import { guardRemoteNotAhead } from "./ci-mirror-remote-guard.mjs";
import { renderMirrorSummary } from "./ci-mirror-failure-report.mjs";

/**
 * `--master` 模式的执行面：推 `HEAD:refs/heads/master` → 回读远端 ref → 推 LFS →
 * 核对对象，**没有派发那一跳**（这一推服务的是 GitHub 侧的 schedule workflow —— 它们跑
 * 默认分支，推完即就位，没有要叫醒的对象）。推送与回读的话术与 {@link runMirror} 同一族，
 * 前缀换成 `[mirror-master]`（文件头「--master」一节第 3 条）。
 *
 * @param {{env: Record<string, string | undefined>, runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>, now?: () => number, dryRun?: boolean, log?: (line: string) => void, readout?: boolean, fetchImpl?: typeof fetch}} io
 * @returns {Promise<number>} 仓内三态退码
 */
export async function runMasterMirror(io) {
  const { dryRun = false, env } = io;
  const log =
    io.log ??
    ((line) => {
      console.log(line);
    });
  const readout = io.readout ?? false;
  /** 收尾小结（ISSUE #3106）—— master 档没有派发那一跳，`dispatch` 传 `null`。
   *  @param {Omit<Parameters<typeof renderMirrorSummary>[0], "prefix" | "readout">} fields */
  const summarize = (fields) => {
    log(renderMirrorSummary({ prefix: "mirror-master", readout, ...fields }));
  };
  const runGit = io.runGit ?? realRunGit;
  const sleep = io.sleep ?? realSleep;
  const wireBudget = createWireBudget(io.now);
  const ctx = resolveMasterContext({ env, runGit });
  if (!ctx.ok) {
    for (const reason of ctx.reasons) {
      log(`[mirror-master] 没跑起来的原因：${reason}`);
    }
    log("[mirror-master] 结论：exit 2 —— 有一步没跑起来（不等于通过，也不等于「没有要同步的」）");
    summarize({ lfs: null, wire: "没跑（前提没配齐）" });
    return CODE.NO_FACT;
  }
  const url = buildPushUrl(ctx.repo, ctx.token, (env.GITHUB_MIRROR_USER ?? "").trim() || "oauth2");
  log(
    `[mirror-master] 计划：HEAD ${ctx.headSha.slice(0, 8)} → ${ctx.repo}:${ctx.ref} · LFS 增量推送（不派发）`,
  );
  if (dryRun) {
    log(
      "[mirror-master] DRY-RUN：没推，计划如上（实跑时内容推送后还有一跳 LFS 增量推送，不带 --all）",
    );
    return CODE.OK;
  }
  /* 推送前的远端更新闸（ISSUE #3252）：单发读一次远端 ref，远端是本次 HEAD 的后代
   * ⇒ 拒推（`exit 1`，作为**事实**交账，强推会把远端退回旧值）。它**不是**探活：
   * 不重试、不占推送重试预算；读不到 / 浅克隆只记「闸不可用」照推（模块头写清了区分）。 */
  const guard = guardRemoteNotAhead({
    headSha: ctx.headSha,
    log,
    prefix: "mirror-master",
    ref: `refs/heads/${ctx.ref}`,
    runGit,
    sanitize,
    token: ctx.token,
    url,
  });
  if (guard.code !== CODE.OK) {
    log(`[mirror-master] 结论：exit ${String(guard.code)} —— ${guard.note}`);
    summarize({ lfs: null, wire: `拒推（${guard.relation}）` });
    return guard.code;
  }
  log(`[mirror-master] 前闸：${guard.note}`);
  /* 不再先探活（ISSUE #3252 的现场：探活 6 次耗 201s、一次内容推送都没发起）。网络不通时
   * push 自己的回话与 ls-remote 同一形，双跳只是把同一次出网试两遍；这里第一刀就是内容推送。 */
  const push = await runGitWithRetry(pushArgs(url, `refs/heads/${ctx.ref}`), {
    budgetMs: wireBudget(),
    label: "推送",
    log,
    maxAttempts: PUSH_MAX_ATTEMPTS,
    now: io.now,
    prefix: "mirror-master",
    runGit,
    sleep,
  });
  if (push.code !== 0) {
    const pushText = sanitize(`${push.stdout}\n${push.stderr}`, ctx.token);
    log(
      `[mirror-master] 推送本身没通（exit ${push.code}）：${explainRemoteProbeFailure(pushText)}`,
    );
    for (const line of pushText.split("\n")) {
      if (line.trim()) {
        log(`[mirror-master]   ${line}`);
      }
    }
    log(
      "[mirror-master] 结论：exit 2 —— 前提没落地（egress / 目标仓库 / 令牌这三层之一，看上面那句是哪一种；不是这一格判出的红）",
    );
    summarize({ lfs: null, retries: push.attempts - 1, wire: `败（exit ${String(push.code)}）` });
    return CODE.NO_FACT;
  }
  /* 推成功 ≠ 远端那条 ref 前进到了本次 HEAD：回读一次，按远端事实交账（见 verify 模块头）。 */
  const refCheck = await verifyPushedRef({
    headSha: ctx.headSha,
    log,
    now: io.now,
    prefix: "mirror-master",
    ref: `refs/heads/${ctx.ref}`,
    runGit,
    runGitWithRetry,
    sanitize,
    sleep,
    token: ctx.token,
    url,
  });
  if (refCheck.code !== CODE.OK) {
    log(`[mirror-master] 结论：exit ${String(refCheck.code)} —— ${refCheck.note}`);
    summarize({ lfs: null, retries: push.attempts - 1, wire: `推了但没到位（${refCheck.note}）` });
    return refCheck.code;
  }
  log(`[mirror-master] 推送后回读：${refCheck.note}`);
  /* 与 PR 档同一跳（文件头第 9 条）：master 服务的 daily / 桌包两档 checkout 也开 lfs:true，
   * 对象没送过去那边照样是「指针文件」的假红。 */
  const wireNote = `通（refs/heads/${ctx.ref} @ ${ctx.headSha.slice(0, 8)}）`;
  const lfs = await pushLfsObjects({
    log,
    prefix: "mirror-master",
    runGit,
    runGitWithRetry,
    sanitize,
    sleep,
    token: ctx.token,
    url,
  });
  if (lfs.code !== CODE.OK) {
    summarize({
      elapsedMs: lfs.elapsedMs,
      failure: lfs.failure,
      lfs: false,
      objects: lfs.objects,
      retries: lfs.attempts - 1,
      wire: wireNote,
    });
    return lfs.code;
  }
  /* `git lfs push` 退 0 也不等于对象在远端可下载：按 batch API 逐个核对，别只看退出码。 */
  const lfsCheck = await verifyLfsObjects({
    fetchImpl: io.fetchImpl ?? fetch,
    log,
    /* 与 PR 档同一跳的韧性（ISSUE #3400）：master 档没有 `--once`，按默认上限重试。 */
    maxAttempts: VERIFY_MAX_ATTEMPTS,
    now: io.now,
    prefix: "mirror-master",
    repo: ctx.repo,
    runGit,
    sleep,
    token: ctx.token,
  });
  if (lfsCheck.code !== CODE.OK) {
    log(`[mirror-master] 结论：exit ${String(lfsCheck.code)} —— ${lfsCheck.note}`);
    summarize({
      elapsedMs: lfs.elapsedMs,
      lfs: false,
      objects: lfsCheck.objectsText,
      retries: lfs.attempts - 1 + (lfsCheck.attempts - 1),
      wire: wireNote,
    });
    return lfsCheck.code;
  }
  log(`[mirror-master] 推送后回读：${lfsCheck.note}`);
  log(`[mirror-master] ✓ 已推 ${ctx.repo}:${ctx.ref} @ ${ctx.headSha.slice(0, 8)}`);
  summarize({
    elapsedMs: lfs.elapsedMs,
    lfs: true,
    objects: lfs.objects,
    retries: lfs.attempts - 1,
    wire: wireNote,
  });
  return CODE.OK;
}
