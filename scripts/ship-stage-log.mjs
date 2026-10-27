#!/usr/bin/env node
/**
 * ship-stage-log.mjs —— `pnpm ship --stage-log [<sn>] <格名|格 id>`：**只读**地取回
 * 「某一格到底念了什么」，绿跑也能用（ISSUE #2455，规范 §13.10.13）。
 *
 * ## 为什么要有这一格
 *
 * #2445 的验收条件之一是「平台那一格日志里不再出现 DEP0190」，而要读它只能手工拼四个参数：
 * `sn` 要自己记、`pipelineId` 是 `<sn>-001` 那种拼错就读不到的形状、`stageId` 得先在
 * 三十几格里按**格名**反查。最坏的一件事是**拼错不报错** —— 别的格也有日志，读起来就像证据。
 *
 * `pnpm ship --diagnose` 只取**红格**，而且排在「CI 红了」那条路上。绿跑里某一格念了什么
 * 一直没有入口，而需要看绿跑的恰恰是这类问题：缓存槽那格念的是三态中的哪一态、
 * 受影响用例那格的份数、覆盖率那格的数、弃用警告清零没有。§12.20 那句
 * 「同一串手工命令被敲到第二次就收成入口」说的正是这一族。
 *
 * ## 它答什么 / 不答什么
 *
 * 答：这一格的状态原值与耗时、平台给的原话、正文（剥 ANSI、带**完整日志的行号**）、完整日志链接。
 * 不答：这一跑绿没绿、红是谁带起来的 —— 前者是 `--diagnose`（逐格分类 + 失败行摘要），
 * 后者是 `base-check.mjs`（「红是我的还是主干的」）。
 *
 * **同一个读者的两个入口**：取数与归一全走 `ci-build-readout.mjs`（`fetchBuildStatus` /
 * `fetchStageDetail` / `normalizeStageContent` / `resolveBuildSn`），反查格名走
 * `ci-build-classify.mjs` 的 `findStageMatches` —— 本文件不写第二套读取，也不另判一次
 * 「哪一格算红」，所以同一跑在 `--diagnose` 与这里不会给出两种答案。
 *
 * ## 退出码口径（与 `--diagnose` 不同，故意的）
 *
 * 0 = **这一格的正文取到了**；不等于「这一格绿了」—— 屏上第一行就是它的 `status` 原值。
 * 2 = 没结论：认不出这一格 / 取不到这一跑 / 正文取不到 / 与别的动作同行。
 * 这一格一次也不写平台，所以没有 1 那一档。
 */
import { CODE } from "./ship-core.mjs";
import { formatDurationMs } from "../src/lib/time-format.ts";
import {
  classifyBuildOutcome,
  fetchBuildStatus,
  fetchStageDetail,
  findStageMatches,
  resolveBuildSn,
  stageInFlight,
} from "./ci-build-readout.mjs";

/**
 * `--stage-log --dry-run` 打印的计划 —— 与真跑同一份 argv 的形状（照 `--diagnose` 的口径：
 * dry-run 教的执行面必须和真跑一样大，否则它教的是另一件事）。
 *
 * @param {string} slug 仓库路径
 * @param {string | null} sn 构建号（未给时按 HEAD 归属）
 * @param {string} stageRef 人给的格名或格 id
 * @returns {string[]}
 */
export function stageLogPlan(slug, sn, stageRef) {
  const target = sn || "<sn>";
  return [
    "cnb build get-build-logs --repo " +
      slug +
      " -v（未点名构建号时，按 HEAD 的 sha 在 pull_request 构建里归属）",
    `cnb build get-build-status --repo ${slug} --sn ${target} -v（按格名反查 stageId 用的就是这份逐格读数）`,
    `cnb build get-build-stage --repo ${slug} --sn ${target} --pipelineId <pipelineId> --stageId <stageId> -v（只取「${stageRef}」那一格）`,
  ];
}

/**
 * 跑一次取格日志。只读、幂等，结论按三态码返回。
 *
 * @param {object} ctx
 * @param {(cmd: string, args: string[]) => import("./ship-exec.mjs").ExecResult} ctx.run 执行者
 * @param {(line: string) => void} ctx.log 输出通道
 * @param {string | null} ctx.slug 仓库路径
 * @param {boolean} ctx.cnbOk cnb 在不在
 * @param {string | null} [ctx.sn] 人点名的构建号
 * @param {string} [ctx.stageRef] 人点名的格名或格 id
 * @param {string} [ctx.headSha] 当前 HEAD 的 sha（未点名构建号时用来归属）
 * @param {boolean} [ctx.dryRun] 只打印计划
 * @returns {number} `CODE` 之一
 */
export function runStageLog({
  run,
  log,
  slug,
  cnbOk,
  sn = null,
  stageRef = "",
  headSha = "",
  dryRun = false,
}) {
  const want = String(stageRef ?? "").trim();
  if (want === "") {
    log(
      "[ship] --stage-log 要点名读哪一格：格名（如 \"API 文档生成与自检\"）或格 id（如 stage-27）。",
    );
    log("[ship] 用法：pnpm ship --stage-log [<sn>] <格名|格 id>");
    return CODE.NOT_RUN;
  }
  if (!slug) {
    log(
      "[ship] --stage-log 取不到仓库路径 ⇒ 没有结论（不猜一个仓库名去读别人的构建）。",
    );
    return CODE.NOT_RUN;
  }
  if (dryRun) {
    for (const line of stageLogPlan(slug, sn, want)) {
      log(`[ship] --dry-run 计划：${line}`);
    }
    log("[ship] --dry-run：只打印计划，一条都没执行。");
    return CODE.GREEN;
  }
  if (!cnbOk) {
    log(
      "[ship] --stage-log 没有执行者（cnb 不在）⇒ 没有结论，不猜那一格念了什么。",
    );
    return CODE.NOT_RUN;
  }
  const target = resolveBuildSn({
    run,
    log,
    slug,
    sn,
    headSha,
    command: "pnpm ship --stage-log",
  });
  if (!target) return CODE.NOT_RUN;
  const statusJson = fetchBuildStatus(run, slug, target);
  if (!statusJson) {
    log(
      `[ship] 构建 ${target} 取不到逐格读数 ⇒ 反查不了这一格的 id（不是「这一跑没这一格」）。`,
    );
    return CODE.NOT_RUN;
  }
  const outcome = classifyBuildOutcome(statusJson);
  const { hits, near, examined } = findStageMatches(outcome, want);
  if (hits.length === 0) {
    log(
      `[ship] 构建 ${target} 的 ${examined} 格里没有**逐字**叫「${want}」的格` +
        "（比的是格名与格 id，认不出就停手，不模糊匹配替你挑一格）。",
    );
    if (near.length > 0) {
      log(
        `[ship]   名字相近的有：${near
          .slice(0, 5)
          .map((s) => `${s.name || "(无名)"}（${s.id}）`)
          .join("、")} —— 照原样点名。`,
      );
    }
    log(
      `[ship]   这一跑一共 ${examined} 格；要整跑哪格红了用 pnpm ship --diagnose ${target}。`,
    );
    return CODE.NOT_RUN;
  }
  if (hits.length > 1) {
    log(
      `[ship] 「${want}」在这一跑里命中 ${hits.length} 格 ⇒ 不挑一个：挑错一格读的是另一格的日志，` +
        "而它同样带行号、看起来就像证据（#2455 手工拼 stageId 就是这个坑）。",
    );
    for (const h of hits) {
      log(
        `[ship]   ${h.stage.name || "(无名)"}：id=${h.stage.id} · 流水线 ${h.pipeline.name || h.pipeline.id} · status=${h.stage.status}`,
      );
    }
    log("[ship] 下一动作：按上面点名的 stageId 再跑一次。");
    return CODE.NOT_RUN;
  }
  /* 上面已排掉「零命中」与「多命中」两支，这里只是让类型收窄到一格。 */
  const hit = hits[0];
  if (!hit) return CODE.NOT_RUN;
  const { pipeline, stage } = hit;
  const link = `https://cnb.cool/${slug}/-/build/logs/${target}`;
  log(
    `[ship] 这一格：${stage.name || "(无名)"}（id=${stage.id} · 流水线 ${pipeline.name || pipeline.id} · status=${stage.status}）`,
  );
  const detail = fetchStageDetail(run, slug, target, pipeline.id, stage.id);
  if (!detail) {
    log(
      `[ship] 取不到这一格的日志正文 ⇒ 没有结论（不是「这一格没念任何话」）。完整日志：${link}`,
    );
    return CODE.NOT_RUN;
  }
  if (detail.duration !== null) {
    log(
      `[ship]   耗时：${formatDurationMs(detail.duration) ?? `${detail.duration} 毫秒`}（平台给的 duration 是毫秒）`,
    );
  }
  /* 两处状态都是平台原值，只是问的是两条命令。不一致时**念出来**而不是取其一：
   * 「逐格读数说 success、按格取回说 error」这种分歧只有摆出来才可能被人发现。 */
  if (detail.status && detail.status.toLowerCase() !== stage.status) {
    log(
      `[ship]   按格取回的状态是 ${detail.status}，与逐格读数的 ${stage.status} 不同 —— 两处都是原值，本脚本不替你调和。`,
    );
  }
  if (detail.error) log(`[ship]   平台给这一格的原话：${detail.error}`);
  if (stageInFlight(detail.status) || stageInFlight(stage.status)) {
    log("[ship]   这一格还没有终态 ⇒ 下面是**截到此刻**的正文，不是完整日志。");
  }
  const body = detail.text.split("\n");
  log(`[ship]   正文 ${body.length} 行（行号即完整日志的行号）：`);
  body.forEach((line, idx) => {
    log(`[ship]   L${idx + 1} ${line.trimEnd()}`);
  });
  log(`[ship] 完整日志：${link}`);
  log(
    "[ship] 这一格只念正文，不判这一跑绿没绿 —— 那一问用 pnpm ship --diagnose <sn>。",
  );
  return CODE.GREEN;
}
