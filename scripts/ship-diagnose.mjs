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
import { asArray, pickBuildForSha } from "./ship-build.mjs";
import { CODE } from "./ship-core.mjs";
import { cnbJson, short } from "./ship-exec.mjs";
import {
  classifyBuildOutcome,
  describeFailedStages,
  fetchBuildStatus,
  fetchStageReason,
  formatOutcome,
  pipelineForStage,
} from "./ci-build-readout.mjs";

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
}) {
  if (!slug) {
    log("[ship] --diagnose 取不到仓库路径 ⇒ 没有结论（不猜一个仓库名去读别人的构建）。");
    return CODE.NOT_RUN;
  }
  if (dryRun) {
    for (const line of diagnosePlan(slug, sn)) log(`[ship] --dry-run 计划：${line}`);
    log("[ship] --dry-run：只打印计划，一条都没执行。");
    return CODE.GREEN;
  }
  if (!cnbOk) {
    log("[ship] --diagnose 没有执行者（cnb 不在）⇒ 没有结论，不猜这一跑绿没绿。");
    return CODE.NOT_RUN;
  }
  let target = typeof sn === "string" && sn.trim() !== "" ? sn.trim() : null;
  if (!target) {
    const got = cnbJson(run, [
      "build",
      "get-build-logs",
      "--repo",
      slug,
      "-v",
    ]);
    const list = got ? asArray(got.json) : null;
    if (!list) {
      log(
        "[ship] 取不到 build 列表 ⇒ 没有结论（不是「没有构建」）；" +
          "要读哪一跑就点名：pnpm ship --diagnose <sn>",
      );
      return CODE.NOT_RUN;
    }
    const hit = pickBuildForSha(list, headSha);
    if (!hit) {
      log(
        `[ship] 按 HEAD ${short(headSha)} 没找到 pull_request 构建（还没推 / CI 还没起 / 构建挂在别的 sha 上）` +
          " ⇒ 没有结论。",
      );
      log(
        "[ship] 下一动作：在 PR 上确认构建已创建后重跑，或点名构建号：pnpm ship --diagnose <sn>",
      );
      return CODE.NOT_RUN;
    }
    target = hit.sn;
    log(
      `[ship] 按 HEAD ${short(headSha)} 归属到构建 ${target}（列表里 sha 逐字相同，取最新一条）。`,
    );
  }
  const statusJson = fetchBuildStatus(run, slug, target);
  if (!statusJson) {
    log(`[ship] 构建 ${target} 取不到状态 ⇒ 没有结论（不念绿也不念红）。`);
    return CODE.NOT_RUN;
  }
  const outcome = classifyBuildOutcome(statusJson);
  /** 被取消时平台给的原因原话（真红那一路由 `describeFailedStages` 逐格取）。 */
  let reason = null;
  if (outcome.state === "cancelled") {
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
    prefix: "[ship]",
  })) {
    log(line);
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
