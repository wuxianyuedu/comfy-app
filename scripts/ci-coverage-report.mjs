#!/usr/bin/env node
/**
 * `ci-coverage-report.mjs` — 把 `coverage/lcov.info` 交给平台的覆盖率上报（ISSUE #1990）。
 *
 * ## 现场
 *
 * 「洞察 → 单元测试覆盖率」那一页永远显示「无 / 无」，而 `单元测试` 这一步在
 * 自托管节点上其实是**跑过**的（`cnb-eus-1k5058g8l` 全量绿、827s）。两件事同时成立
 * 只说明一件事：**没人上报**。原因在历史里 —— 上报是 #623 删旧版流水线时一起被
 * 拿走的（那时它在 `.cnb.yml` 里是一个 `testing:coverage` 插件任务），#1959 按
 * 完整流程重建流水线时没被带回来。页面读的正是这个插件写进平台的读数。
 *
 * ## 为什么是命令行形态、而不是把插件任务搬回来
 *
 * 旧版那个 `testing:coverage` 任务与 `单元测试` 写在**同一个 stage 里**，于是它
 * 在 vitest 还没产出 `coverage/` 的时候就去找报告 —— 平台缺省的
 * `breakIfNoCoverage: true` 当场报「没有找到覆盖率报告文件」，整条门禁中断在
 * 一个与本意无关的位置（那件事的完整读数在规范 §13.5.3）。拆成后置 stage 能修掉
 * 时序，但修不掉另一件事：**报告有没有**取决于 `单元测试` 这一步跑没跑，而它此刻
 * 是**临时停用**的（`COMFYAPP_CI_DISABLED_GATES`）。插件在那时会判红 ——
 * 一个「测都没跑」的红，把停用这件事连带变成「整条流水线挂着」。
 *
 * 所以上报做成一条自己能回答「有没有报告」的命令：没有就**跳过并说明**。
 *
 * ## 它判什么：什么都不判
 *
 * 覆盖率门槛在 `vitest.config.ts` 的 `thresholds` 里，由 `单元测试` 那一档判
 * （`scripts/full-suite-run.mjs` → `vitest run --coverage`）。本文件只把那份产物
 * 报出去，**不设任何阈值** —— 平台阈值是绝对百分比，与本仓「按目录记门槛 + 棘轮」
 * 的口径冲突：填低了形同虚设，填高了把正常 PR 拦死。
 *
 * ## 边界（刻意不做的事）
 *
 *   · **不自己解析 lcov**：读多少行、算多少行是平台的事情，本仓没有第二份「覆盖率
 *     是多少」的口径，自己算一份只会多一处会漂的副本（§12.18）。
 *   · **不因为上报失败就判红**：这一步是**从属**的，红了也推不出代码有问题，
 *     而它一红就是整条流水线红。失败照实打出来、但仍算这一步过了。
 *   · **不在本地跑**：`cnb` 命令在开发机上不存在，这一步只在平台侧有意义。
 *
 * 用法：`node scripts/ci-coverage-report.mjs`（需先有 `coverage/lcov.info`）
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");

/** 报告文件（相对项目根）—— 与 `vitest.config.ts` 的 `lcov` reporter 是同一份口径。 */
export const REPORT_REL = "coverage/lcov.info";

/**
 * 这一跑该不该真去上报 —— 抽成纯函数，好让「没报告 / 空报告」这两种形态可测。
 *
 * @param {{exists: boolean, size: number}} probe
 * @returns {{report: boolean, reason: string}}
 */
export function decideReport({ exists, size }) {
  if (!exists) {
    return {
      report: false,
      reason: "没有报告文件（单元测试这一档此刻未产出覆盖率）",
    };
  }
  if (size <= 0) {
    return { report: false, reason: "报告文件是空的（0 字节）" };
  }
  return { report: true, reason: "把报告交给平台上报" };
}

/**
 * 平台侧上报命令 —— 抽成纯函数，是为了让「报的是哪个文件」可被判据核。
 *
 * 只**报告**不设阈值：见文件头最后那段（阈值口径在本仓的 `thresholds` 里）。
 *
 * @param {string} rel 报告文件的仓库相对路径
 * @returns {string[]}
 */
export function reportArgs(rel = REPORT_REL) {
  return ["insight", "ut", "report", "--file", rel];
}

function main() {
  const abs = path.join(ROOT, REPORT_REL);
  const exists = existsSync(abs);
  const size = exists ? statSync(abs).size : 0;
  const { report, reason } = decideReport({ exists, size });
  console.log(`[coverage-report] ${REPORT_REL}: ${reason}`);
  if (!report) {
    /* 跳过不是失败：见文件头「它判什么：什么都不判」。 */
    return;
  }
  const args = reportArgs();
  console.log(`[coverage-report] cnb ${args.join(" ")}`);
  const r = spawnSync("cnb", args, { cwd: ROOT, stdio: "inherit" });
  if (r.error !== undefined || r.status !== 0) {
    /* 上报失败照实说出来，但**不判红**（这一档是从属的，理由见文件头）。 */
    const why = r.error === undefined ? `退出码 ${r.status}` : r.error.message;
    console.log(`[coverage-report] 上报没成功（${why}），这一步不因此判红`);
  }
}

/* 只在被直接执行时跑 `main()`；被判据 import 时只拿纯函数。 */
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === import.meta.filename
) {
  main();
}
