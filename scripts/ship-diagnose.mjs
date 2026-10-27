#!/usr/bin/env node
/**
 * ship-diagnose.mjs —— `pnpm ship --diagnose [sn]`：CI 红了之后**只读**地取回
 * 「哪一格红了 + 失败行 + 尾部 + 完整日志链接」（ISSUE #2217，规范 §13.10.13）。
 *
 * ── 为什么要有这一格 ────────────────────────────────────────────
 *
 * 在此之前，CI 红了的标准动作是：`cnb build get-build-status -v` 找红格 →
 * `cnb build get-build-stage -v` 抄 `content` → 自己在几百上千行里搜 `FAIL` /
 * `×` / `AssertionError`。同一个动作每次红灯重抄一遍，而抄的过程里有两个已经在
 * 现场踩过的坑：
 *   · `data.pipelinesStatus` 是**按流水线 id 索引的对象**，不是数组（按数组读会得到
 *     `undefined`，于是「没有红格」）；
 *   · 格的 `content` 是**行数组**且带 ANSI 转义（按字符串读会得到 `"a,b,c"` —— 行号与
 *     失败行匹配全部失效，摘要空着会被读成「日志里没有失败行」）。
 * 两个坑都不会报错，只会给出一份看起来干净的空读数。这一格把取数与归一收进
 * `ci-build-readout.mjs` 的唯一实现里，`--diagnose` 只是它的第二个入口。
 *
 * ── 边界 ───────────────────────────────────────────────────────
 *
 *   · **一次也不写平台**：只发 `get-build-logs` / `get-build-status` /
 *     `get-build-stage` 三条读命令；不重跑、不评论、不改状态。
 *   · **不归因**：「红是我的还是主干的」由 `base-check.mjs` 判，这里只把红格原值
 *     与日志摘要摆出来，并在末尾点名那个入口。
 *   · **不猜构建**：不给号时按 HEAD 的 sha 在 `pull_request` 构建列表里**逐字**归属；
 *     找不到就落 2（没有结论），不拿「最新那条」顶上 —— 那会把别人的绿灯 / 红灯
 *     读成自己的。
 *   · 与主流程（提交 / 合并 / 关单）互斥：它在 preflight 之前分派，工作树干不干净、
 *     在 master 上、没有碎片都能跑 —— 红灯现场正是那种状态。
 */
import fs from "node:fs";
import path from "node:path";

import { gitScratchPath } from "./git-dir.mjs";
import { CODE } from "./ship-core.mjs";
import {
  classifyBuildOutcome,
  describeFailedStages,
  enrichStageErrors,
  fetchBuildStatus,
  fetchStageReason,
  formatOutcome,
  pipelineForStage,
  progressReadout,
  resolveBuildSn,
} from "./ci-build-readout.mjs";

/**
 * 连续两眼签名一致、且此刻没有一格在飞，要隔到多少分钟才念「疑似派发未出勤」。
 *
 * 这是**读数档**，不参与退码（ISSUE #2304）。三件要同时成立 —— 签名不变 + 到这一档 +
 * 没有一格落定，**缺一件就仍念「在飞 / 还在跑」**：#2184 与 #2172 记的都是同一族误判 ——
 * 「有一格正在长跑」与「整条没推进」在只读构建级状态时长得一模一样。
 */
export const DIAGNOSE_STALL_MINUTES = 10;

/** 上一眼读数的落点目录名（在 `.git/` 下，按构建号分文件，不入库）。 */
export const DIAGNOSE_STATE_DIR = "comfy-diagnose-last";

/**
 * 上一眼那份基数的路径。`git` 目录取不到时返回 `null`（不往检出里写文件）。
 *
 * @param {string} root 仓库根
 * @param {string} sn 构建号
 * @param {(cwd?: string) => string | null} [resolve] git 目录解析器（测试可注入）
 * @returns {string | null}
 */
function diagnoseStatePath(root, sn, resolve) {
  const dir = gitScratchPath(root, DIAGNOSE_STATE_DIR, resolve);
  if (!dir || !sn) return null;
  return path.join(dir, `${sn.replace(/[^\w.-]/g, "_")}.json`);
}

/**
 * @param {string} root 仓库根
 * @param {string} sn 构建号
 * @param {(cwd?: string) => string | null} [resolve] git 目录解析器（测试可注入）
 * @returns {{signature: string, atMs: number} | null} 读不到就是「没有上一眼」，不当成 0 分钟
 */
function readDiagnoseState(root, sn, resolve) {
  const p = diagnoseStatePath(root, sn, resolve);
  if (!p) return null;
  try {
    const got = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof got?.signature === "string" && Number.isFinite(got?.atMs)
      ? { signature: got.signature, atMs: got.atMs }
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} root 仓库根
 * @param {string} sn 构建号
 * @param {string} signature 这一眼的签名（`buildSignature` 的原样）
 * @param {number} atMs 这一眼的时刻（毫秒）
 * @param {(cwd?: string) => string | null} [resolve] git 目录解析器（测试可注入）
 * @returns {boolean} 有没有真的落下去（落不下去就别念「已落基线」）
 */
function writeDiagnoseState(root, sn, signature, atMs, resolve) {
  const p = diagnoseStatePath(root, sn, resolve);
  if (!p) return false;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ signature, atMs }), "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 「还在跑」这一支该念哪句话 —— 纯函数，五种情形各一条（用例逐条钉）。
 *
 * @param {{signature: string, flying: {count: number, names: string[]}, elapsedMinutes: number, previous: {signature: string, atMs: number} | null, stored?: boolean, prefix?: string}} input
 * @returns {string[]}
 */
export function stallReadout({
  signature,
  flying,
  elapsedMinutes,
  previous,
  stored = true,
  prefix = "[build-readout]",
}) {
  const tag = prefix;
  if (!previous) {
    return [
      stored
        ? `${tag}   第一眼看这一跑：已落一份基数（下一眼起，签名相同才谈得上「没推进」）`
        : `${tag}   这一跑没有可比基数（临时落点取不到）⇒ 只念进度，不念停滞`,
    ];
  }
  if (previous.signature !== signature) {
    return [
      `${tag}   上一眼 ${previous.signature} → 这一眼 ${signature} ⇒ 在推进，继续等`,
    ];
  }
  if (flying.count > 0) {
    return [
      `${tag}   签名没变（${signature}），但有 ${flying.count} 格在飞：` +
        `${flying.names.slice(0, 3).join("、")} ⇒ 还在跑，继续等`,
    ];
  }
  if (elapsedMinutes >= DIAGNOSE_STALL_MINUTES) {
    return [
      `${tag}   连续两眼签名一致（间隔 ${elapsedMinutes} 分钟）且此刻没有一格在飞（${signature}）`,
      `${tag}     ⇒ 疑似**派发未出勤**：在册、有构建号，但账面一格都没起 —— 这与「有一格正在长跑」不是一回事`,
      `${tag}     平台读数里问过了也没有执行体归属（\`runner\` / \`npc\` / \`node\` / \`agent\` 字段不存在或为空）⇒ 分不出「排队等空闲节点」还是「派发丢了」`,
      `${tag}     下一动作：pnpm ship --rerun-ci（推一个空提交重新派生一条流水线）—— 这一格仍退 2，不改成红`,
    ];
  }
  return [
    `${tag}   签名没变（${signature}）、也没有格在飞，但间隔 ${elapsedMinutes} 分钟未到 ${DIAGNOSE_STALL_MINUTES} 分钟这一档 ⇒ 先不下「停滞」的判断，下一眼再比`,
  ];
}

/**
 * `--diagnose --dry-run` 打印的计划 —— 与真跑同一份 argv 的形状。
 *
 * @param {string} slug 仓库路径
 * @param {string | null} sn 构建号（未给时按 HEAD 归属）
 * @returns {string[]}
 */
export function diagnosePlan(slug, sn) {
  const target = sn || "<sn>";
  return [
    `cnb build get-build-logs --repo ${slug} -v（未点名构建号时，按 HEAD 的 sha 在 pull_request 构建里归属）`,
    `cnb build get-build-status --repo ${slug} --sn ${target} -v`,
    `cnb build get-build-stage --repo ${slug} --sn ${target} --pipelineId <pipelineId> --stageId <stageId> -v（只对红格逐格取）`,
  ];
}

/**
 * 跑一次诊断。只读、幂等，结论按三态码返回。
 *
 * 退出码与 `ci-build-readout.mjs` 同一口径：绿 0、有格子真红 1、
 * 被取消 / 还在跑 / 取不到读数 2（**2 不是通过**）。
 *
 * @param {object} ctx
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} ctx.run 执行者
 * @param {(line: string) => void} ctx.log 输出通道
 * @param {string | null} ctx.slug 仓库路径
 * @param {boolean} ctx.cnbOk cnb 在不在
 * @param {string | null} [ctx.sn] 人点名的构建号
 * @param {string} [ctx.headSha] 当前 HEAD 的 sha（未点名构建号时用来归属）
 * @param {boolean} [ctx.dryRun] 只打印计划
 * @param {string} [ctx.root] 仓库根（「上一眼」的基数落在 `.git/` 下，按构建号分文件）
 * @param {number} [ctx.nowMs] 此刻（测试注入用；不参与任何判定）
 * @param {(cwd?: string) => string | null} [ctx.resolveGit] git 目录解析器（测试注入用）
 * @returns {number} `CODE` 之一
 */
export function runDiagnose({
  run,
  log,
  slug,
  cnbOk,
  sn = null,
  headSha = "",
  dryRun = false,
  root = process.cwd(),
  nowMs = Date.now(),
  resolveGit = undefined,
}) {
  if (!slug) {
    log(
      "[ship] --diagnose 取不到仓库路径 ⇒ 没有结论（不猜一个仓库名去读别人的构建）。",
    );
    return CODE.NOT_RUN;
  }
  if (dryRun) {
    for (const line of diagnosePlan(slug, sn))
      log(`[ship] --dry-run 计划：${line}`);
    log("[ship] --dry-run：只打印计划，一条都没执行。");
    return CODE.GREEN;
  }
  if (!cnbOk) {
    log(
      "[ship] --diagnose 没有执行者（cnb 不在）⇒ 没有结论，不猜这一跑绿没绿。",
    );
    return CODE.NOT_RUN;
  }
  /* 「要读哪一跑」与 `--stage-log` 共用一份归属算法（`resolveBuildSn`）—— 两个入口
   * 各写一遍的漂移形态是「同一个 sha 落到不同的跑」，那两条读数就成了互相矛盾的证据。 */
  const target = resolveBuildSn({
    run,
    log,
    slug,
    sn,
    headSha,
    command: "pnpm ship --diagnose",
  });
  if (!target) return CODE.NOT_RUN;
  const rawStatus = fetchBuildStatus(run, slug, target);
  if (!rawStatus) {
    log(`[ship] 构建 ${target} 取不到状态 ⇒ 没有结论（不念绿也不念红）。`);
    return CODE.NOT_RUN;
  }
  /* 「被取消」与「真失败」的唯一分界线是平台那句**原话**，而它只在 `get-build-stage -v`
   * 的 `data.error` 里（`get-build-status` 的 `stages[]` 没有这一栏）⇒ 分类之前先把原话
   * 问回来（ISSUE #2406）。这一跳是只读的，取不到就照旧按状态判、只是念不出原话。 */
  const statusJson = enrichStageErrors(run, slug, target, rawStatus);
  const outcome = classifyBuildOutcome(statusJson);
  /** 被取消时平台给的原因原话（真红那一路由 `describeFailedStages` 逐格取）。 */
  let reason = outcome.reasons.find((r) => r.reason)?.reason ?? null;
  if (!reason && outcome.state === "cancelled") {
    const first = outcome.cancelled[0];
    const pipeline = first ? pipelineForStage(outcome, first.id) : null;
    if (first && pipeline) {
      reason = fetchStageReason(run, slug, target, pipeline.id, first.id);
    }
  }
  for (const line of formatOutcome(outcome, {
    sn: target,
    slug,
    reason,
    /** 把原值 JSON 一起交给它：「还在跑」那一支要念格子进度，且必须与轮询那行同一份计算。 */
    json: statusJson,
    prefix: "[ship]",
  })) {
    log(line);
  }
  if (outcome.state === "running") {
    /* 单发读数没有「上一眼」可比 ⇒ 自己留一份基数（`.git/` 下，按构建号分文件，不入库）。
       三件同时成立才念「疑似派发未出勤」：签名不变 + 到 `DIAGNOSE_STALL_MINUTES` + 没一格在飞。 */
    const progress = progressReadout(statusJson, target);
    const previous = readDiagnoseState(root, target, resolveGit);
    const elapsedMinutes = previous
      ? Math.max(0, Math.floor((nowMs - previous.atMs) / 60_000))
      : 0;
    const stored = writeDiagnoseState(
      root,
      target,
      progress.signature,
      nowMs,
      resolveGit,
    );
    for (const line of stallReadout({
      signature: progress.signature,
      flying: { count: progress.flyingCount, names: progress.flyingNames },
      elapsedMinutes,
      previous,
      stored,
      prefix: "[ship]",
    })) {
      log(line);
    }
  }
  if (outcome.state === "failed") {
    describeFailedStages(run, {
      slug,
      sn: target,
      outcome,
      log,
      prefix: "[ship]",
    });
    log(
      "[ship] 归因不在这一格（「红是我的还是主干的」）：node scripts/base-check.mjs <拦住你的那条门禁>",
    );
    return CODE.RED;
  }
  return outcome.state === "green" ? CODE.GREEN : CODE.NOT_RUN;
}
