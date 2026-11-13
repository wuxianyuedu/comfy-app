#!/usr/bin/env node
/**
 * `ship-ga-logs-on-demand.mjs` —— 本地把「按需发起 → 等 CNB 站内回读」收进
 * 一条 `pnpm ship --gh-logs pr:<号>`（§12.20：同一串手工命令第二次就收成入口）。
 *
 * ## 补的是哪一格
 *
 * #3667 的按需档把判绿日志搬进 CNB 分两跳：先手工
 * `cnb build start-build --event api_trigger_ga_logs --env GA_LOG_PR_NUMBER=<号>`，
 * 等 GA 那边跑完 relay 之后，再 `pnpm ship --gh-logs pr:<号>` 站内读回。前一跳每次
 * 都要人敲一遍，而且「敲完不知道什么时候能读」——本模块把两跳并成一条命令：
 * `--gh-logs` 在 **CNB 侧还没有 relay 评论**时自己发起触发、自己等回读，然后交给
 * 既有的 `renderRelayLogs` 呈现。判红 / 已有日志 / `run:` 形态一律走原路径，不碰。
 *
 * ## 不另立判定（红线 ③）
 *
 * · 「触发发出去了没有」只认 `start-build` 回读到的 `sn`（既有执行者
 *   `buildSnFromOutput`）——退出码 0 既不等于发出去（#2378），也不等于日志到了；
 * · 「日志到了没有」只认 `readRelayLogs` 从 CNB 评论/附件读回的正文（既有执行者）；
 * · 本模块一次也不判绿不判红、不改三态；等不到只给「没有结论」，由调用方退回
 *   GitHub 快速回退链路。
 *
 * ## 边界
 *
 * · `--dry-run` 只念计划，`start-build` 一条都不发；
 * · 效应完整转述：stdout / stderr 都念出来，不丢 stderr（§12.20）；
 * · 只服务 `pr:` 形态（CNB 附件按 PR 号归属），`run:` 形态不伸手；
 * · 轮询有墙钟预算，超预算是「没拿到」不是「日志为空」。
 */
import { buildSnFromOutput } from "./ship-exec.mjs";
import { readRelayLogs } from "./ship-ga-logs-cnb.mjs";

/** 触发口的事件名，与 `.cnb.yml` 的顶层流水线键同源（用例逐字对账）。 */
export const ON_DEMAND_EVENT = "api_trigger_ga_logs";

/** 轮询间隔：GA pr-gate 是分钟级，20s 足够密又不刷屏。 */
export const ON_DEMAND_POLL_INTERVAL_MS = 20_000;

/** 轮询墙钟预算：留出 GA 排队 + 三十几格判据的余量，超了就诚实说没结论。 */
export const ON_DEMAND_POLL_MAX_MS = 15 * 60_000;

/**
 * 拼触发命令的 argv（纯函数）。dry-run 的计划与真跑的执行共用这一份，
 * 不另抄第二串命令（§12.20「计划 ⇄ 执行」）。
 *
 * 不传 `--branch`：事件配置落在 `.cnb.yml` 的默认分支段，合并后由 master 提供。
 *
 * @param {string} slug CNB 仓库路径
 * @param {number} pr PR 号
 * @returns {string[]} `cnb` 的参数
 */
export function onDemandTriggerArgs(slug, pr) {
  return [
    "build",
    "start-build",
    "--repo",
    slug,
    "--event",
    ON_DEMAND_EVENT,
    "--env",
    `GA_LOG_PR_NUMBER=${String(pr)}`,
    "--sync",
    "false",
  ];
}

/**
 * 发一次按需触发。**写动作**，只在显式 `--gh-logs` 那条路上够得着。
 *
 * @param {{
 *   run: (cmd: string, args: string[]) => {stdout:string,stderr:string,status:number,error:string|null},
 *   slug: string, pr: number, dryRun: boolean, log: (l: string) => void,
 * }} io
 * @returns {{ok:boolean, sn:string|null, raw:string}} ok 只表示「读到 sn」或「dry-run 走完计划」
 */
export function triggerOnDemandLogs(io) {
  const args = onDemandTriggerArgs(io.slug, io.pr);
  if (io.dryRun) {
    io.log(`[ship] --dry-run 计划：cnb ${args.join(" ")}（一条写动作都不发）`);
    return { ok: true, raw: "", sn: null };
  }
  const r = io.run("cnb", args);
  const raw = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  /* 效应完整转述：平台把 403 / scope 不足写在 stderr，只接 stdout 会念不出理由。 */
  if (r.stdout?.trim()) io.log(r.stdout.trimEnd());
  if (r.stderr?.trim()) io.log(r.stderr.trimEnd());
  const sn = buildSnFromOutput(raw);
  if (sn === null) {
    io.log("[ship] 按需触发没读到 sn ⇒ 这一跳没有结论（不是「发出去了」）；平台原文见上面两行。");
    return { ok: false, raw, sn: null };
  }
  io.log(`[ship] 按需触发已派发：build ${sn} · https://cnb.cool/${io.slug}/-/build/logs/${sn}`);
  return { ok: true, raw, sn };
}

/**
 * 等一条 `scope=all` 且比基线新的 relay 评论落到 CNB，再把正文读回。
 *
 * 结论来自 `readRelayLogs`（既有执行者）：本函数一次也不自己判「搬好了」，
 * 只问它有没有回正文、marker 是不是这一跑新写出来的。旧评论（没有 scope）按
 * `failed` 读，不会被误认成按需档。
 *
 * @param {{
 *   run: (cmd: string, args: string[]) => {stdout:string,stderr:string,status:number,error:string|null},
 *   slug: string, pr: number, baselineAssetPath: string | null,
 *   sleep: (ms: number) => void | Promise<void>, now?: () => number,
 *   intervalMs?: number, maxMs?: number, log: (l: string) => void,
 * }} io
 * @returns {Promise<{ok:boolean, relay:{meta:{run:string,sha:string,pr:string,jobs:number,bytes:number,assetPath:string,scope:string},text:string}|null, tries:number}>}
 */
export async function awaitOnDemandRelay(io) {
  const now = io.now ?? Date.now;
  const intervalMs = io.intervalMs ?? ON_DEMAND_POLL_INTERVAL_MS;
  const maxMs = io.maxMs ?? ON_DEMAND_POLL_MAX_MS;
  const started = now();
  let tries = 0;
  for (;;) {
    tries += 1;
    const relay = readRelayLogs({ number: io.pr, run: io.run, slug: io.slug });
    if (relay?.meta.scope === "all" && relay.meta.assetPath !== io.baselineAssetPath) {
      io.log(
        `[ship] 站内回读命中：按需全量日志已落地（第 ${String(tries)} 眼 · run ${relay.meta.run}）`,
      );
      return { ok: true, relay, tries };
    }
    const elapsed = now() - started;
    if (elapsed >= maxMs) {
      io.log(
        `[ship] 等按需搬运回读超预算（${String(Math.round(elapsed / 1000))}s / ` +
          `${String(Math.round(maxMs / 1000))}s，共 ${String(tries)} 眼）⇒ 没有结论，不是「日志为空」。`,
      );
      return { ok: false, relay: null, tries };
    }
    io.log(
      `[ship] 等 GA 按需搬运回 CNB…（第 ${String(tries)} 眼 · 已 ${String(Math.round(elapsed / 1000))}s）`,
    );
    // oxlint-disable-next-line no-await-in-loop -- 轮询本就是串行等待，并行没有意义
    await io.sleep(Math.min(intervalMs, maxMs - elapsed));
  }
}

/**
 * 一条 `--gh-logs pr:<n>` 里「拿到按需日志」的编排：触发 → 等回读。
 *
 * 基线由调用方给（`runGhLogs` 已经确认 CNB 侧连 marker 都没有 ⇒ 传 `null`），
 * 这里不重复读一次评论列表 —— 同一趟里三次 `list-comments` 没有任何新信息。
 *
 * @param {{
 *   run: (cmd: string, args: string[]) => {stdout:string,stderr:string,status:number,error:string|null},
 *   slug: string, pr: number, dryRun: boolean, baselineAssetPath?: string | null,
 *   sleep: (ms: number) => void | Promise<void>, now?: () => number,
 *   intervalMs?: number, maxMs?: number, log: (l: string) => void,
 * }} io
 * @returns {Promise<{relay:{meta:{run:string,sha:string,pr:string,jobs:number,bytes:number,assetPath:string,scope:string},text:string}|null, source:string}>}
 *   relay 交给 `runGhLogs` 用既有 `renderRelayLogs` 呈现；null = 没结论（调用方退回 GitHub 链路）
 */
export async function ensureOnDemandLogs(io) {
  const trig = triggerOnDemandLogs({
    dryRun: io.dryRun,
    log: io.log,
    pr: io.pr,
    run: io.run,
    slug: io.slug,
  });
  if (io.dryRun) {
    io.log(
      `[ship] --dry-run 计划：随后轮询 CNB PR #${String(io.pr)} 的 scope=all relay 评论并站内读回（一条写动作都不发）。`,
    );
    return { relay: null, source: "dry-run" };
  }
  if (!trig.ok) return { relay: null, source: "trigger-failed" };
  const awaited = await awaitOnDemandRelay({
    baselineAssetPath: io.baselineAssetPath ?? null,
    intervalMs: io.intervalMs,
    log: io.log,
    maxMs: io.maxMs,
    now: io.now,
    pr: io.pr,
    run: io.run,
    sleep: io.sleep,
    slug: io.slug,
  });
  return awaited.ok
    ? { relay: awaited.relay, source: "on-demand" }
    : { relay: null, source: "timeout" };
}
