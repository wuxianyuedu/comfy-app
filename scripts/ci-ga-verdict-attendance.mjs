#!/usr/bin/env node
/**
 * `ci-ga-verdict-attendance.mjs` —— GA 回调腿的**只读出勤读数**（ISSUE #3378）。
 *
 * ## 它补的是哪一格
 *
 * 骨架把「CNB 出站轮询 conclusion」换成「GA 入站推送结论」之后，有一句话此前没有
 * 只读出口：**GA 侧到底有没有把 `api_trigger_ga_verdict` 的回调 build 发起来**。
 * 判断这件事此前只能人肉翻 `cnb build get-build-logs --event api_trigger_ga_verdict`
 * 再对 `list-pull-commit-statuses` —— 同一串动作每次重敲，正是 §12.20 那一族。
 * 本入口把它收成一次可复做的读数（在册 ≠ 出勤，#2114 口径的回调版）。
 *
 * ## 判什么、不判什么
 *
 * - **判**：窗口内 `api_trigger_ga_verdict` 事件有没有 build、各是什么终态、
 *   是否覆盖到窗口边界（没盖满不许念「窗口内没有」）。
 * - **不判** GA 那边为什么没发：secret 作用域 / 派发是否到达 / 五个 needs job 有没有
 *   跑到收尾，都要 GitHub Actions 的 run console，本仓 CNB 侧令牌够不着。**0 出勤
 *   是「这一侧没收到」，不是「GA 判了红」**。
 * - **不判**该不该把回调接成承重：那要单独一次决定，本入口不碰 `质量门禁` 的判决链。
 * - **不是判据、不是档**：不进 `quality-gate.mjs` 的 GATES，也不进
 *   `scripts/.on-demand-duties.json`（§12.20 第三标本：读账面工具收进两本账等于
 *   谎称它有人执行）。发现面在这一段注释与 `pnpm ga-verdict:attendance` 动词本身。
 * - 取数只调 `check-daily-attendance.mjs` 的 `fetchBuildsCoveringWindow` 那一份，
 *   不写第二份分页/覆盖自证（§12.12）；结论只念平台回的 `event` / `status` 原值，
 *   不另立第二套判定（§12.20 第二条）。
 *
 * ## 三态退码（与 `check-daily-attendance` / `check-mirror-attendance` 同口径）
 *
 * - `0` 出勤：窗口内至少一条该事件的 build；
 * - `1` 缺勤：窗口盖满了、一条都没有；
 * - `2` 没结论：列表取不到 / 窗口没盖满。**退 2 不算绿，也不算红。**
 *
 * ## 用法
 *
 * ```text
 * pnpm ga-verdict:attendance                 # 默认 24h 窗口
 * pnpm ga-verdict:attendance --hours 72
 * pnpm ga-verdict:attendance --json
 * ```
 */
import path from "node:path";
import process from "node:process";

import { makeRunner } from "./ship-exec.mjs";
import {
  CODE,
  DEFAULT_WINDOW_HOURS,
  fetchBuildsCoveringWindow,
} from "./check-daily-attendance.mjs";

/** 被观察的事件名，与 `.cnb.yml` / `ci-ga-verdict-callback.mjs` 逐字配对。 */
export const CALLBACK_EVENT = "api_trigger_ga_verdict";

/** 仓库根（`scripts/` 上一层）—— 与出勤两族同一口径，不靠继承的工作目录。 */
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 从窗口里的 build 列表挑出回调腿那几跑，按终态分堆。
 *
 * 只认 `event` 原值；`status` 原值照抄不折。列表里没有的 build 一律不编。
 *
 * @param {unknown} builds `get-build-logs` 的列表
 * @returns {{total: number, matched: number, byStatus: Record<string, number>, latest: string}}
 */
export function summarizeCallbackBuilds(builds) {
  const rows = Array.isArray(builds) ? builds : [];
  const ours = rows.filter((b) => String(b?.event ?? "") === CALLBACK_EVENT);
  /** @type {Record<string, number>} */
  const byStatus = {};
  for (const b of ours) {
    const key = String(b?.status ?? "(认不出终态)");
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  return {
    byStatus,
    latest: String(ours[0]?.createTime ?? ""),
    matched: ours.length,
    total: rows.length,
  };
}

/**
 * 取一次出勤读数。
 *
 * @param {{run?: (cmd: string, args: string[]) => any, slug?: string, windowHours?: number, now?: number}} io
 * @returns {{ok: false, why: string} | {ok: true, coverage: string, summary: ReturnType<typeof summarizeCallbackBuilds>, code: number}}
 */
export function readAttendance(io = {}) {
  const run = io.run ?? makeRunner(ROOT);
  const slug = io.slug ?? process.env.CNB_REPO_SLUG ?? "moon-read/comfy-app-t3";
  const windowHours = io.windowHours ?? DEFAULT_WINDOW_HOURS;
  const win = fetchBuildsCoveringWindow({ run, slug, windowHours, now: io.now });
  if (win.list === null) {
    return { ok: false, why: "取不到构建列表（cnb 起不来 / 网络不通 / 返回不是 JSON）" };
  }
  if (!win.covered) {
    return { ok: false, why: `取数没盖住 ${windowHours}h 窗口 —— ${win.note}` };
  }
  const summary = summarizeCallbackBuilds(win.list);
  return {
    coverage: win.note,
    code: summary.matched > 0 ? CODE.PRESENT : CODE.ABSENT,
    ok: true,
    summary,
  };
}

/**
 * 命令行入口。
 *
 * @param {string[]} [argv] 进程参数（不含 node / 脚本名）
 * @param {{run?: (cmd: string, args: string[]) => any, now?: number, slug?: string}} [io]
 * @returns {number} 三态退码
 */
export function main(argv = process.argv.slice(2), io = {}) {
  const hoursAt = argv.indexOf("--hours");
  const hoursRaw = hoursAt === -1 ? "" : (argv[hoursAt + 1] ?? "");
  const windowHours = /^\d+$/.test(hoursRaw) ? Number(hoursRaw) : 24;
  const asJson = argv.includes("--json");
  const got = readAttendance({ ...io, windowHours });
  if (!got.ok) {
    console.log(`[ga-verdict-attendance] 没结论：${got.why}`);
    return CODE.NO_VERDICT;
  }
  const { byStatus, latest, matched, total } = got.summary;
  const shape = Object.entries(byStatus)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");
  if (asJson) {
    console.log(
      JSON.stringify({ ...got.summary, coverage: got.coverage, code: got.code }, null, 2),
    );
  } else {
    console.log(
      `[ga-verdict-attendance] ${CALLBACK_EVENT}：窗口内 ${matched} 条 / 全量 ${total} 条${matched > 0 ? ` · 终态 ${shape} · 最近 ${latest}` : " · 一次都没发起"}`,
    );
    console.log(`[ga-verdict-attendance] 覆盖自证：${got.coverage}`);
    if (matched === 0) {
      console.log(
        `[ga-verdict-attendance] 0 出勤只说明「CNB 侧没收到回调 build」，不等于 GA 判红；GA run console 不在这个令牌的读权内，secret / 派发 / needs 收尾要另查`,
      );
    }
  }
  return got.code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main();
}
