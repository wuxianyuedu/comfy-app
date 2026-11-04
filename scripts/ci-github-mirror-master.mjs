/**
 * `ci-github-mirror-master.mjs` —— 镜像格的 **push 档**（`--master`）执行面（ISSUE #2978 / #3064）。
 *
 * ## 为什么单独一份
 *
 * 它原本与 PR 档的 `runMirror()` 同住在 `ci-github-mirror-push.mjs`，而那份文件在
 * #3148 加了「派发形状落盘」之后撞上 §12.6 R5 的 900 行硬闸。切法是**按档切**：
 * `--master` 走的是另一条流水线（`master 合并复核`）、另一套上下文（没有 IID、
 * 不派发），共用面只有「探活 → 推 refs → 推 LFS」三跳。切出去之后主文件回到闸内，
 * 调用点与导出面**一字未改**（主文件把这一个名字原样转出）。
 *
 * ## 边界
 *
 * 本文件只做编排：判据（探活三形 / LFS 七类 / egress 重试）与话术全部来自
 * `ci-github-mirror-push.mjs` 与 `ci-mirror-failure-report.mjs`，这里不写第二份
 * （§12.12）。因此那些内部件在本文件里是**本地 import**，不是再导出一遍 ——
 * 导出面仍只在主文件那一份上。
 *
 * @module scripts/ci-github-mirror-master — `--master` 档的探活 + 推送编排
 */
import {
  CODE,
  buildPushUrl,
  explainRemoteProbeFailure,
  PROBE_MAX_ATTEMPTS,
  PUSH_MAX_ATTEMPTS,
  hasRemoteRefs,
  pushArgs,
  realRunGit,
  realSleep,
  resolveMasterContext,
  runGitWithRetry,
  sanitize,
} from "./ci-github-mirror-push.mjs";
/* LFS 那一跳自 #3146 起单独一份（900 行闸）：它反过来要 import 主文件的判据，故主文件不转出它。 */
import { pushLfsObjects } from "./ci-mirror-lfs-push.mjs";
import { renderMirrorSummary } from "./ci-mirror-failure-report.mjs";

/**
 * `--master` 模式的执行面：探活 → 推 `HEAD:refs/heads/master`，**没有派发那一跳**
 * （这一推服务的是 GitHub 侧的 schedule workflow —— 它们跑默认分支，推完即就位，
 * 没有要叫醒的对象）。探活与推送两跳的话术与 {@link runMirror} 同一族，
 * 前缀换成 `[mirror-master]`（文件头「--master」一节第 3 条）。
 *
 * @param {{env: Record<string, string | undefined>, runGit?: typeof realRunGit, sleep?: (ms: number) => Promise<void>, dryRun?: boolean, log?: (line: string) => void, readout?: boolean}} io
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
  /* 推送前那一问与 PR 模式同一跳、同一份判读、同一套重试（文件头第 5 / 8 条）。 */
  const probe = await runGitWithRetry(["ls-remote", url], {
    label: "探活",
    log,
    maxAttempts: PROBE_MAX_ATTEMPTS,
    prefix: "mirror-master",
    runGit,
    sleep,
  });
  const probeText = sanitize(`${probe.stdout}\n${probe.stderr}`, ctx.token);
  log(
    probe.code === 0
      ? "[mirror-master] 推送前这一读：通（空仓库 ⇒ 零条 ref 也是通的）"
      : `[mirror-master] 推送前这一读没通（exit ${probe.code}）：${explainRemoteProbeFailure(probeText)}`,
  );
  if (probe.code === 0 && !hasRemoteRefs(probe.stdout)) {
    log("[mirror-master]   目标仓库是空的（零条 ref）—— `--force` 推 master 正是它该有的第一笔");
  }
  if (probe.code !== 0) {
    for (const line of probeText.split("\n")) {
      if (line.trim()) {
        log(`[mirror-master]   ${line}`);
      }
    }
    log(
      "[mirror-master] 结论：exit 2 —— 前提没落地（egress / 目标仓库 / 令牌这三层之一，看上面那句是哪一种；不是这一格判出的红）",
    );
    summarize({
      lfs: null,
      retries: probe.attempts - 1,
      wire: `没跑（exit ${String(probe.code)}）`,
    });
    return CODE.NO_FACT;
  }
  /* 与 PR 模式同一套：egress 类失败重试一次，认证 / 权限类一次就交账。 */
  const push = await runGitWithRetry(pushArgs(url, `refs/heads/${ctx.ref}`), {
    label: "推送",
    log,
    maxAttempts: PUSH_MAX_ATTEMPTS,
    prefix: "mirror-master",
    runGit,
    sleep,
  });
  if (push.code !== 0) {
    log(`[mirror-master] 推送失败（exit ${push.code}）：`);
    for (const line of `${push.stdout}\n${push.stderr}`.split("\n")) {
      if (line.trim()) {
        log(`[mirror-master]   ${sanitize(line, ctx.token)}`);
      }
    }
    summarize({ lfs: null, retries: push.attempts - 1, wire: `败（exit ${String(push.code)}）` });
    return CODE.FAIL;
  }
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
